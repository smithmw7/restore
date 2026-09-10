#!/usr/bin/env python3
"""Prepare contextual Restore Foley from the user's untouched local SFX library.

Contact names describe their in-game use. The concrete, wood and lamp textures
are designed Foley blends, not claims about the surfaces in the source recording.
"""
import argparse
import array
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('break_audio', ROOT / 'scripts/prepare-audio.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
SURVIVAL = 'Survival Sound Kit - HD Remake/'
PIRATE = 'Pirate Sounds Pro/'
TARGETS = {'break': -22.39, 'load': -28.0, 'texture': -35.0}


def layer(path, start=0, duration=None, weight=1, filters='highpass=f=65'):
    return dict(path=path, start=start, duration=duration, weight=weight, filters=filters)


SELECTION = {
    'timber-break': dict(role='break', loop=False, description='Wood Break recordings for crate fracture.', variants=[
        [layer(SURVIVAL + 'Wood Break 2.wav')],
        [layer(SURVIVAL + 'Wood Break 7.wav')],
    ]),
    'wood-creak': dict(role='load', loop=False, description='Filtered rudder movement Foley for a wooden crate taking load.', variants=[
        [layer(PIRATE + 'Rudder Movement/Rudder Movement 6.wav', filters='highpass=f=80,lowpass=f=2300')],
        [layer(PIRATE + 'Rudder Movement/Rudder Movement 7.wav', filters='highpass=f=80,lowpass=f=2300')],
    ]),
    'scrape-wood-concrete': dict(role='texture', loop=True, description='Stone drag grain blended with chest movement to suggest wood sliding on concrete; source contact surfaces are unspecified.', variants=[
        [layer(SURVIVAL + 'Dragging Stone 4.wav', .45, 1.65, .72, 'highpass=f=100,lowpass=f=3800'),
         layer(PIRATE + 'Chest moving/Chest moving 1.wav', .20, 1.65, .28, 'highpass=f=80,lowpass=f=1800')],
        [layer(SURVIVAL + 'Dragging Stone 6.wav', .45, 1.35, .72, 'highpass=f=100,lowpass=f=3800'),
         layer(PIRATE + 'Chest moving/Chest moving 2.wav', .15, 1.35, .28, 'highpass=f=80,lowpass=f=1800')],
    ]),
    'scrape-wood-wood': dict(role='texture', loop=True, description='Chest movement with a subdued wood-saw grain suggests wood rubbing against wood; the source recordings do not identify the contact pair.', variants=[
        [layer(PIRATE + 'Chest moving/Chest moving 1.wav', .20, 1.55, .88, 'highpass=f=80,lowpass=f=1700'),
         layer(SURVIVAL + 'Sawing Wood 4.wav', .40, 1.55, .12, 'highpass=f=120,lowpass=f=1100')],
        [layer(PIRATE + 'Chest moving/Chest moving 2.wav', .15, 1.30, .88, 'highpass=f=80,lowpass=f=1700'),
         layer(SURVIVAL + 'Sawing Wood 8.wav', .30, 1.30, .12, 'highpass=f=120,lowpass=f=1100')],
    ]),
    'metal-creak': dict(role='texture', loop=True, description='Door creaks with faint filtered metal-saw grain form a restrained lamp suspension strain texture; the creaking door material is unspecified.', variants=[
        [layer(SURVIVAL + 'Door Creak 6.wav', .30, 2.80, .92, 'highpass=f=180,lowpass=f=3200'),
         layer(SURVIVAL + 'Sawing Metal 5.wav', .08, 2.80, .08, 'highpass=f=350,lowpass=f=2600')],
        [layer(SURVIVAL + 'Door Creak 4.wav', .20, 2.30, .92, 'highpass=f=180,lowpass=f=3200'),
         layer(SURVIVAL + 'Sawing Metal 8.wav', .25, 2.30, .08, 'highpass=f=350,lowpass=f=2600')],
    ]),
}


def filter_samples(samples, filters):
    raw = base.run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-f', 'f32le', '-ar', str(base.RATE), '-ac', '1',
                    '-i', 'pipe:0', '-af', filters, '-f', 'f32le', 'pipe:1'], base.raw_bytes(samples)).stdout
    result = array.array('f', raw)
    if base.sys.byteorder != 'little':
        result.byteswap()
    return result


