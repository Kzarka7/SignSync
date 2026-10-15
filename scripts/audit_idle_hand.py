"""Audit idle-hand experiment readiness and freeze v6 hashes, without training.

This is a conservative screening tool, not a visual or FSL verification tool.
No source recordings, tensors, baseline models, or live configuration are changed.
"""
import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def sha(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def screen(sequence, order, annotation):
    """Screen only exact-ID one-hand annotations; never infer role from motion."""
    if annotation is None:
        return dict(status='missing_annotation')
    if annotation['label'] != sequence['label']:
        raise ValueError('Annotation label mismatch: ' + sequence['id'])
    variant = annotation['variant']
    if variant not in ('ONE_HAND_LEFT', 'ONE_HAND_RIGHT'):
        return dict(status='preserve_two_hand', variant=variant,
                    fslVerified=annotation['fsl_verified'])
    side = 'right' if variant == 'ONE_HAND_LEFT' else 'left'
    vectors = np.asarray([frame['features'] for frame in sequence['frames']], dtype=float)
    if vectors.shape != (len(sequence['frames']), len(order)) or not np.isfinite(vectors).all():
        raise ValueError('Malformed sequence: ' + sequence['id'])
    present = vectors[:, order.index(side + 'Hand.present')] > .999
    # Initial high-confidence screen only. y is positive below shoulder origin.
    # These thresholds are conservative operational criteria, not an idle classifier.
    lower = vectors[:, order.index(side + 'Hand.wrist.y')] > 1.0
    wrist_visible = vectors[:, order.index('pose.' + side + 'Wrist.visibility')] > .5
    elbow_visible = vectors[:, order.index('pose.' + side + 'Elbow.visibility')] > .5
    delta = vectors[:, [order.index(side + 'Hand.wrist.' + axis) for axis in 'xy']]
    delta -= vectors[:, [order.index('pose.' + side + 'Wrist.' + axis) for axis in 'xy']]
    aligned = np.linalg.norm(delta, axis=1) < .25
    candidates = present & lower & wrist_visible & elbow_visible & aligned
    return dict(status='one_hand_annotated', variant=variant, incidentalSide=side,
                absentThroughout=bool(not present.any()), observedFrames=int(present.sum()),
                screenedDonorFrames=np.flatnonzero(candidates).tolist(),
                fslVerified=annotation['fsl_verified'],
                requiresVisualReview=True)


def freeze(root, scripts, destination):
    comparison = root / 'models' / 'geometry_v3_recordings_v6_comparison'
    provenance = read(comparison / 'provenance.json')
    for name, expected in provenance['sourceSha256'].items():
        if sha(Path(name)) != expected:
            raise ValueError('Frozen v6 source changed: ' + name)
    files = set(comparison.rglob('*'))
    source_paths = {Path(name) for name in provenance['sourceSha256']}
    files.update(source_paths)
    folders = sorted((root / 'processed').glob('gru_*_geometry_v3_recordings_v6'))
    if len(folders) != 4:
        raise ValueError('Expected four v6 prepared folds')
    runs = []
    for folder in folders:
        files.update(folder.rglob('*'))
        for seed in (42, 43, 44):
            run = folder.name if seed == 42 else folder.name + f'_seed{seed}'
            saved = root / 'models' / 'gru_model_train_test_geometry_v3_recordings_v6' / run
            required = ('best_model.h5', 'evaluation.json', 'predictions.npz', 'history.json',
                        'training_history.png', 'confusion_matrix.png')
            if not all((saved / name).is_file() for name in required):
                raise ValueError('Incomplete baseline run: ' + run)
            evaluation = read(saved / 'evaluation.json')
            meta = read(folder / 'metadata.json')
            with np.load(saved / 'predictions.npz', allow_pickle=False) as data:
                np.testing.assert_array_equal(data['sequence_ids'], meta['sequenceIds']['test'])
                with np.load(folder / 'gru_data.npz', allow_pickle=False) as tensors:
                    np.testing.assert_array_equal(data['y_true'], tensors['y_test'])
                accuracy = float(np.mean(data['probabilities'].argmax(axis=1) == data['y_true']))
                if not np.isclose(accuracy, evaluation['testAccuracy'], atol=1e-7):
                    raise ValueError('Saved accuracy differs: ' + run)
            runs.append(dict(run=run, accuracy=accuracy))
            files.update(saved.rglob('*'))
    script_files = [p for p in scripts.glob('*.py') if p.name != Path(__file__).name]
    snapshot = destination / 'baseline-source'
    snapshot.mkdir(exist_ok=False)
    for path in script_files:
        (snapshot / path.name).write_bytes(path.read_bytes())
    entries = {str(p.resolve()): dict(sha256=sha(p), bytes=p.stat().st_size)
               for p in sorted(files) if p.is_file()}
    entries.update({str(p.resolve()): dict(sha256=sha(p), bytes=p.stat().st_size)
                    for p in snapshot.glob('*.py')})
    (destination / 'baseline-integrity.json').write_text(json.dumps(dict(
        createdAt=datetime.now(timezone.utc).isoformat(),
        preservation='Existing artifacts retained in place; SHA-256 inventory and source snapshot. '
                     'This is not a backup of model or dataset files.',
        verifiedRuns=runs, files=entries), indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root, output = args.dataset_root.resolve(), args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    rows = list(csv.DictReader((root / 'manifests' / 'samples.csv').open(encoding='utf-8-sig')))
    annotations = {r['sequence_id']: r for r in rows}
    if len(annotations) != len(rows):
        raise ValueError('Duplicate manifest sequence IDs')
    results, counts = [], {}
    for number in range(1, 5):
        participant = f'participant_{number:02d}'
        version = 6 if number == 4 else 5
        data = read(root / 'processed' / f'{participant}-dataset-v{version}.json')
        totals = Counter()
        for sequence in data['sequences']:
            result = screen(sequence, data['featureSchema']['order'], annotations.get(sequence['id']))
            totals[result['status']] += 1
            totals['absentThroughout'] += int(result.get('absentThroughout', False))
            totals['screenedDonorFrames'] += len(result.get('screenedDonorFrames', []))
            results.append(dict(participant=participant, sequenceId=sequence['id'],
                                label=sequence['label'], **result))
        counts[participant] = dict(totals)
        print(participant, dict(totals), flush=True)
    (output / 'sample-audit.json').write_text(json.dumps(dict(
        criteria=dict(wristYMin=1.0, poseWristVisibilityMin=.5, poseElbowVisibilityMin=.5,
                      maxHandPoseWristDistance=.25, units='shoulder widths for XY distances'),
        interpretation='Screened frames are candidates requiring visual review. Zero candidates '
                       'does not prove that no resting hands exist. No temporal stability test '
                       'or review has been completed. Missing annotations are not inferred.',
        counts=counts, samples=results), indent=2), encoding='utf-8')
    freeze(root, Path(__file__).parent, output)
    print('Saved sample audit and verified baseline integrity inventory:', output, flush=True)


if __name__ == '__main__':
    main()
