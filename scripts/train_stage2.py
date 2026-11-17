"""Prepare and train the Stage 2 offline handshape and motion pilot."""

import argparse
from collections import Counter
from contextlib import ExitStack
import hashlib
from itertools import product
import json
from pathlib import Path
import shutil
from zipfile import ZipFile

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix

from sample_pipeline import group_components, load_sample, read_csv
from stage2_features import motion_frames, shape_frame
from train_alphabet import digest, load_prepared, write


NUMBERS = 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN'.split()
LABELS = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + NUMBERS
MOTION = ['OTHER', 'J', 'Z', 'TEN']
SHAPES = [label for label in LABELS if label not in MOTION]
SPLITS = ('training', 'validation', 'test')
FRACTIONS = np.asarray([.60, .15, .25])


def manifest(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]


def verify(root, names=None):
    checks = json.loads((root / 'artifact_checksums.json').read_bytes())
    for name in checks if names is None else names:
        expected = checks.get(name, checks.get(name.replace('/', '\\')))
        if digest(root / name) != expected:
            raise ValueError(f'Checksum mismatch: {root / name}')


def number_splits(rows):
    grouping = [dict(row, collection_batch=row['collection_batch'] or row['archive']) for row in rows]
    groups, _ = group_components(grouping)
    keys = sorted(set(groups.values()))
    rng = np.random.default_rng(42)
    rng.shuffle(keys)
    counts = np.zeros((len(keys), len(NUMBERS)), dtype=np.int64)
    for row in rows:
        counts[keys.index(groups[row['sequence_id']]), NUMBERS.index(row['label'])] += 1
    # The frozen cohort has few provenance groups. Search every assignment and
    # prioritize class coverage and closeness to the requested proportions.
    if len(keys) > 12:
        raise ValueError('Too many groups for the frozen-cohort split search')
    assignments = np.asarray(list(product(range(3), repeat=len(keys))), dtype=np.int8)
    by_label = np.stack([(assignments == i) @ counts for i in range(3)], axis=1)
    feasible = (by_label > 0).all(axis=(1, 2))
    if not feasible.any():
        raise ValueError('No number split covers every class without breaking groups')
    per_class = by_label / counts.sum(axis=0)
    overall = by_label.sum(axis=2) / len(rows)
    cost = ((per_class - FRACTIONS[None, :, None]) ** 2).mean(axis=(1, 2))
    cost += ((overall - FRACTIONS) ** 2).mean(axis=1)
    best = assignments[np.argmin(np.where(feasible, cost, np.inf))]
    return {row['sequence_id']: (SPLITS[best[keys.index(groups[row['sequence_id']])]], groups[row['sequence_id']])
            for row in rows}


def observations(sequence):
    frames = sequence['frames']
    return (np.asarray([frame['features'] for frame in frames]),
            np.asarray([frame['timestamp'] for frame in frames]),
            np.asarray([frame['valid'] for frame in frames], dtype=bool))


