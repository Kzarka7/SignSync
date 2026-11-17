"""Train an exploratory alphabet classifier on genuine static and temporal samples."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def prepare_dataset(root, output, seed=42, split_override=None):
    labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    checksums = json.loads((root / 'artifact_checksums.json').read_bytes())
    sources = ['static-24/raw_static_features.npz', 'static-24/manifest.jsonl',
               'temporal-jz/raw_sequences.npz', 'temporal-jz/manifest.jsonl']
    source_hashes = {}
    for name in sources:
        expected = checksums.get(name.replace('/', '\\'), checksums.get(name))
        actual = digest(root / name)
        if actual != expected:
            raise ValueError('Prepared input checksum mismatch: ' + name)
        source_hashes[name] = actual
    with np.load(root / sources[0], allow_pickle=False) as static:
        static_x = static['X'].copy()
        static_labels = [str(static['labels'][i]) for i in static['y']]
        static_ids = static['sample_ids'].tolist()
    with np.load(root / sources[2], allow_pickle=False) as temporal:
        temporal_x = temporal['X_hand'].copy()
        temporal_labels = [str(temporal['labels'][i]) for i in temporal['y']]
        temporal_ids = temporal['sample_ids'].tolist()
    assert static_x.ndim == 2 and static_x.shape[1] == 128
    assert temporal_x.ndim == 3 and temporal_x.shape[1:] == (40, 128)
    assert len(static_x) == len(static_ids) and len(temporal_x) == len(temporal_ids)
    samples = [row[None, :] for row in static_x] + list(temporal_x)
    ids = static_ids + temporal_ids
    y = np.asarray([labels.index(l) for l in static_labels + temporal_labels], dtype=np.int64)
    lengths = np.asarray([1] * len(static_x) + [40] * len(temporal_x))
    assert len(ids) == len(set(ids)) == len(samples)
    assert set(y) == set(range(26)) and all(np.isfinite(x).all() for x in samples)
    static_manifest = {r['id']: r for r in (json.loads(line) for line in (root / sources[1]).open(encoding='utf-8')) if r['included']}
    temporal_manifest = {r['sequence_id']: r for r in (json.loads(line) for line in (root / sources[3]).open(encoding='utf-8'))}
    assert set(static_ids) == set(static_manifest) and set(temporal_ids) == set(temporal_manifest)
    split_path = split_override or root / 'split_assignments.json'
    assignment = None
    if split_path.exists():
        split_hash = digest(split_path)
        if split_override is None and split_hash != checksums.get(split_path.name):
            raise ValueError('Prepared split assignment checksum mismatch')
        source_hashes[split_path.name] = split_hash
        assignment = json.loads(split_path.read_bytes())
    keep_batches_together = not assignment or assignment.get('keepVideoBatchesTogether', True)
    tokens = []
    for sid, label in zip(static_ids, static_labels):
        row = static_manifest[sid]
        assert row['label'] == label
        if row.get('source_kind') == 'video':
            identity = [row['source_recording'], row['content_sha256']]
            if keep_batches_together:
                identity.append(row['collection_batch'])
            tokens.append(identity)
        else:
            tokens.append([row['frames_validation'][0]['sha256'], row['frames_validation'][0]['pixel_sha256']])
    for sid, label in zip(temporal_ids, temporal_labels):
        row = temporal_manifest[sid]
        assert row['label'] == label
        tokens.append([row['source_recording'], row['content_sha256']])
    split_metadata = dict(method='exploratory stratified sample split', seed=42,
                          fractions=[.60, .15, .25], unseenSignerEvaluation=False)
    if assignment is not None:
        by_id = {sid: i for i, sid in enumerate(ids)}
        partitions = {name: np.asarray([by_id[sid] for sid in assignment['sequenceIds'][name]], dtype=np.int64)
                      for name in ('training', 'validation', 'test')}
        if sorted(np.concatenate(list(partitions.values())).tolist()) != list(range(len(ids))):
            raise ValueError('Split assignments must cover every sample exactly once')
        split_metadata = dict(method=assignment['method'], unseenSignerEvaluation=False,
                              keepVideoBatchesTogether=keep_batches_together)
    else:
        if any(row.get('source_kind') == 'video' for row in static_manifest.values()):
            raise ValueError('Video-derived static samples require frozen split assignments')
        indices = np.arange(len(ids))
        train, other = train_test_split(indices, train_size=round(len(ids) * .60), stratify=y, random_state=42)
        validation, test = train_test_split(other, train_size=round(len(ids) * .15), stratify=y[other], random_state=42)
        partitions = dict(training=train, validation=validation, test=test)
    train, validation, test = [partitions[name] for name in ('training', 'validation', 'test')]
    owners = {}
    for split, members in partitions.items():
        assert set(y[members]) == set(range(26))
        for i in members:
            for token in tokens[i]:
                if not token:
                    raise ValueError('Missing verified content identity')
                if token in owners and owners[token] != split:
                    raise ValueError('Exact content, source recording or collection batch crosses splits')
                owners[token] = split
    # Accumulate statistics over actual observed frames, excluding padding.
    training_frames = np.concatenate([samples[i] for i in train]).astype(np.float64)
    mean = training_frames.mean(axis=0)
    std = training_frames.std(axis=0)
    std[std < 1e-6] = 1
    x = np.zeros((len(samples), 40, 128), dtype=np.float32)
    for i, sample in enumerate(samples):
        scaled = ((sample - mean) / std).astype(np.float32)
        assert np.isfinite(scaled).all() and not np.any(np.all(scaled == 0, axis=1))
        x[i, :len(sample)] = scaled
    output.mkdir(parents=True)
    np.savez_compressed(output / 'prepared_data.npz', X=x, y=y, lengths=lengths,
        sample_ids=np.asarray(ids), feature_mean=mean, feature_std=std,
        train_indices=train, validation_indices=validation, test_indices=test)
    metadata = dict(preparedPackageVersion=1, sampleCount=len(ids),
        splitCounts={s: len(v) for s, v in partitions.items()}, seed=seed, labels=labels, labelToIndex={l: i for i, l in enumerate(labels)},
        prepared_source=str(root), sourceSha256=source_hashes,
        split=split_metadata,
        sequenceIds={s: [ids[i] for i in members] for s, members in partitions.items()},
        input=dict(features=128, static_frames=1, temporal_frames=40, padding_value=0,
                   normalization='per-hand wrist-relative palm-scaled xyz and presence, then saved training-only scaler',
                   padding='Pad with zeros after standardizing actual frames; Masking ignores padded timesteps'),
        limitations=['Related image frames and augmentations can cross splits because signer/session provenance is unavailable.',
                    'Static letters use one observed frame; J/Z use complete 40-frame sequences. Modality and sequence length are correlated with labels.',
                    'No background classes or unknown-sign evaluation data are present.',
                    'Live recognition needs a compatible static/temporal input-selection policy and new recording evaluation.'])
    if not keep_batches_together:
        metadata['limitations'].append('Video clips from the same collection batch can appear in different splits.')
    if split_override is not None:
        shutil.copy2(split_override, output / 'split_assignments.json')
    write(output / 'metadata.json', metadata)
    write(output / 'labels.json', metadata['labelToIndex'])
    np.savez_compressed(output / 'scalers.npz', feature_mean=mean, feature_std=std)
    shutil.copy2(__file__, output / 'train_alphabet.py')
    write(output / 'artifact_checksums.json', {p.name: digest(p) for p in output.iterdir() if p.is_file() and p.name != 'artifact_checksums.json'})


def load_prepared(root):
    checksums = json.loads((root / 'artifact_checksums.json').read_bytes())
    for name in ('prepared_data.npz', 'metadata.json', 'labels.json', 'scalers.npz'):
        if digest(root / name) != checksums[name]:
            raise ValueError('Frozen training input checksum mismatch: ' + name)
    metadata = json.loads((root / 'metadata.json').read_bytes())
    labels = metadata['labels']
    assert labels == list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    with np.load(root / 'prepared_data.npz', allow_pickle=False) as arrays:
        x, y, lengths, ids = [arrays[k].copy() for k in ('X', 'y', 'lengths', 'sample_ids')]
        mean, std = [arrays[k].copy() for k in ('feature_mean', 'feature_std')]
        partitions = {name: arrays[key].copy() for name, key in
            [('training', 'train_indices'), ('validation', 'validation_indices'), ('test', 'test_indices')]}
    assert x.shape == (len(ids), 40, 128) and len(set(ids)) == len(ids)
    assert y.shape == lengths.shape == (len(ids),) and np.isfinite(x).all()
    assert np.isin(lengths, [1, 40]).all() and mean.shape == std.shape == (128,)
    assert np.isfinite(mean).all() and np.isfinite(std).all() and (std > 0).all()
    all_indices = np.concatenate(list(partitions.values()))
    assert sorted(all_indices.tolist()) == list(range(len(ids)))
    assert metadata['sampleCount'] == len(ids)
    for name, indices in partitions.items():
        assert set(y[indices]) == set(range(26))
        assert ids[indices].tolist() == metadata['sequenceIds'][name]
    with np.load(root / 'scalers.npz', allow_pickle=False) as arrays:
        np.testing.assert_array_equal(mean, arrays['feature_mean'])
        np.testing.assert_array_equal(std, arrays['feature_std'])
    return x, y, lengths, ids, partitions, metadata, labels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--split-assignments', type=Path, help='Explicit split manifest for unscaled prepared inputs')
    parser.add_argument('--prepare-only', action='store_true', help='Freeze splits and training-only scalers without importing TensorFlow or training')
    args = parser.parse_args()
    root, output = args.prepared.resolve(), args.output.resolve()
    if output.exists():
        raise FileExistsError('Preserving existing run: ' + str(output))
    if (root / 'prepared_data.npz').exists():
        if args.split_assignments is not None:
            parser.error('--split-assignments requires unscaled prepared inputs')
        load_prepared(root)
        output.mkdir(parents=True)
        for name in ('prepared_data.npz', 'metadata.json', 'labels.json', 'scalers.npz'):
            shutil.copy2(root / name, output / name)
        metadata = json.loads((output / 'metadata.json').read_bytes())
        metadata['seed'] = args.seed
        metadata['frozenPreparedSource'] = str(root)
        metadata['frozenPreparedChecksumsSha256'] = digest(root / 'artifact_checksums.json')
        write(output / 'metadata.json', metadata)
        shutil.copy2(__file__, output / 'train_alphabet.py')
        write(output / 'artifact_checksums.json', {p.name: digest(p) for p in output.iterdir() if p.is_file() and p.name != 'artifact_checksums.json'})
    else:
        split_override = args.split_assignments.resolve(strict=True) if args.split_assignments else None
        prepare_dataset(root, output, args.seed, split_override=split_override)
    x, y, lengths, ids, partitions, metadata, labels = load_prepared(output)
    train, validation, test = [partitions[k] for k in ('training', 'validation', 'test')]
    if args.prepare_only:
        print('PREPARED ONLY', {k: len(v) for k, v in partitions.items()}, output, flush=True)
        return
    print('Alphabet-only dataset:', {s: len(v) for s, v in partitions.items()}, flush=True)
    print('26 letters; static samples have one real frame, temporal J/Z samples have 40.', flush=True)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(args.seed)
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(None, 128), name='hand_features'),
        tf.keras.layers.Masking(mask_value=0, name='ignore_padding'),
        tf.keras.layers.GRU(64, name='alphabet_gru'),
        tf.keras.layers.Dropout(.30),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.Dropout(.20),
        tf.keras.layers.Dense(26, activation='softmax', name='letter_probabilities'),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(.001), loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', patience=5, factor=.5, min_lr=.00001),
        tf.keras.callbacks.ModelCheckpoint(output / 'best_model.keras', monitor='val_loss', save_best_only=True),
        tf.keras.callbacks.CSVLogger(output / 'epochs.csv'),
    ]
    history = model.fit(x[train], y[train], validation_data=(x[validation], y[validation]),
        batch_size=32, epochs=100, callbacks=callbacks, verbose=2)
    model = tf.keras.models.load_model(output / 'best_model.keras', compile=True)
    loss, accuracy = model.evaluate(x[test], y[test], verbose=0)
    probabilities = model.predict(x[test], verbose=0)
    validation_probabilities = model.predict(x[validation], verbose=0)
    assert probabilities.shape == (len(test), 26) and np.isfinite(probabilities).all()
    assert np.allclose(probabilities.sum(axis=1), 1)
    # Verify the variable-length static inference path agrees with masked padding.
    static_index = next(i for i in test if lengths[i] == 1)
    np.testing.assert_allclose(model(x[static_index:static_index+1, :1], training=False),
                               model(x[static_index:static_index+1], training=False), rtol=1e-4, atol=1e-5)
    predicted = probabilities.argmax(axis=1)
    report = classification_report(y[test], predicted, labels=np.arange(26), target_names=labels, output_dict=True, zero_division=0)
    evaluation = dict(testAccuracy=float(accuracy), testLoss=float(loss), macroF1=report['macro avg']['f1-score'],
        bestEpoch=int(np.argmin(history.history['val_loss'])) + 1, epochsRun=len(history.history['loss']),
        classificationReport=report, confusionMatrix=confusion_matrix(y[test], predicted, labels=np.arange(26)).tolist(),
        metadata=metadata)
    write(output / 'history.json', history.history)
    write(output / 'evaluation.json', evaluation)
    np.savez_compressed(output / 'predictions.npz', probabilities=probabilities, y_true=y[test], sample_ids=np.asarray(ids)[test])
    np.savez_compressed(output / 'validation_predictions.npz', probabilities=validation_probabilities,
        y_true=y[validation], sample_ids=np.asarray(ids)[validation])
    lines = ['# Alphabet-only pilot', '', f'Test accuracy **{accuracy:.2%}**; macro F1 **{evaluation["macroF1"]:.4f}**.',
        '', f'Best checkpoint at epoch {evaluation["bestEpoch"]}; trained for {evaluation["epochsRun"]} epochs.',
        '', f'Split method: {metadata["split"]["method"]}. {len(train):,} training, {len(validation):,} validation and {len(test):,} test samples.',
        '', *metadata['limitations'], '', '| Letter | Test samples | Precision | Recall | F1 |', '|---|---:|---:|---:|---:|']
    for label in labels:
        r = report[label]
        lines.append(f'| {label} | {r["support"]} | {r["precision"]:.1%} | {r["recall"]:.1%} | {r["f1-score"]:.3f} |')
    (output / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    write(output / 'artifact_checksums.json', {p.name: digest(p) for p in output.iterdir() if p.is_file() and p.name != 'artifact_checksums.json'})
    print('COMPLETE', accuracy, evaluation['macroF1'], output, flush=True)


if __name__ == '__main__':
    main()
