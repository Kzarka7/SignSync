r"""Compare Recognition Lab captures with training clips for the 32 standalone signs.

Input: one or more "Export recognition results" JSON files from Recognition Lab, recorded in
segmented mode. Record one sign per run (for example five STUDENT repetitions) and pass the
intended sign with --expected, so each detected segment can be scored.

For each detected segment (the last prediction window of each segmentId) the script:
  - takes the exact frames the model received (rows[].modelInputFrames). Older exports without
    them fall back to the observed frames between the row's startMs and endMs, which skips
    the Lab's resampling (flagged "approx" in the output);
  - replays them through the 32 Signs v5 Lab recognizers (plain and motion + augmentation),
    exactly as the backend does (same hand-slot swap, features and scalers);
  - measures the capture's shape: lead-in (ms before any hand is tracked), tracked duration,
    and the raised-hand height at the start and in the first 35% of the tracked span
    (wrist height above the shoulder line, in shoulder widths; the higher of the two hands).

The same shape measures are printed for the training clips of the expected sign and of
PERSON, STUDENT and TEACHER (v5 clips, per participant) for comparison.

Usage (repository root):
  .\.venv-gru\Scripts\python.exe -I scripts\analyze_lab_captures.py <export.json> [...] --expected STUDENT
  Options: --dataset-root <SignSync Dataset> (default: the sibling folder), --models plain,motion
"""
import argparse
import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'Backend'))
sys.path.insert(0, str(REPO / 'scripts'))

MODELS = {'plain': 'lab-signs32-standalone-v5', 'motion': 'lab-signs32-standalone-v5-motion'}
FOCUS = ('PERSON', 'STUDENT', 'TEACHER')
SETUP_PARTICIPANT = {'A': 'P3', 'B': 'P2', 'C': 'P1'}