def make_loop(samples, seconds=.12):
    count = min(round(base.RATE * seconds), len(samples) // 4)
    # Smooth complementary weights keep the gain constant. The final sample is
    # followed by its original adjacent source sample when playback wraps.
    weights = [.5 - .5 * math.cos(math.pi * i / (count - 1)) for i in range(count)]
    seam = array.array('f', (samples[-count + i] * (1 - t) + samples[i] * t for i, t in enumerate(weights)))
    return samples[count:-count] + seam, count / base.RATE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('/Users/marshallsmith/SFX/Ultimate SFX Bundle - HD Remaster2'))
    args = parser.parse_args()
    output_dir = ROOT / 'public/audio/actions'
    output_dir.mkdir(parents=True, exist_ok=True)
    prepared = []
    for family, selection in SELECTION.items():
        for number, definitions in enumerate(selection['variants'], 1):
            layers, sources = [], []
            for definition in definitions:
                source = args.source_root / definition['path']
                samples, record = base.prepare(source)
                start = round(definition['start'] * base.RATE)
                end = len(samples) if definition['duration'] is None else start + round(definition['duration'] * base.RATE)
                assert end <= len(samples), (source, end / base.RATE, len(samples) / base.RATE)
                samples = filter_samples(samples[start:end], definition['filters'])
                measurement = base.loudness(samples)
                # Equal loudness before blend weighting makes ratios reproducible
                # despite widely varying recording levels in the source library.
                gain = -24.0 - measurement['integrated_lufs']
                multiplier = 10 ** (gain / 20) * definition['weight']
                layers.append(array.array('f', (value * multiplier for value in samples)))
                record.update(excerpt_offset_after_trim_seconds=definition['start'], excerpt_duration_seconds=len(samples) / base.RATE,
                              filters=definition['filters'], excerpt_measurement=measurement, layer_gain_db=round(gain, 3), blend_weight=definition['weight'])
                sources.append(record)
            length = min(map(len, layers))
            samples = array.array('f', (sum(source[i] for source in layers) for i in range(length)))
            crossfade = 0
            if selection['loop']:
                samples, crossfade = make_loop(samples)
            else:
                # Filtering can add a very small tail; remove DC discontinuity at
                # the endpoint without softening a wood break's initial attack.
                fade = min(round(base.RATE * .012), len(samples))
                for i in range(fade):
                    samples[len(samples) - fade + i] *= (fade - 1 - i) / (fade - 1)
            record = dict(family=family, role=selection['role'], loop=selection['loop'], description=selection['description'],
                          output=f'public/audio/actions/{family}-{number:02d}.wav', sources=sources,
                          loop_crossfade_seconds=crossfade, before_gain=base.loudness(samples))
            prepared.append((samples, record))

    targets = {role: round(min([requested] + [record['before_gain']['integrated_lufs'] + base.PEAK_CEILING - base.PEAK_MARGIN
                                            - record['before_gain']['true_peak_dbtp'] for _, record in prepared if record['role'] == role]), 2)
               for role, requested in TARGETS.items()}
    records = []
    for samples, record in prepared:
        target = targets[record['role']]
        gain = round(target - record['before_gain']['integrated_lufs'], 3)
        path = ROOT / record['output']
        for attempt in range(4):
            base.run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-y', '-f', 'f32le', '-ar', str(base.RATE), '-ac', '1', '-i', 'pipe:0',
                      '-af', f'volume={gain}dB', '-c:a', 'pcm_s16le', str(path)], base.raw_bytes(samples))
            final = base.decode(path)
            after = base.loudness(final)
            if abs(after['integrated_lufs'] - target) <= .15:
                break
            gain = round(gain + target - after['integrated_lufs'], 3)
        output_format = base.probe(path)
        stream = output_format['streams'][0]
        assert (stream['codec_name'], stream['channels'], stream['sample_rate']) == ('pcm_s16le', 1, str(base.RATE))
        assert abs(after['integrated_lufs'] - target) <= .15, (path, after)
        assert after['true_peak_dbtp'] <= base.PEAK_CEILING, (path, after)
        clipped = sum(abs(value) >= 1 for value in final)
        assert clipped == 0, path
        if record['loop']:
            delta = abs(final[-1] - final[0])
            assert delta < .003, (path, delta)
            # Compare seam slope to ordinary adjacent samples in this same clip.
            adjacent_rms = math.sqrt(sum((final[i + 1] - final[i]) ** 2 for i in range(len(final) - 1)) / (len(final) - 1))
            seam_ratio = delta / max(adjacent_rms, 1e-10)
            assert seam_ratio < 4, (path, seam_ratio)
            record.update(output_loop_seam_delta=delta, adjacent_sample_delta_rms=adjacent_rms, seam_to_adjacent_rms_ratio=seam_ratio)
        if record['family'] == 'metal-creak':
            high_band = filter_samples(final, 'highpass=f=4000')
            high_band_fraction = sum(value * value for value in high_band) / sum(value * value for value in final)
            record['highpass_4khz_energy_fraction'] = high_band_fraction
        for source in record['sources']:
            assert hashlib.sha256(Path(source['source']).read_bytes()).hexdigest() == source['source_sha256'], source['source']
        record.update(target_lufs=target, fixed_gain_db=gain, after_gain=after, output_format=output_format,
                      output_duration_seconds=round(len(final) / base.RATE, 6), output_bytes=path.stat().st_size,
                      output_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), clipped_samples=clipped)
        records.append(record)
        print(f'{path.name}: {after["integrated_lufs"]:.2f} LUFS, {after["true_peak_dbtp"]:.2f} dBTP, {len(final) / base.RATE:.3f}s', flush=True)
    report = dict(requested_targets_by_role_lufs=TARGETS, targets_by_role_lufs=targets, peak_ceiling_dbtp=base.PEAK_CEILING,
                  method='48 kHz mono PCM16, source trim at -60 dBFS with 3 ms preroll and 30 ms tail using prepare-audio.py. Fixed filtering and per-layer loudness gain; linear weighted blends; final role-matched fixed gain. Texture loops use a 120 ms cosine overlap crossfade. No compressor or limiter. Original sources unchanged and hashes rechecked.',
                  measurement='FFmpeg EBU R128 integrated loudness and true peak. Virtual minimum 0.8 second padding for measurements only; delivered clips have no padding. Final PCM16 outputs remeasured.',
                  provenance='Family names describe designed game actions, not source recording surfaces. Concrete scrape blends stone drag and chest movement; wood scrape blends chest movement and wood sawing; lamp strain blends generic door creaks and metal sawing.',
                  playback='Texture assets are deliberately very quiet at -35 LUFS and require runtime fade-in/out, movement/contact gating, and no pitch shift. Breaks retain a stronger transient role. Wood load creaks are quiet one-shots; pickup and drop recordings remain unchanged.',
                  validation='Measured normalization, format, duration, zero clipped output samples, original-file hashes and loop seam continuity. Audio audition was unavailable in this agent runtime; physical Quest listening still required.',
                  ffmpeg_version=base.run(['ffmpeg', '-version']).stdout.decode().splitlines()[0], total_bytes=sum(record['output_bytes'] for record in records), clips=records)
    (ROOT / 'docs/action-audio-normalization.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Prepared {len(records)} clips, {report["total_bytes"]} bytes, targets {targets} LUFS')


if __name__ == '__main__':
    main()
