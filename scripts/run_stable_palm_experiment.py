"""Isolated v6 feature ablation using identical IDs, labels, seeds and trainer."""
from processed_paths import processed_artifact_path, resolve_artifact_path
from model_paths import model_artifact_folder
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import numpy as np
from stable_palm_features import CHANGED, raw_features
from run_recordings_v5_experiments import raw_geometry_features
from run_recordings_v6_experiments import PARTICIPANTS, experiment_name


def read(path):
    path = resolve_artifact_path(path)
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    path = resolve_artifact_path(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root, output = args.dataset_root.resolve(), args.output.resolve()
    if root == output or root in output.parents and 'experiments' not in output.parts:
        raise ValueError('Use a distinct experiments output directory')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'logs').mkdir(parents=True)
    (output / 'source').mkdir(parents=True)
    scripts = Path(__file__).resolve().parent
    for file in scripts.glob('*.py'):
        (output / 'source' / file.name).write_bytes(file.read_bytes())
    protocol = dict(change='Floor XY wrist-middle-MCP denominator at clip 75th percentile of frame median wrist-to-four-MCP XY distances; detected nondegenerate frames only',
                    changedChannels=CHANGED, seeds=[42, 43, 44], comparison='Saved v6 baseline; 4 held-out folds, unchanged IDs and labels',
                    acceptance='Fixed 0.63/0.15 and 0.70/0.15; no threshold tuning',
                    decision='Investigational success requires fewer P4 WHICH->HELP accepted errors without more total P4 accepted errors; mean accuracy loss <=1 percentage point, inspect all per-sign regressions. No live promotion authorized.',
                    limitations='P4-informed development hypothesis, not independent confirmation. Clip reference uses the complete captured clip, no cross-clip/test fitting. No annotation relabeling or sample removal.')
    (output / 'protocol.json').write_text(json.dumps(protocol, indent=2))
    frozen = {}
    for folder in sorted((model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v6')).iterdir()):
        for name in ('best_model.h5', 'evaluation.json', 'predictions.npz'):
            file = folder / name
            frozen[str(file)] = digest(file)
    features, labels = {}, {}
    unchanged = [i for i in range(238) if i not in CHANGED]
    for p in PARTICIPANTS:
        path = processed_artifact_path(root / 'processed', f'{p}-dataset-v{6 if p.endswith("04") else 5}.json')
        frozen[str(path)] = digest(path)
        data = read(path)
        for seq in data['sequences']:
            assert seq['id'] not in features
            baseline = raw_geometry_features(seq, data['featureSchema']['order'], 40)
            candidate = raw_features(seq, data['featureSchema']['order'])
            np.testing.assert_array_equal(candidate[:, unchanged], baseline[:, unchanged])
            assert np.isfinite(candidate).all() and candidate.shape == (40, 238)
            features[seq['id']], labels[seq['id']] = candidate, seq['label']
        print('Prepared raw features', p, flush=True)
    for p in PARTICIPANTS:
        exp = experiment_name(p)
        old = processed_artifact_path(root / 'processed', exp)
        for name in ('metadata.json', 'gru_data.npz'):
            frozen[str(old / name)] = digest(old / name)
        meta = read(old / 'metadata.json')
        for path, expected in meta['sourceSha256'].items():
            assert digest(Path(path)) == expected
        xs = {split: np.stack([features[sid] for sid in ids]) for split, ids in meta['sequenceIds'].items()}
        mean = xs['training'].mean(axis=(0, 1), keepdims=True)
        std = xs['training'].std(axis=(0, 1), keepdims=True)
        std[std < 1e-6] = 1
        with np.load(old / 'gru_data.npz', allow_pickle=False) as data:
            arrays = {k: data[k].copy() for k in data.files}
        # Keep unaffected baseline channels and their saved normalization bit-identical.
        for split, suffix in [('training', 'train'), ('validation', 'validation'), ('test', 'test')]:
            expected_y = np.array([meta['labelToIndex'][labels[sid]] for sid in meta['sequenceIds'][split]])
            np.testing.assert_array_equal(expected_y, arrays['y_' + suffix])
            candidate = ((xs[split] - mean) / std).astype(np.float32)
            arrays['X_' + suffix][:, :, CHANGED] = candidate[:, :, CHANGED]
            assert np.isfinite(arrays['X_' + suffix]).all()
        arrays['feature_mean'][:, :, CHANGED] = mean[:, :, CHANGED].astype(np.float32)
        arrays['feature_std'][:, :, CHANGED] = std[:, :, CHANGED].astype(np.float32)
        meta.update(experimentalNormalization=protocol['change'], baselineTensorSha256=frozen[str(old / 'gru_data.npz')],
                    experimentalRoot=str(output), changedChannels=CHANGED)
        dest = processed_artifact_path(output / 'processed', exp)
        dest.mkdir(parents=True)
        np.savez_compressed(dest / 'gru_data.npz', **arrays)
        (dest / 'metadata.json').write_text(json.dumps(meta, indent=2))
    (output / 'baseline-integrity.json').write_text(json.dumps(frozen, indent=2))
    env = dict(os.environ, MPLBACKEND='Agg', TF_NUM_INTRAOP_THREADS='4', TF_NUM_INTEROP_THREADS='1', TF_CPP_MIN_LOG_LEVEL='2', PYTHONUNBUFFERED='1')
    for p in [PARTICIPANTS[3], *PARTICIPANTS[:3]]:
        for seed in (42, 43, 44):
            exp = experiment_name(p)
            run = exp + (f'_seed{seed}' if seed != 42 else '')
            print('Training', run, flush=True)
            command = [sys.executable, '-u', str(scripts / 'train_gru.py'), '--experiment', exp, '--dataset-root', str(output), '--seed', str(seed)]
            with (output / 'logs' / (run + '.log')).open('w', encoding='utf-8') as log:
                subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
            result = read(model_artifact_folder(output / 'models', 'gru_model_train_test_geometry_v3_recordings_v6') / run / 'evaluation.json')
            print('Completed', p, seed, result['testAccuracy'], result['macroF1'], flush=True)
    for path, expected in frozen.items():
        assert digest(Path(path)) == expected, 'Baseline changed: ' + path
    print('All 12 runs finished; baseline source, tensors and models unchanged.', flush=True)


if __name__ == '__main__':
    main()
