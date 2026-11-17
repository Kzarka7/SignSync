"""Train a J/Z/OTHER motion head using real, equally long landmark sequences."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split

import sample_pipeline as pipeline


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root, output = args.dataset_root.resolve(), args.output.resolve()
    if output.exists():
        raise FileExistsError(output)
    source = root / 'processed/image-datasets/alphabet-v1/temporal-jz'
    package = json.loads((source.parent / 'artifact_checksums.json').read_bytes())
    for filename in ('raw_sequences.npz', 'manifest.jsonl', 'collector_feature_schema.json'):
        name = 'temporal-jz/' + filename
        checksum = package.get(name, package.get(name.replace('/', '\\')))
        assert pipeline.digest((source / filename).read_bytes()) == checksum
    schema = json.loads((source / 'collector_feature_schema.json').read_bytes())
    with np.load(source / 'raw_sequences.npz', allow_pickle=False) as arrays:
        positives = arrays['X_geometry'].copy()
        positive_y = arrays['y'].copy() + 1
        positive_ids = arrays['sample_ids'].tolist()
    positive_rows = [json.loads(line) for line in (source / 'manifest.jsonl').open(encoding='utf-8')]
    assert [r['sequence_id'] for r in positive_rows] == positive_ids
    assert all(r['complete_sign'] for r in positive_rows)
    negative_rows = [r for r in pipeline.read_csv(root / 'manifests/training-samples.csv').values()
                     if r['status'] == 'approved' and r['label'] not in ('J', 'Z')]

    def features(row):
        data, sequence, checksum, _ = pipeline.load_sample(root / row['sample_path'], row['label'])
        assert checksum == row['sha256'] and data['featureSchema'] == schema
        return np.concatenate(pipeline.raw_groups(sequence, schema['order']), axis=1).astype(np.float32)

    negatives = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        for i, values in enumerate(executor.map(features, negative_rows), 1):
            negatives.append(values)
            if i % 1000 == 0:
                print('Verified non-J/Z sequences', i, flush=True)
    x = np.concatenate([np.stack(negatives), positives])
    y = np.concatenate([np.zeros(len(negatives), dtype=np.int64), positive_y])
    ids = [r['sequence_id'] for r in negative_rows] + positive_ids
    assert x.shape == (len(ids), 40, 238) and np.isfinite(x).all() and len(ids) == len(set(ids))
    identities = [r['content_sha256'] for r in negative_rows] + [r['content_sha256'] for r in positive_rows]
    assert len(identities) == len(set(identities))
    recordings = [r['source_recording'] for r in negative_rows] + [r['source_recording'] for r in positive_rows]
    indices = np.arange(len(ids))
    train, rest = train_test_split(indices, train_size=round(len(ids) * .6), stratify=y, random_state=42)
    validation, test = train_test_split(rest, train_size=round(len(ids) * .15), stratify=y[rest], random_state=42)
    owners = {}
    for name, selected in [('training', train), ('validation', validation), ('test', test)]:
        for i in selected:
            if recordings[i]:
                assert owners.get(recordings[i], name) == name
                owners[recordings[i]] = name
    mean = x[train].astype(np.float64).mean(axis=(0, 1), keepdims=True)
    std = x[train].astype(np.float64).std(axis=(0, 1), keepdims=True)
    std[std < 1e-6] = 1
    x = ((x - mean) / std).astype(np.float32)
    output.mkdir(parents=True)
    np.savez_compressed(output / 'prepared_data.npz', X=x, y=y, sample_ids=np.asarray(ids),
        train_indices=train, validation_indices=validation, test_indices=test)
    np.savez_compressed(output / 'scalers.npz', feature_mean=mean, feature_std=std)
    metadata = dict(labels=['OTHER', 'J', 'Z'], sequenceLength=40, featureCount=238,
        featureOrder=schema['order'], seed=42, standardizationFit='training only',
        split=dict(method='exploratory stratified sequence split', unseenSignerEvaluation=False),
        sequenceIds={name: [ids[i] for i in selected] for name, selected in [('training', train), ('validation', validation), ('test', test)]},
        sourceManifestSha256=pipeline.digest((root / 'manifests/training-samples.csv').read_bytes()),
        positiveSourceSha256=pipeline.digest((source / 'raw_sequences.npz').read_bytes()),
        sourceCounts=dict(OTHER=len(negatives), J=int((positive_y == 1).sum()), Z=int((positive_y == 2).sum())),
        purpose='Motion rejection head for alphabet lab; OTHER is never emitted as a letter',
        limitation='Other-letter motion recordings are unavailable; other approved gestures/background are negative examples. Unknown signer/session overlap and continuous-boundary errors remain unresolved.')
    write(output / 'metadata.json', metadata)
    shutil.copy2(__file__, output / 'train_alphabet_motion.py')
    print('Starting motion-head training', metadata['sourceCounts'], flush=True)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(42)
    model = tf.keras.Sequential([
        tf.keras.layers.Input((40, 238)), tf.keras.layers.GRU(64), tf.keras.layers.Dropout(.3),
        tf.keras.layers.Dense(32, activation='relu'), tf.keras.layers.Dropout(.2),
        tf.keras.layers.Dense(3, activation='softmax'),
    ])
    model.compile(optimizer=tf.keras.optimizers.Adam(.001), loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    counts = np.bincount(y[train], minlength=3)
    history = model.fit(x[train], y[train], validation_data=(x[validation], y[validation]), batch_size=32,
        epochs=100, verbose=2, class_weight={i: len(train)/(3*int(n)) for i, n in enumerate(counts)}, callbacks=[
            tf.keras.callbacks.ModelCheckpoint(output / 'best_model.keras', monitor='val_loss', save_best_only=True),
            tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True),
            tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', patience=5, factor=.5, min_lr=.00001),
            tf.keras.callbacks.CSVLogger(output / 'epochs.csv'),
        ])
    model = tf.keras.models.load_model(output / 'best_model.keras', compile=True)
    qv = model.predict(x[validation], verbose=0)
    qt = model.predict(x[test], verbose=0)
    thresholds = {}
    for i, label in [(1, 'J'), (2, 'Z')]:
        choices = []
        for threshold in np.arange(.80, 1.0, .01):
            accepted = (qv.argmax(axis=1) == i) & (qv[:, i] >= threshold)
            n = int(accepted.sum())
            precision = float((y[validation][accepted] == i).mean()) if n else 0.
            if n >= 5 and precision >= .98:
                choices.append((n, -float(threshold), precision))
        best = max(choices) if choices else None
        thresholds[label] = dict(threshold=-best[1] if best else .99,
            validationPrecision=best[2] if best else None, validationAccepted=best[0] if best else 0)
    write(output / 'acceptance.json', dict(selection='validation only; precision >= .98, then greatest coverage', labels=thresholds, margin=.15))
    report = classification_report(y[test], qt.argmax(axis=1), labels=range(3), target_names=metadata['labels'], output_dict=True, zero_division=0)
    write(output / 'evaluation.json', dict(classificationReport=report, confusionMatrix=confusion_matrix(y[test], qt.argmax(axis=1), labels=range(3)).tolist(),
        bestEpoch=int(np.argmin(history.history['val_loss']))+1, epochsRun=len(history.history['loss']), metadata=metadata))
    write(output / 'history.json', {k: [float(v) for v in values] for k, values in history.history.items()})
    np.savez_compressed(output / 'predictions.npz', probabilities=qt, y_true=y[test], sample_ids=np.asarray(ids)[test])
    np.savez_compressed(output / 'validation_predictions.npz', probabilities=qv, y_true=y[validation], sample_ids=np.asarray(ids)[validation])
    write(output / 'artifact_checksums.json', {p.name: pipeline.digest(p.read_bytes()) for p in output.iterdir() if p.is_file()})
    print('COMPLETE', report, thresholds, flush=True)


if __name__ == '__main__':
    main()
