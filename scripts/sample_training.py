"""Integrity checks and validation-only acceptance calibration for sample candidates."""
from pathlib import Path
import json
import shutil

import numpy as np

from sample_pipeline import digest, read_csv, assign_splits, safe_name, SPLITS, SUFFIXES


def validate_candidate(folder, metadata):
    folder = Path(folder)
    if metadata.get('pipeline') != 'sign-folder-manifest-v1':
        raise ValueError('Expected a sign-folder manifest candidate')
    for name, checksum in metadata['artifactSha256'].items():
        path = (folder / name).resolve()
        if folder.resolve() not in path.parents or digest(path.read_bytes()) != checksum:
            raise ValueError('Prepared artifact changed: ' + name)
    for name in ('gru_data.npz', 'samples.csv', 'config.json', 'feature_schema.json'):
        if name not in metadata['artifactSha256']:
            raise ValueError('Missing prepared artifact checksum: ' + name)
    rows = list(read_csv(folder / 'samples.csv').values())
    config = json.loads((folder / 'config.json').read_text(encoding='utf-8'))
    if safe_name(config['name']) != metadata['experiment']:
        raise ValueError('Candidate version differs from its frozen config')
    if any(r['status'] != 'approved' for r in rows):
        raise ValueError('Candidate includes unapproved samples')
    partitions = assign_splits(rows, config)
    if metadata['sourceSha256'] != {r['sample_path']: r['sha256'] for r in rows}:
        raise ValueError('Sample checksum records differ')
    with np.load(folder / 'gru_data.npz', allow_pickle=False) as arrays:
        for split, suffix in zip(SPLITS, SUFFIXES):
            ids = [r['sequence_id'] for r in partitions[split]]
            if metadata['sequenceIds'][split] != ids:
                raise ValueError('Frozen split differs: ' + split)
            y = np.asarray([metadata['labelToIndex'][r['label']] for r in partitions[split]])
            np.testing.assert_array_equal(y, arrays['y_' + suffix])
        for key in ('feature_mean', 'feature_std'):
            if arrays[key].shape != (1, 1, 238) or not np.isfinite(arrays[key]).all():
                raise ValueError('Invalid training scaler')
        if np.any(arrays['feature_std'] <= 0):
            raise ValueError('Invalid training scale')
    return config


def threshold_metrics(y, probabilities, labels, threshold):
    from sklearn.metrics import f1_score, confusion_matrix
    predictions = probabilities.argmax(axis=1)
    accepted = probabilities.max(axis=1) >= threshold
    background = np.asarray([label in {'REST', 'IDLE_MOVEMENT'} for label in labels])
    emitted = accepted & ~background[predictions]
    idle = background[y]
    evaluated = np.where(accepted, predictions, len(labels))
    return dict(threshold=float(threshold), acceptedFraction=float(accepted.mean()),
                macroF1=float(f1_score(y, evaluated, labels=np.arange(len(labels)), average='macro', zero_division=0)),
                idleSamples=int(idle.sum()), idleFalseDetections=int((idle & emitted).sum()),
                idleFalseDetectionRate=float(emitted[idle].mean()) if idle.any() else None,
                confusionWithRejection=confusion_matrix(y, evaluated, labels=np.arange(len(labels) + 1)).tolist())


def calibrate_threshold(y, probabilities, labels):
    # A global offline threshold is a starting point for continuous testing.
    # It does not configure or replace the deployed live acceptance rules.
    candidates = [threshold_metrics(y, probabilities, labels, t) for t in np.linspace(0, 1, 101)]
    best = max(candidates, key=lambda result: (result['macroF1'], -(result['idleFalseDetectionRate'] or 0), -result['threshold']))
    return dict(selectedOn='validation only', objective='macro F1; ties prefer fewer idle false detections, then lower threshold',
                selected=best, candidates=candidates,
                continuousEvaluation='pending: requires held-out idle -> sign -> idle recordings')


def copy_preparation(folder, output, metadata):
    destination = output / 'preparation'
    destination.mkdir()
    for name in [*metadata['artifactSha256'], 'metadata.json']:
        source = folder / name
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    # Capture the actual trainer and dependency versions used for this run,
    # even if training happens after preparation scripts have evolved.
    training_source = output / 'training_source'
    training_source.mkdir()
    for name in ('train_gru.py', 'sample_training.py', 'sample_pipeline.py',
                 'preprocess_dataset.py', 'prepare_handshape_experiments.py',
                 'gesture_geometry.py', 'model_paths.py', 'processed_paths.py'):
        shutil.copy2(Path(__file__).with_name(name), training_source / name)
    import platform
    from importlib.metadata import version
    details = {'python': platform.python_version(),
               'packages': {name: version(name) for name in ('numpy', 'tensorflow', 'scikit-learn', 'matplotlib')},
               'sourceSha256': {p.name: digest(p.read_bytes()) for p in training_source.iterdir()}}
    (output / 'runtime.json').write_text(json.dumps(details, indent=2), encoding='utf-8')
