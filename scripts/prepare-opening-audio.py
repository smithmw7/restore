#!/usr/bin/env python3
"""Prepare Restore's office and container Foley. Python stdlib + FFmpeg only.

Uses the project's shared trim and EBU R128 measurement helpers. Originals are
read-only. Action names describe designed Foley, not source recording objects.
"""
import argparse
import array
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('break_audio', ROOT / 'scripts/prepare-audio.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
SURVIVAL = 'Survival Sound Kit - HD Remake/'
ITEMS = 'Ui & Item Sounds - HD Remake/'
PEAK_CEILING = -4.0
TARGETS = {'handling': -29.5, 'paper': -34.0, 'dial': -35.0, 'cut': -27.0}
SELECTION = {
    'drawer': dict(source=SURVIVAL + 'Opening Drawer 2.wav', role='handling', start=0, duration=1.5,
                   filters='highpass=f=70,lowpass=f=4200', description='Recorded drawer travel for the office drawer.'),
    'paper': dict(source=ITEMS + 'Book page flip 2.wav', role='paper', start=0, duration=1.0,
                 filters='highpass=f=130,lowpass=f=5000', description='Book page Foley for notebook and photograph handling.'),
    'dial': dict(source=ITEMS + 'Click sound 13.wav', role='dial', start=0, duration=.2,
                filters='highpass=f=160,lowpass=f=4300', description='A UI-library click used as a mechanical lock detent.'),
    'latch': dict(source=SURVIVAL + 'Metal Trap Opening.wav', role='handling', start=0, duration=1.65,
                 filters='highpass=f=95,lowpass=f=4200', description='Metal trap mechanism Foley for a briefcase latch or fitted part lock.'),
    'locker': dict(source=SURVIVAL + 'Opening Locker 4.wav', role='handling', start=0, duration=.6,
                  filters='highpass=f=85,lowpass=f=4500', description='Recorded locker opening with a short metal rattle.'),
    'tool': dict(source=SURVIVAL + 'Metal Tools Foley 5.wav', role='handling', start=0, duration=1.7,
                filters='highpass=f=95,lowpass=f=4500', description='Metal tools handling for collecting the bolt cutters.'),
    'cut': dict(source=SURVIVAL + 'Metal Trap Closing 2.wav', role='cut', start=0, duration=.8,
               filters='highpass=f=100,lowpass=f=4800', description='Metal trap closure used as a cutter fastener snap; not a bolt-cutting source recording.'),
    'hinge': dict(source=SURVIVAL + 'Door Creak 4.wav', role='handling', start=.2, duration=1.65,
                 filters='highpass=f=95,lowpass=f=2800', description='A door creak excerpt for heavy container hinges; original door material unspecified.'),
}


def filtered(samples, filters):
    raw = base.run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1',
                    '-f', 'f32le', '-ar', str(base.RATE), '-ac', '1', '-i', 'pipe:0',
                    '-af', filters, '-f', 'f32le', 'pipe:1'], base.raw_bytes(samples)).stdout
    values = array.array('f', raw)
    if base.sys.byteorder != 'little':
        values.byteswap()
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path,
                        default=Path('/Users/marshallsmith/SFX/Ultimate SFX Bundle - HD Remaster2'))
    args = parser.parse_args()
    output_dir = ROOT / 'public/audio/opening'
    output_dir.mkdir(parents=True, exist_ok=True)
    prepared = []
    for family, definition in SELECTION.items():
        samples, source = base.prepare(args.source_root / definition['source'])
        start = round(definition['start'] * base.RATE)
        end = min(len(samples), start + round(definition['duration'] * base.RATE))
        samples = filtered(samples[start:end], definition['filters'])
        for edge, seconds in [('start', .002), ('end', .018)]:
            count = min(round(seconds * base.RATE), len(samples))
            for i in range(count):
                index = i if edge == 'start' else len(samples) - 1 - i
                samples[index] *= i / max(1, count - 1)
        record = dict(family=family, role=definition['role'], description=definition['description'],
                      source=source, excerpt_offset_after_trim_seconds=definition['start'],
                      excerpt_duration_seconds=len(samples) / base.RATE, filters=definition['filters'],
                      output=f'public/audio/opening/{family}-01.wav', before_gain=base.loudness(samples))
        prepared.append((samples, record))

    # Preserve transients without compression; lower a role's common target
    # only when its highest crest factor requires more peak headroom.
    targets = {role: round(min([requested] + [r['before_gain']['integrated_lufs'] + PEAK_CEILING - .15
                      - r['before_gain']['true_peak_dbtp'] for _, r in prepared if r['role'] == role]), 2)
               for role, requested in TARGETS.items()}
    records = []
    for samples, record in prepared:
        target = targets[record['role']]
        gain = round(target - record['before_gain']['integrated_lufs'], 3)
        path = ROOT / record['output']
        for _ in range(4):
            base.run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1', '-y',
                      '-f', 'f32le', '-ar', str(base.RATE), '-ac', '1', '-i', 'pipe:0',
                      '-af', f'volume={gain}dB', '-c:a', 'pcm_s16le', str(path)], base.raw_bytes(samples))
            final = base.decode(path)
            after = base.loudness(final)
            if abs(after['integrated_lufs'] - target) <= .15:
                break
            gain = round(gain + target - after['integrated_lufs'], 3)
        output_format = base.probe(path)
        stream = output_format['streams'][0]
        assert (stream['codec_name'], stream['channels'], stream['sample_rate']) == ('pcm_s16le', 1, str(base.RATE))
        assert abs(after['integrated_lufs'] - target) <= .15, (path, after, target)
        assert after['true_peak_dbtp'] <= PEAK_CEILING, (path, after)
        assert not any(abs(value) >= 1 for value in final), path
        assert final[0] == 0 and final[-1] == 0, path
        source = record['source']
        assert hashlib.sha256(Path(source['source']).read_bytes()).hexdigest() == source['source_sha256']
        record.update(target_lufs=target, fixed_gain_db=gain, after_gain=after, output_format=output_format,
                      output_duration_seconds=round(len(final) / base.RATE, 6), output_bytes=path.stat().st_size,
                      output_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), clipped_samples=0)
        records.append(record)
        print(f'{path.name}: {after["integrated_lufs"]:.2f} LUFS, {after["true_peak_dbtp"]:.2f} dBTP, '
              f'{len(final) / base.RATE:.3f}s', flush=True)
    report = dict(requested_targets_by_role_lufs=TARGETS, targets_by_role_lufs=targets,
                  peak_ceiling_dbtp=PEAK_CEILING,
                  method='48 kHz mono PCM16. Sources trimmed at -60 dBFS with shared prepare-audio.py; fixed excerpts, band filters, 2 ms start and 18 ms terminal fades. Fixed per-clip gain, with common loudness by role and no compressor or limiter. Originals unchanged.',
                  measurement='FFmpeg EBU R128 integrated loudness and true peak. Measurements virtually pad clips to at least 0.8 seconds; delivered assets do not include that padding. Encoded outputs are remeasured.',
                  playback='Eight single-variant one-shots. Existing Armor On pickup assets equip the gauntlets. Existing soft metal contact helps alignment. Installation is a physical latch; full completion reveal is a separate game milestone. One-shots share the twelve-voice limit and respect mute. No new audio loops.',
                  validation='Measured role loudness, true peak at or below -4 dBTP, mono PCM16 format, zero clipped samples, zero-valued excerpt edges, and unchanged original source hashes. Physical headset listening is separate.',
                  ffmpeg_version=base.run(['ffmpeg', '-version']).stdout.decode().splitlines()[0],
                  total_bytes=sum(r['output_bytes'] for r in records), clips=records)
    (ROOT / 'docs/opening-audio-normalization.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Prepared {len(records)} clips, {report["total_bytes"]} bytes, targets {targets} LUFS')


if __name__ == '__main__':
    main()
