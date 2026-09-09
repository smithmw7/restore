#!/usr/bin/env python3
"""Normalize Restore's pickup, drop, material contact, and quiet scraping sounds.

User-owned recordings stay untouched. Reuses the breaking sound measurement rules.
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
TARGET = -22.39
DRAG_TARGET = -35.0
SELECTION = {
    'pickup': ('Sci FI Sounds Pro/Armor On', ['Armor On 1.wav', 'Armor On 5.wav']),
    'drop': ('Fighting Sounds Pro/Heavy Kicks', ['Kick 1.wav', 'Kick 10.wav']),
    'drag': ('Survival Sound Kit - HD Remake', ['Dragging Stone 2.wav', 'Dragging Stone 8.wav']),
    'hit-glass': ('Ultimate Footstep Sounds/GLASS', ['Glass footsteps 9.wav', 'Glass footsteps 17.wav']),
    'hit-concrete': ('Ultimate Footstep Sounds/CONCRETE', ['Heavy Running  Concrete footsteps 2.wav', 'Heavy Running  Concrete footsteps 1.wav']),
    'hit-rock': ('Ultimate Footstep Sounds/STONE', ['Stone footsteps 14.wav', 'Heavy Running  Stone footsteps 3.wav']),
    'hit-wood': ('Ultimate Footstep Sounds/WOOD', ['Wood footsteps 10.wav', 'Wood footsteps 1.wav']),
    'hit-metal-light': ('Ultimate Footstep Sounds/METAL', ['Light  Metal footsteps 3.wav', 'Light  Metal footsteps 4.wav']),
    'hit-metal-heavy': ('Ultimate Footstep Sounds/METAL', ['Metal footsteps 6.wav', 'Metal footsteps 10.wav']),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('/Users/marshallsmith/SFX/Ultimate SFX Bundle - HD Remaster2'))
    args = parser.parse_args()
    out_dir = ROOT / 'public/audio/repair'
    out_dir.mkdir(parents=True, exist_ok=True)
    prepared = []
    for family, (folder, names) in SELECTION.items():
        for i, name in enumerate(names, 1):
            samples, record = base.prepare(args.source_root / folder / name)
            if family == 'drag':
                # An interior excerpt removes the initial stone-set-down impact.
                offset = round(base.RATE * 0.45)
                samples = samples[offset:offset + round(base.RATE * 2.4)]
                crossfade = round(base.RATE * 0.12)
                body = samples[crossfade:-crossfade]
                # Last sample joins the next source sample at the loop boundary.
                seam = array.array('f', (samples[-crossfade + j] * (1 - j / (crossfade - 1)) + samples[j] * (j / (crossfade - 1)) for j in range(crossfade)))
                samples = body + seam
                record.update(loop_crossfade_seconds=0.12, interior_offset_seconds=0.45, loop_seam_delta=abs(samples[-1] - samples[0]))
                record['before_gain'] = base.loudness(samples)
            record.update(family=family, output=f'public/audio/repair/{family}-{i:02d}.wav')
            prepared.append((samples, record))
    # Match variants and all material contacts while allowing quieter texture and
    # transient contact roles. Concrete's high crest factor needs more headroom.
    def role(family):
        return 'contact' if family.startswith('hit-') else family
    targets = {}
    for kind in ['pickup', 'drop', 'contact', 'drag']:
        requested = DRAG_TARGET if kind == 'drag' else TARGET
        targets[kind] = round(min([requested] + [r['before_gain']['integrated_lufs'] + base.PEAK_CEILING - base.PEAK_MARGIN - r['before_gain']['true_peak_dbtp'] for _, r in prepared if role(r['family']) == kind]), 2)
    records = []
    for samples, record in prepared:
        clip_target = targets[role(record['family'])]
        gain = round(clip_target - record['before_gain']['integrated_lufs'], 3)
        output = ROOT / record['output']
        # Re-measure actual PCM16 output. Very short signals can move across the
        # EBU loudness gate as gain changes, so refine the single applied gain.
        for attempt in range(4):
            base.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(base.RATE), '-ac', '1', '-i', 'pipe:0', '-af', f'volume={gain}dB', '-c:a', 'pcm_s16le', str(output)], base.raw_bytes(samples))
            final = base.decode(output)
            after = base.loudness(final)
            if abs(after['integrated_lufs'] - clip_target) <= 0.15:
                break
            gain = round(gain + clip_target - after['integrated_lufs'], 3)
        assert after['true_peak_dbtp'] <= base.PEAK_CEILING, (output, after)
        assert abs(after['integrated_lufs'] - clip_target) <= 0.15, (output, after)
        assert all(abs(value) < 1 for value in final), output
        stream = base.probe(output)['streams'][0]
        assert (stream['codec_name'], stream['channels'], stream['sample_rate']) == ('pcm_s16le', 1, str(base.RATE))
        threshold = max(map(abs, final)) * 0.001
        onset = next(i for i, v in enumerate(final) if abs(v) >= threshold) / base.RATE
        record.update(target_lufs=clip_target, fixed_gain_db=gain, after_gain=after, output_duration_seconds=round(len(final) / base.RATE, 6), output_onset_seconds=round(onset, 6), output_bytes=output.stat().st_size, output_sha256=hashlib.sha256(output.read_bytes()).hexdigest(), clipped_samples=0)
        if record['family'] == 'drag':
            record['output_loop_seam_delta'] = abs(final[-1] - final[0])
        records.append(record)
        print(f"{output.name}: {after['integrated_lufs']:.2f} LUFS; {after['true_peak_dbtp']:.2f} dBTP; {len(final) / base.RATE:.3f}s")
    report = dict(targets_by_role_lufs=targets, requested_target_lufs=TARGET, drag_target_lufs=DRAG_TARGET, peak_ceiling_dbtp=base.PEAK_CEILING, method='48 kHz mono PCM16, -60 dBFS trim with 3 ms preroll and 30 ms tail, 8 ms terminal fade, fixed gain. Dragging clips use interior excerpts with a 120 ms overlap crossfade forming a continuous loop. Original sources unchanged.', measurement='FFmpeg EBU R128 integrated loudness and true peak with virtual padding to 0.8 seconds for short sounds. No padding in delivered assets; no compressor or limiter used in asset processing.', playback='Pickup: Armor On; release: Heavy Kicks; contact and snap: material footsteps. Drag assets are -35 LUFS, runtime maximum gain 0.12 with 150 ms attack, 100 ms release, 15 ms stop on completed assembly. Playback pitch remains unchanged.', total_bytes=sum(r['output_bytes'] for r in records), clips=records)
    path = ROOT / 'docs/repair-audio-normalization.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Prepared {len(records)} clips, {report["total_bytes"]} bytes, targets {targets} LUFS')


if __name__ == '__main__':
    main()