def shape(frames):
    """Lead-in, tracked duration and raised-hand heights of one frame list (dicts with timestamp/features/valid)."""
    x = np.asarray([f['features'] for f in frames], dtype=float)
    t = np.asarray([f['timestamp'] for f in frames], dtype=float)
    valid = np.asarray([bool(f['valid']) for f in frames])
    tracked = valid & ((x[:, 36] > .5) | (x[:, 100] > .5))
    if tracked.sum() < 2:
        return None
    first, last = np.flatnonzero(tracked)[[0, -1]]
    mid_y = (x[:, 5] + x[:, 9]) / 2
    width = np.hypot(x[:, 4] - x[:, 8], x[:, 5] - x[:, 9]).clip(1e-3)
    heights = np.full(len(x), np.nan)
    for o in (36, 100):
        present = valid & (x[:, o] > .5)
        h = np.where(present, (mid_y - x[:, o + 2]) / width, np.nan)
        heights = np.fmax(heights, h)
    span = np.arange(first, last + 1)
    n = len(span)
    return dict(lead_in_ms=float(t[first] - t[0]), tracked_ms=float(t[last] - t[first]),
                start_height=float(np.nanmedian(heights[span[:max(1, n // 10)]])),
                first_part_height=float(np.nanmedian(heights[span[:max(2, int(n * .35))]])))


def segments(report):
    """Last predicted row of each segment (rows without segmentId are kept individually)."""
    rows = [r for r in report['rows'] if r.get('requestId') and r.get('prediction')]
    last = {}
    for i, r in enumerate(rows):
        last[r.get('segmentId', f'row{i}')] = r
    return list(last.values())


def model_input(report, row):
    if row.get('modelInputFrames'):
        return row['modelInputFrames'], 'exact'
    frames = [f for f in report['frames'] if row['startMs'] <= f['timestamp'] <= row['endMs']]
    return frames, 'approx'


def training_shapes(root, labels):
    from setups import setup_of
    cfg = json.loads((root / 'processed/candidates/samples_32_signs_standalone_v5/config.json').read_text(encoding='utf-8'))
    ids = {i for ids in cfg['splitSequenceIds'].values() for i in ids}
    setup, _ = setup_of(root)
    intake = json.loads((root / 'experiments/samples_32_signs_standalone_v5/intake.json').read_text(encoding='utf-8'))
    who = {i: SETUP_PARTICIPANT[s] for i, s in setup.items()}
    who.update({s['sequence_id']: 'P4' for s in intake['samples']})
    out = defaultdict(lambda: defaultdict(list))
    for r in csv.DictReader(open(root / 'processed/candidates/samples_32_signs_standalone_v5/samples.csv', encoding='utf-8-sig')):
        if r['sequence_id'] in ids and r['label'] in labels:
            seq = json.loads((root / r['sample_path']).read_text(encoding='utf-8-sig'))['sequences'][0]
            s = shape(seq['frames'])
            if s:
                out[r['label']][who.get(r['sequence_id'], '?')].append(s)
    return out


def fmt(values, key):
    v = [s[key] for s in values if s and np.isfinite(s[key])]
    if not v:
        return '  —  '
    return f'{statistics.median(v):+.2f}' if key.endswith('height') else f'{statistics.median(v):5.0f}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('exports', nargs='+', type=Path)
    parser.add_argument('--expected', required=True, help='intended sign for every segment, e.g. STUDENT')
    parser.add_argument('--dataset-root', type=Path, default=REPO.parent / 'SignSync Dataset')
    parser.add_argument('--models', default='plain,motion')
    args = parser.parse_args()
    root = args.dataset_root.resolve()
    sys.path.insert(0, str(root / 'experiments/samples_32_signs_standalone_v5_motion'))
    import os
    os.environ.setdefault('SIGNSYNC_DATASET_ROOT', str(root))
    from app.recognition import FEATURE_ORDER, SignRequest, get_diagnostic_recognizer
    recognizers = {name: get_diagnostic_recognizer(MODELS[name]) for name in args.models.split(',')}

    captures = []
    for path in args.exports:
        report = json.loads(path.read_text(encoding='utf-8'))
        if report.get('recognitionMode') != 'segmented':
            print(f'skip {path.name}: not a segmented run')
            continue
        if report['featureOrder'] != FEATURE_ORDER:
            raise SystemExit(f'{path.name}: feature order differs from the backend')
        for row in segments(report):
            frames, kind = model_input(report, row)
            entry = dict(file=path.name, segment=row.get('segmentId'), model=report['modelMode'], kind=kind,
                         exported=(row['prediction']['label'], row['prediction']['score']), emitted=bool(row.get('emit')),
                         shape=shape(frames), replay={})
            if 8 <= len(frames) <= 240:
                request = SignRequest.model_validate({'requestId': 'replay', 'featureOrder': FEATURE_ORDER, 'frames': frames,
                                                      'preview': bool(row.get('earlyPreview'))})
                for name, recognizer in recognizers.items():
                    try:
                        p = recognizer.predict(request)
                        entry['replay'][name] = [(t['label'], t['score']) for t in p['top3']] or [(p['label'], p['score'])]
                    except ValueError as error:
                        entry['replay'][name] = [(f'error: {error}', 0.)]
            captures.append(entry)

    print(f'\n{len(captures)} segments, expected {args.expected}\n')
    hits = defaultdict(int)
    for c in captures:
        s = c['shape'] or {}
        replay = ' | '.join(f"{name}: " + ', '.join(f'{l} {p:.2f}' for l, p in top[:3]) for name, top in c['replay'].items())
        print(f"{c['file'][-28:]} seg {c['segment']} [{c['kind']}] exported {c['exported'][0]} {c['exported'][1]:.2f}"
              f"{' (confirmed)' if c['emitted'] else ''}")
        print(f"    lead-in {s.get('lead_in_ms', float('nan')):5.0f} ms, tracked {s.get('tracked_ms', float('nan')):5.0f} ms, "
              f"start height {s.get('start_height', float('nan')):+.2f}, first-part height {s.get('first_part_height', float('nan')):+.2f}")
        print(f'    {replay}')
        for name, top in c['replay'].items():
            hits[name] += top[0][0] == args.expected
    for name in recognizers:
        print(f'{name}: top-1 = {args.expected} on {hits[name]}/{len(captures)} segments')

    labels = sorted({args.expected, *FOCUS})
    reference = training_shapes(root, labels)
    print('\nTraining clips (median per participant): tracked ms | start height | first-part height')
    for label in labels:
        for who, shapes in sorted(reference[label].items()):
            print(f'  {label:12s} {who}: n={len(shapes):2d}  {fmt(shapes, "tracked_ms")} | {fmt(shapes, "start_height")} | '
                  f'{fmt(shapes, "first_part_height")}')
    live = [c['shape'] for c in captures if c['shape']]
    if live:
        print(f'  {"LIVE":12s} you: n={len(live):2d}  {fmt(live, "tracked_ms")} | {fmt(live, "start_height")} | '
              f'{fmt(live, "first_part_height")}   (lead-in median {fmt(live, "lead_in_ms")} ms)')


if __name__ == '__main__':
    main()
