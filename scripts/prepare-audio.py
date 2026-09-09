#!/usr/bin/env python3
"""Prepare Restore's user-supplied local impact recordings without changing originals.

Requires Python 3, ffmpeg and ffprobe. Run from any directory. Override the
library location with --source-root if the Ultimate SFX Bundle lives elsewhere.
"""

import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
RATE = 48000
REQUESTED_LUFS = -20.0
PEAK_CEILING = -2.0
PEAK_MARGIN = 0.10
MEASUREMENT_MIN_SECONDS = 0.8
SILENCE_THRESHOLD = 10 ** (-60 / 20)
SELECTION = {
    "glass": ("Pirate Sounds Pro/Break bottle", ["Break bottle 1.wav", "Break bottle 2.wav"]),
    "concrete": ("Real Recorded Guns/Concrete Impact", ["Concrete 3.wav", "Concrete 8.wav"]),
    "rock": ("Real Recorded Guns/Rocks Impact", ["Rocks 5.wav", "Rocks 8.wav"]),
    "wood": ("Real Recorded Guns/Wood Hard Impact", ["Wood Hard 1.wav", "Wood Hard 5.wav"]),
    "metal-light": ("Real Recorded Guns/Metal light Impact", ["Metal light 2.wav", "Metal light 3.wav"]),
    "metal-heavy": ("Real Recorded Guns/Metal hard Impact", ["Metal hard 1.wav", "Metal hard 4.wav"]),
}


def run(args, data=None):
    return subprocess.run(args, input=data, capture_output=True, check=True)


def probe(path):
    return json.loads(run([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_name,sample_rate,channels,bits_per_sample:format=duration",
        "-of", "json", str(path),
    ]).stdout)


def decode(path):
    raw = run([
        "ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(RATE),
        "-f", "f32le", "pipe:1",
    ]).stdout
    values = array.array("f", raw)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def raw_bytes(values):
    copy = array.array("f", values)
    if sys.byteorder != "little":
        copy.byteswap()
    return copy.tobytes()


def loudness(values):
    # Virtual padding makes sub-400 ms effects measurable. Padding is excluded
    # from delivered assets, and every pre/post measurement uses this same rule.
    result = run([
        "ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(RATE), "-ac", "1",
        "-i", "pipe:0", "-af",
        f"apad=whole_dur={MEASUREMENT_MIN_SECONDS},"
        f"loudnorm=I={REQUESTED_LUFS}:TP={PEAK_CEILING}:LRA=11:print_format=json",
        "-f", "null", "-",
    ], raw_bytes(values))
    record = json.loads(re.findall(
        r'\{\s*"input_i"[\s\S]*?\}', result.stderr.decode()
    )[-1])
    return {
        "integrated_lufs": float(record["input_i"]),
        "true_peak_dbtp": float(record["input_tp"]),
        "sample_peak_dbfs": round(20 * math.log10(max(map(abs, values))), 3),
    }