def prepare(root, output):
    baseline = root / 'processed/candidates/alphabet_26_j460_v2_seed42'
    alphabet = root / 'processed/image-datasets/alphabet-v2-j460'
    numbers = root / 'processed/candidates/stage2_numbers_revised_20261108'
    verify(numbers)
    verify(alphabet, ['static-24/raw_static_features.npz', 'temporal-jz/manifest.jsonl'])
    _, _, _, _, _, alphabet_meta, _ = load_prepared(baseline)
    frozen = {sample: split for split in SPLITS for sample in alphabet_meta['sequenceIds'][split]}
    number_rows = manifest(numbers / 'manifest.jsonl')
    assigned = number_splits(number_rows)
    rows, shape, motion, motion_rows = [], [], [], []

    def add(sid, label, split, source, shape_input, motion_input=None, group=None):
        if motion_input is not None:
            motion_rows.append(len(rows))
            motion.append(motion_frames(*motion_input))
        rows.append(dict(sequence_id=sid, label=label, split=split, source=source, group=group or sid))
        shape.append(shape_input)

    with np.load(alphabet / 'static-24/raw_static_features.npz', allow_pickle=False) as data:
        for sid, label, x in zip(data['sample_ids'], data['labels'][data['y']], data['X']):
            add(str(sid), str(label), frozen[sid], 'alphabet-still', x)
    with ExitStack() as stack:
        archives = {}
        for row in manifest(alphabet / 'temporal-jz/manifest.jsonl'):
            path = Path(row['source_archive'])
            if not path.is_file():
                path = root / 'raw/image-datasets/alphabet-v1' / row['label'] / path.name
            if path not in archives:
                if digest(path) != row['archive_sha256']:
                    raise ValueError(f'J/Z archive changed: {path}')
                archives[path] = stack.enter_context(ZipFile(path))
            payload = archives[path].read(row['member'])
            if hashlib.sha256(payload).hexdigest() != row['sample_sha256']:
                raise ValueError(f'J/Z source changed: {row["sequence_id"]}')
            obs = observations(json.loads(payload)['sequences'][0])
            sid = row['sequence_id']
            add(sid, row['label'], frozen[sid], 'alphabet-motion', shape_frame(*obs), obs, row['source_recording'])
    print('Verified and prepared alphabet inputs', flush=True)
    with np.load(numbers / 'raw_sequences.npz', allow_pickle=False) as archive:
        data = dict(archive)
    for i, row in enumerate(number_rows):
        sid = row['sequence_id']
        assert data['sample_ids'][i] == sid
        selection = slice(*data['offsets'][i:i + 2])
        obs = tuple(data[key][selection] for key in ('X', 'timestamps_ms', 'valid'))
        split, group = assigned[sid]
        add(sid, row['label'], split, 'number', shape_frame(*obs), obs, group)
    backgrounds = [row for row in read_csv(root / 'manifests/training-samples.csv').values()
                   if row['label'] in ('REST', 'IDLE_MOVEMENT') and row['status'] == 'approved']
    signers = sorted({row['signer_id'] for row in backgrounds})
    if len(signers) != 3 or not all(signers):
        raise ValueError('Expected three verified background groups')
    background_splits = dict(zip(signers, np.random.default_rng(42).permutation(SPLITS).tolist()))
    for row in backgrounds:
        _, sequence, checksum, _ = load_sample(root / row['sample_path'], row['label'])
        assert checksum == row['sha256']
        obs = observations(sequence)
        add(row['sequence_id'], row['label'], background_splits[row['signer_id']], 'background',
            np.zeros(128), obs, row['signer_id'])

    ids = [row['sequence_id'] for row in rows]
    assert len(set(ids)) == len(rows) and set(frozen) == {row['sequence_id'] for row in rows if row['source'].startswith('alphabet')}
    shape = np.asarray(shape, dtype=np.float32)
    motion = np.asarray(motion, dtype=np.float32)
    shape_train = [i for i, row in enumerate(rows) if row['split'] == 'training' and row['label'] in SHAPES]
    motion_train = [i for i, j in enumerate(motion_rows) if rows[j]['split'] == 'training']
    assert all(np.any(shape[i]) for i, row in enumerate(rows) if row['label'] in SHAPES)
    for split in SPLITS:
        assert set(LABELS) <= {row['label'] for row in rows if row['split'] == split}
    scalers = {}
    for key, x, indices in (('shape', shape, shape_train), ('motion', motion, motion_train)):
        selected = x[indices].reshape(-1, x.shape[-1]).astype(np.float64)
        mean, std = selected.mean(axis=0), selected.std(axis=0)
        std[std < 1e-6] = 1
        scalers.update({key + '_mean': mean, key + '_std': std})
        x[:] = (x - mean) / std
        assert np.isfinite(x).all()
    output.mkdir(parents=True)
    (output / 'manifest.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
    write(output / 'labels.json', {label: i for i, label in enumerate(LABELS)})
    counts = {split: dict(Counter(row['label'] for row in rows if row['split'] == split)) for split in SPLITS}
    write(output / 'splits.json', dict(seed=42, counts=counts, alphabet='frozen baseline assignments',
                                     numbers='grouped by recording, collection batch or archive, and known signer/session',
                                     background='one recorded participant group per split'))
    write(output / 'feature_schema.json', dict(
        shape='128 wrist-relative palm-scaled hand features; one observed frame per clip',
        motion='40 timestamp-resampled frames; 164 collector features + 6 palm normal channels + tracking validity',
        shape_labels=SHAPES, motion_labels=MOTION, scaler='training only', seed=42))
    np.savez_compressed(output / 'prepared_data.npz', shape=shape, motion=motion, motion_rows=motion_rows)
    np.savez_compressed(output / 'scalers.npz', **scalers)
    shutil.copy2(__file__, output / 'train_stage2.py')
    write(output / 'artifact_checksums.json', {p.name: digest(p) for p in output.iterdir()})
    print({split: dict(vocabulary=sum(counts[split].get(l, 0) for l in LABELS),
                      numbers=sum(counts[split].get(l, 0) for l in NUMBERS),
                      background=sum(counts[split].get(l, 0) for l in ('REST', 'IDLE_MOVEMENT')))
           for split in SPLITS}, flush=True)


def read_inputs(path):
    verify(path)
    rows = manifest(path / 'manifest.jsonl')
    with np.load(path / 'prepared_data.npz', allow_pickle=False) as archive:
        shape, motion, motion_rows = (archive[k] for k in ('shape', 'motion', 'motion_rows'))
    assert shape.shape == (len(rows), 128) and motion.shape == (len(motion_rows), 40, 171)
    assert np.isfinite(shape).all() and np.isfinite(motion).all()
    return rows, shape, motion, motion_rows


def train(prepared, output, seed):
    rows, shape, motion, motion_rows = read_inputs(prepared)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(seed)
    output.mkdir(parents=True)
    for name in ('labels.json', 'feature_schema.json', 'splits.json', 'scalers.npz', 'manifest.jsonl', 'train_stage2.py'):
        shutil.copy2(prepared / name, output / name)
    write(output / 'run.json', dict(seed=seed, prepared=str(prepared),
                                  input_checksums=digest(prepared / 'artifact_checksums.json')))

    def fit(name, x, targets, partitions, labels, layers):
        path = output / f'{name}.keras'
        model = tf.keras.Sequential([tf.keras.Input(shape=x.shape[1:]), *layers,
            tf.keras.layers.Dropout(.25), tf.keras.layers.Dense(len(labels), activation='softmax')])
        model.compile(optimizer=tf.keras.optimizers.Adam(.001),
                      loss='sparse_categorical_crossentropy', metrics=['accuracy'])
        tr, va, te = partitions
        counts = np.bincount(targets[tr], minlength=len(labels))
        weights = np.sqrt(counts.mean() / counts)
        model.fit(x[tr], targets[tr], validation_data=(x[va], targets[va]), epochs=100, batch_size=32,
                  class_weight=dict(enumerate(map(float, weights))),
                  callbacks=[tf.keras.callbacks.ModelCheckpoint(path, monitor='val_loss', save_best_only=True),
                             tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=15),
                             tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', patience=5, factor=.5),
                             tf.keras.callbacks.CSVLogger(output / f'{name}_epochs.csv')], verbose=2)
        model = tf.keras.models.load_model(path)
        pred = model.predict(x[te], verbose=0).argmax(axis=1)
        write(output / f'{name}_evaluation.json', evaluate(targets[te], pred, labels))
        return model

    labels = np.asarray([row['label'] for row in rows])
    splits = np.asarray([row['split'] for row in rows])
    shape_y = np.asarray([SHAPES.index(label) if label in SHAPES else -1 for label in labels])
    motion_y = np.asarray([MOTION.index(labels[i]) if labels[i] in MOTION else 0 for i in motion_rows])
    shape_splits = [np.flatnonzero((splits == split) & (shape_y >= 0)) for split in SPLITS]
    motion_splits = [np.flatnonzero(splits[motion_rows] == split) for split in SPLITS]
    shape_model = fit('handshape', shape, shape_y, shape_splits, SHAPES, [
        tf.keras.layers.Dense(128, activation='relu'), tf.keras.layers.Dense(64, activation='relu')])
    motion_model = fit('motion', motion, motion_y, motion_splits, MOTION, [
        tf.keras.layers.GRU(64), tf.keras.layers.Dense(32, activation='relu')])
    va, te = motion_splits[1:]
    validation = motion_model.predict(motion[va], verbose=0)
    thresholds = {}
    for i, label in enumerate(MOTION[1:], 1):
        thresholds[label] = None
        for threshold in np.arange(.60, 1, .01):
            mask = accepted(validation, i, threshold)
            if mask.sum() >= 3 and (motion_y[va][mask] == i).mean() >= .95:
                thresholds[label] = round(float(threshold), 2)
                break
    write(output / 'acceptance.json', dict(motion_thresholds=thresholds, margin=.15,
        policy='validation precision >= .95 with at least three accepted; null disables emission'))
    test = np.flatnonzero((splits == 'test') & np.isin(labels, LABELS))
    prediction = np.asarray(SHAPES)[shape_model.predict(shape[test], verbose=0).argmax(axis=1)]
    positions = {row: i for i, row in enumerate(test)}
    temporal = motion_model.predict(motion[te], verbose=0)
    background_false = Counter()
    for i, label in enumerate(MOTION[1:], 1):
        threshold = thresholds[label]
        if threshold is None:
            continue
        for row in motion_rows[te[accepted(temporal, i, threshold)]]:
            if row in positions:
                prediction[positions[row]] = label
            else:
                background_false[labels[row]] += 1
    truth = labels[test]
    report = evaluate(truth, prediction, LABELS)
    letter = np.isin(truth, LABELS[:26])
    number_pred = np.isin(prediction, NUMBERS)
    report.update(letter_to_number=int((letter & number_pred).sum()),
                  number_to_letter=int((~letter & ~number_pred).sum()),
                  background_motion_false_accepts={l: background_false[l] for l in ('REST', 'IDLE_MOVEMENT')},
                  background_test_counts={l: int((labels[motion_rows[te]] == l).sum()) for l in ('REST', 'IDLE_MOVEMENT')},
                  scope='Offline isolated clips; no live capture, segmentation, or unseen-signer claim.')
    write(output / 'evaluation.json', report)
    np.savez_compressed(output / 'predictions.npz', truth=truth, prediction=prediction,
                        sample_ids=[rows[i]['sequence_id'] for i in test])
    write(output / 'artifact_checksums.json', {p.name: digest(p) for p in output.iterdir()})


