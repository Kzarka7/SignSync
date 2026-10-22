"""Prepare isolated P1-P3 sign/rest/idle JSON datasets and geometry-v3 tensors.

Never trains or promotes a model. Refuses to overwrite an existing release.
"""
from processed_paths import processed_artifact_path, processed_glob, resolve_artifact_path
from model_paths import model_artifact_folder
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np

from gesture_geometry import feature_names
from preprocess_dataset import load_export
from run_recordings_v5_experiments import raw_geometry_features, standardize_for_model


PARTICIPANTS = tuple(f'participant_{i:02d}' for i in range(1, 4))


def digest(path):
    path = resolve_artifact_path(path)
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read(path):
    path = resolve_artifact_path(path)
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def fold_name(held_out):
    others = [p for p in PARTICIPANTS if p != held_out]
    return 'gru_' + '_'.join('p' + p[-2:] for p in others) + '_train_p' + held_out[-2:] + '_test_geometry_v3_sign_rest_idle_v1'


def prepare(root, output):
    root, output = root.resolve(), output.resolve()
    if output.exists() or (root / 'experiments') not in output.parents:
        raise ValueError('Output must be a NEW folder inside dataset-root/experiments')
    protected = {}

    def protect(path):
        protected[str(path.resolve())] = digest(path)
        return path

    datasets, sign_sets, source_rows, schemas = {}, {}, {}, []
    all_ids = set()
    for participant in PARTICIPANTS:
        sign_path = protect(processed_artifact_path(root / 'processed', f'{participant}-dataset-v5.json'))
        signs = load_export(sign_path)
        counts = Counter(s['label'] for s in signs['sequences'])
        if len(counts) != 20 or set(counts.values()) != {20}:
            raise ValueError(f'Expected 400 balanced sign samples: {participant}')
        sequences = list(signs['sequences'])
        sign_sets[participant] = {s['id'] for s in sequences}
        rows = [dict(sequenceId=s['id'], label=s['label'], source=str(sign_path.relative_to(root))) for s in sequences]
        batch = root / 'clean' / participant / 'batch_rest_idle_2026_10_17'
        manifest_path = protect(batch / 'manifest.json')
        expected_hashes = {row['destination']: row['sha256'] for row in read(manifest_path)['files']}
        for category, label, expected_count in [('rest', 'REST', 30), ('idle_movement', 'IDLE_MOVEMENT', 21)]:
            files = sorted((batch / category).glob('*.json'))
            if len(files) != expected_count:
                raise ValueError(f'Wrong sample count: {participant} {category}')
            for path in files:
                protect(path)
                if protected[str(path.resolve())] != expected_hashes[f'{category}/{path.name}']:
                    raise ValueError(f'Sample differs from clean manifest: {path}')
                data = load_export(path)
                if data['featureSchema'] != signs['featureSchema'] or len(data['sequences']) != 1:
                    raise ValueError(f'Incompatible sample: {path}')
                sample = data['sequences'][0]
                if sample['label'] != label or sample.get('training', {}).get('category') != category:
                    raise ValueError(f'Category mismatch: {path}')
                sequences.append(sample)
                rows.append(dict(sequenceId=sample['id'], label=label, source=str(path.relative_to(root))))
        for sample in sequences:
            if sample.get('evaluation') or sample['id'] in all_ids:
                raise ValueError('Evaluation sample or duplicate sequence ID')
            all_ids.add(sample['id'])
            frames = sample['frames']
            timestamps = np.asarray([f['timestamp'] for f in frames])
            values = np.asarray([f['features'] for f in frames], dtype=float)
            if len(frames) < 2 or np.any(np.diff(timestamps) <= 0) or values.shape != (len(frames), 164) or not np.isfinite(values).all():
                raise ValueError(f'Invalid frames: {sample["id"]}')
            if not np.isclose(timestamps[-1] - timestamps[0], sample['durationMs'], atol=1):
                raise ValueError(f'Duration mismatch: {sample["id"]}')
        datasets[participant] = dict(schemaVersion=1, exportedAt=datetime.now(timezone.utc).isoformat(),
            labels=sorted({s['label'] for s in sequences}), sequenceCount=len(sequences),
            featureSchema=signs['featureSchema'], sequences=sequences)
        source_rows[participant] = rows
        schemas.append(signs['featureSchema'])
    if any(schema != schemas[0] for schema in schemas):
        raise ValueError('Participant schemas differ')
    labels = datasets[PARTICIPANTS[0]]['labels']
    if any(d['labels'] != labels for d in datasets.values()) or len(labels) != 22:
        raise ValueError('Participant labels differ')
    mapping = {label: i for i, label in enumerate(labels)}
    # Protect current live checkpoints and their preprocessing artifacts.
    for folder in sorted(processed_glob(root / 'processed', 'gru_*_geometry_v3_recordings_v5')):
        protect(folder / 'metadata.json')
        protect(folder / 'gru_data.npz')
    live = model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v5')
    live_models = sorted(live.glob('*/best_model.h5'))
    if not live_models:
        raise ValueError('Live v5 checkpoint directory not found')
    for path in sorted(live.rglob('*')):
        if path.is_file():
            protect(path)
    raw = {p: np.stack([raw_geometry_features(s, schemas[0]['order'], 40) for s in d['sequences']]) for p, d in datasets.items()}
    if any(x.shape != (451, 40, 238) or not np.isfinite(x).all() for x in raw.values()):
        raise ValueError('Invalid reconstructed features')
    ids = {p: [s['id'] for s in d['sequences']] for p, d in datasets.items()}
    targets = {p: np.array([mapping[s['label']] for s in d['sequences']], dtype=np.int64) for p, d in datasets.items()}
    output.mkdir(parents=True)
    (output / 'datasets').mkdir(parents=True)
    (output / 'folds').mkdir(parents=True)
    (output / 'source').mkdir(parents=True)
    # Snapshot the implementation and its feature dependencies for reproduction.
    for name in [Path(__file__).name, 'run_recordings_v5_experiments.py', 'preprocess_dataset.py',
                 'prepare_handshape_experiments.py', 'gesture_geometry.py',
                 'prepare_geometry_experiments.py', 'model_paths.py', 'processed_paths.py']:
        source = Path(__file__).resolve().parent / name
        if source.exists():
            protect(source)
            shutil.copy2(source, output / 'source' / name)
    for p, data in datasets.items():
        write(output / 'datasets' / f'{p}-sign-rest-idle-v1.json', data)
        # Read back the exports and prove original sign sequences are unchanged.
        saved = load_export(output / 'datasets' / f'{p}-sign-rest-idle-v1.json')
        assert saved['sequences'][:400] == read(processed_artifact_path(root / 'processed', f'{p}-dataset-v5.json'))['sequences']
    reports = []
    for held_out in PARTICIPANTS:
        training = [p for p in PARTICIPANTS if p != held_out]
        old_name = fold_name(held_out).replace('_sign_rest_idle_v1', '_recordings_v5')
        old = read(processed_artifact_path(root / 'processed', old_name) / 'metadata.json')
        split_ids = {s: [] for s in ['training', 'validation', 'test']}
        split_participants = {s: [] for s in split_ids}
        xs, ys = {}, {}
        for split in ['training', 'validation']:
            chunks, label_chunks = [], []
            for p in training:
                retained = set(old['sequenceIds'][split]) & sign_sets[p]
                chosen = set(retained)
                # Fixed seed, four validation recordings per new label/person.
                rng = np.random.default_rng(42)
                for label in ['IDLE_MOVEMENT', 'REST']:
                    candidates = np.flatnonzero(targets[p] == mapping[label])
                    rng.shuffle(candidates)
                    indices = candidates[:4] if split == 'validation' else candidates[4:]
                    chosen.update(ids[p][i] for i in indices)
                positions = [i for i, sid in enumerate(ids[p]) if sid in chosen]
                chunks.append(raw[p][positions]); label_chunks.append(targets[p][positions])
                split_ids[split].extend(ids[p][i] for i in positions)
                split_participants[split].extend([p] * len(positions))
            xs[split] = np.concatenate(chunks); ys[split] = np.concatenate(label_chunks)
        xs['test'], ys['test'] = raw[held_out], targets[held_out]
        split_ids['test'] = ids[held_out]
        split_participants['test'] = [held_out] * len(ids[held_out])
        sets = [set(v) for v in split_ids.values()]
        assert not (sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2])
        assert set.union(*sets) == all_ids
        for split in ['training', 'validation']:
            assert set(split_ids[split]) & set.union(*sign_sets.values()) == set(old['sequenceIds'][split])
        # Geometry reconstruction must match the baseline before fitting new scalers.
        positions = {sid: i for i, sid in enumerate(ids[held_out])}
        with np.load(processed_artifact_path(root / 'processed', old_name) / 'gru_data.npz', allow_pickle=False) as baseline:
            rebuilt = standardize_for_model(raw[held_out][[positions[sid] for sid in old['sequenceIds']['test']]], baseline['feature_mean'], baseline['feature_std'])
            np.testing.assert_allclose(rebuilt, baseline['X_test'], rtol=2e-5, atol=2e-4)
        mean = xs['training'].mean(axis=(0, 1), keepdims=True)
        std = xs['training'].std(axis=(0, 1), keepdims=True)
        std[std < 1e-6] = 1
        arrays = dict(feature_mean=mean.astype(np.float32), feature_std=std.astype(np.float32))
        for split, suffix in [('training', 'train'), ('validation', 'validation'), ('test', 'test')]:
            arrays['X_' + suffix] = ((xs[split] - mean) / std).astype(np.float32)
            arrays['y_' + suffix] = ys[split]
            assert np.isfinite(arrays['X_' + suffix]).all()
        folder = output / 'folds' / fold_name(held_out); folder.mkdir(parents=True)
        np.savez_compressed(folder / 'gru_data.npz', **arrays)
        counts = {s: dict(Counter(labels[int(v)] for v in y)) for s, y in ys.items()}
        meta = dict(metadataVersion=2, trainingParticipants=training, testParticipant=held_out,
            trainSources=[str(output / 'datasets' / f'{p}-sign-rest-idle-v1.json') for p in training],
            testSource=str(output / 'datasets' / f'{held_out}-sign-rest-idle-v1.json'),
            sourceSha256={str(output / 'datasets' / f'{p}-sign-rest-idle-v1.json'):
                digest(output / 'datasets' / f'{p}-sign-rest-idle-v1.json') for p in PARTICIPANTS},
            sequenceIds=split_ids, participantIds=split_participants, labelToIndex=mapping,
            sequenceLength=40, featureCount=238, geometryVersion=3, geometryFeatureNames=feature_names(),
            standardizationFit='training subset only', split=dict(seed=42, validationPerLabel=4,
                existingSignAssignments='Exact v5 baseline assignments retained', counts=counts),
            resampling='Existing geometry-v3 frame-index interpolation; no speed augmentation',
            baselineExperiment=old_name, baselineSignTensorParity=True,
            evaluationScope='Three-participant development evaluation; unseen test signer per fold. Validation signers also occur in training.',
            purpose='Prepared candidate data only; no model trained or promoted')
        write(folder / 'metadata.json', meta)
        with np.load(folder / 'gru_data.npz', allow_pickle=False) as saved:
            for key, value in arrays.items():
                np.testing.assert_array_equal(saved[key], value)
        summary = dict(fold=folder.name, heldOut=held_out, sizes={s: len(y) for s, y in ys.items()},
            splitIdsDisjoint=True, signAssignmentsPreserved=True, baselineFeatureParity=True, tensorReadbackVerified=True)
        reports.append(summary)
        print(json.dumps(summary), flush=True)
    changed = [path for path, expected in protected.items() if digest(Path(path)) != expected]
    if changed:
        raise RuntimeError('Protected source changed: ' + str(changed))
    manifest = dict(createdAt=datetime.now(timezone.utc).isoformat(), participants=list(PARTICIPANTS),
        totalSamples=len(all_ids), labelToIndex=mapping,
        perParticipantCounts={p: dict(Counter(s['label'] for s in d['sequences'])) for p, d in datasets.items()},
        sampleSources=source_rows, protectedFileSha256=protected, protectedFilesUnchanged=True,
        liveCheckpointsVerifiedUnchanged=len(live_models), folds=reports,
        limitations=['Isolated recordings, not continuous boundary evaluation.',
            'P1 resting postures unspecified; no General idle takes.',
            'No automated exclusions, augmentation, class rebalancing, or model training.',
            'New recordings are from later sessions; session differences may correlate with sign vs non-sign labels.',
            'P1-P3 informed prior development; results are not independent confirmation.'])
    write(output / 'manifest.json', manifest)
    outputs = {str(p.relative_to(output)): digest(p) for p in output.rglob('*') if p.is_file()}
    write(output / 'checksums.json', outputs)
    (output / 'README.md').write_text('''# Sign/rest/idle candidate dataset v1

1,353 recordings: P1-P3 each have 400 existing v5 signs, 30 REST and 21
IDLE_MOVEMENT samples. There are 22 labels. Original sequence contents and IDs
are preserved. Participant assignment comes from the source datasets/folders.

`datasets/` contains one collector-compatible merged JSON per participant.
`folds/` contains three leave-one-participant-out geometry-v3 preparations:
40 frames x 238 features, 726 training / 176 validation / 451 test per fold.
Training participants contribute 16 takes per sign, 26 REST and 17 IDLE_MOVEMENT
each; validation has four per label per training participant. Sign split IDs
exactly match each historical v5 fold. New-label splits use seed 42.
Normalization is fitted on training only. No augmentation or class resampling
is applied. New label indices require a new 22-output model, not the live model.

`manifest.json` records sample provenance, protected source/model hashes,
counts, checks and limitations. `checksums.json` covers generated artifacts
and source snapshots (except this README and the checksum file itself).
`source/` snapshots the preparation code and local feature dependencies.

All original datasets and current live checkpoints remain unchanged. No model
was trained or promoted. Existing train_gru.py does not register these new fold
names; a separate training runner must be added before training this candidate.

Limitations: P1 REST has no posture annotations; no General idle samples were
collected. Validation splits are label-stratified, not task/variant-stratified.
Later collection sessions may correlate with non-sign labels. This is isolated
clip development data, not evidence of continuous start/end performance or
independent confirmation on new users. Do not interpret missing hands alone as
a completed sign. No samples were excluded for missing-hand frames.
''', encoding='utf-8')
    print(f'Prepared {len(all_ids)} samples, {len(labels)} labels; verified {len(live_models)} live checkpoints unchanged. Output: {output}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.dataset_root, args.output)