def prepare(source):
    original = decode(source)
    audible = [i for i, value in enumerate(original) if abs(value) > SILENCE_THRESHOLD]
    if not audible:
        raise ValueError(f"Silent source: {source}")
    # Keep 3 ms before the first audible sample and 30 ms after the tail. The
    # terminal 8 ms fade prevents discontinuities at the cropped noise floor.
    start = max(0, audible[0] - round(RATE * 0.003))
    end = min(len(original), audible[-1] + 1 + round(RATE * 0.030))
    trimmed = original[start:end]
    fade = min(len(trimmed), round(RATE * 0.008))
    for i in range(fade):
        trimmed[len(trimmed) - fade + i] *= (fade - 1 - i) / (fade - 1)
    return trimmed, {
        "source": str(source),
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "source_format": probe(source),
        "source_mono_measurement": loudness(original),
        "source_duration_seconds": round(len(original) / RATE, 6),
        "trim_start_seconds": round(start / RATE, 6),
        "trim_end_seconds": round(end / RATE, 6),
        "before_gain": loudness(trimmed),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(
        "/Users/marshallsmith/SFX/Ultimate SFX Bundle - HD Remaster2"
    ))
    args = parser.parse_args()
    output_dir = ROOT / "public/audio/breaks"
    output_dir.mkdir(parents=True, exist_ok=True)
    prepared = []
    for family, (folder, names) in SELECTION.items():
        for number, name in enumerate(names, 1):
            samples, record = prepare(args.source_root / folder / name)
            record.update(family=family, output=f"public/audio/breaks/{family}-{number:02d}.wav")
            prepared.append((samples, record))

    # All clips share a target. Lower it only if an input's crest factor requires
    # that to satisfy the peak ceiling, retaining every transient without a limiter.
    target = round(min([REQUESTED_LUFS] + [
        record["before_gain"]["integrated_lufs"] + PEAK_CEILING - PEAK_MARGIN
        - record["before_gain"]["true_peak_dbtp"] for _, record in prepared
    ]), 2)
    records = []
    for samples, record in prepared:
        gain = round(target - record["before_gain"]["integrated_lufs"], 3)
        output = ROOT / record["output"]
        run([
            "ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE),
            "-ac", "1", "-i", "pipe:0", "-af", f"volume={gain}dB",
            "-c:a", "pcm_s16le", "-ar", str(RATE), "-ac", "1", str(output),
        ], raw_bytes(samples))
        final = decode(output)
        after = loudness(final)
        assert after["true_peak_dbtp"] <= PEAK_CEILING, (output, after)
        assert abs(after["integrated_lufs"] - target) <= 0.15, (output, after)
        assert all(abs(value) < 1 for value in final), f"Clipped output: {output}"
        output_probe = probe(output)
        stream = output_probe["streams"][0]
        assert (stream["codec_name"], stream["channels"], stream["sample_rate"]) == (
            "pcm_s16le", 1, str(RATE)
        )
        onset_threshold = max(map(abs, final)) * 0.001
        onset = next(i for i, value in enumerate(final) if abs(value) >= onset_threshold) / RATE
        record.update(
            fixed_gain_db=gain,
            after_gain=after,
            output_format=output_probe,
            output_duration_seconds=round(len(final) / RATE, 6),
            output_onset_seconds=round(onset, 6),
            output_bytes=output.stat().st_size,
            output_sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
            clipped_samples=0,
        )
        records.append(record)
        print(f"{output.name}: {after['integrated_lufs']:.2f} LUFS, "
              f"{after['true_peak_dbtp']:.2f} dBTP, {len(final) / RATE:.3f} s")

    report = {
        "requested_target_lufs": REQUESTED_LUFS,
        "common_target_lufs": target,
        "peak_ceiling_dbtp": PEAK_CEILING,
        "method": "Mono conversion and 48 kHz resampling; crop below -60 dBFS with 3 ms "
                  "attack preroll and 30 ms tail; final 8 ms fade; fixed gain per clip. "
                  "No compressor or limiter. Original recordings remain unchanged.",
        "measurement": "FFmpeg loudnorm input measurements (EBU R128 integrated loudness "
                       "and true peak). Audio is virtually padded to at least 0.8 seconds "
                       "to measure very short effects; delivered WAV files have no padding. "
                       "Pre/post measurements use the same mono signal and padding rule.",
        "selection": "Two variants per material. Glass uses the available bottle breaks; "
                     "other families use crisp attacks with usable decay and enough peak "
                     "headroom to match loudness without limiting. Rock 5/8 have differing "
                     "gritty tails; light metal 2/3 alternate longer and shorter rings.",
        "ffmpeg_version": run(["ffmpeg", "-version"]).stdout.decode().splitlines()[0],
        "total_bytes": sum(r["output_bytes"] for r in records),
        "clips": records,
    }
    report_path = ROOT / "docs/audio-normalization.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Prepared {len(records)} clips, {report['total_bytes']} bytes, target {target} LUFS")


if __name__ == "__main__":
    main()