def accepted(probabilities, index, threshold):
    scores = np.sort(probabilities, axis=1)
    return ((probabilities.argmax(axis=1) == index) & (probabilities[:, index] >= threshold)
            & ((scores[:, -1] - scores[:, -2]) >= .15))


def evaluate(truth, prediction, labels):
    classes = range(len(labels)) if np.issubdtype(truth.dtype, np.integer) else labels
    return dict(classification=classification_report(truth, prediction, labels=classes,
                                                       target_names=labels, output_dict=True, zero_division=0),
                confusion=confusion_matrix(truth, prediction, labels=classes).tolist())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('prepare', 'verify', 'train'))
    parser.add_argument('--dataset-root', type=Path)
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--seed', type=int, choices=[42], default=42)
    args = parser.parse_args()
    if args.mode == 'prepare':
        if args.dataset_root is None or args.prepared.exists():
            parser.error('prepare requires --dataset-root and a new --prepared directory')
        prepare(args.dataset_root.resolve(), args.prepared.resolve())
    elif args.mode == 'verify':
        rows, shape, motion, _ = read_inputs(args.prepared)
        print(f'Verified {len(rows)} manifest rows, shape {shape.shape}, motion {motion.shape}')
    else:
        if args.output is None or args.output.exists():
            parser.error('train requires a new --output directory')
        train(args.prepared.resolve(), args.output.resolve(), args.seed)


if __name__ == '__main__':
    main()
