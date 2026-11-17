"""Freeze or train one joint handshape and motion checkpoint for Stage 2."""

import argparse
import json
from pathlib import Path
import shutil

import numpy as np

from train_stage2 import LABELS, NUMBERS, SPLITS, digest, evaluate, read_inputs, verify, write


def aligned_predictions(path, sample_ids, key):
    with np.load(path, allow_pickle=False) as data:
        predictions = (np.asarray(LABELS[:26])[data['probabilities'].argmax(axis=1)]
                       if key == 'probabilities' else data[key])
        by_id = dict(zip(data['sample_ids'].tolist(), predictions.tolist(), strict=True))
    if len(by_id) != len(predictions) or set(by_id) != set(sample_ids):
        raise ValueError(f'Test cohort differs: {path}')
    return np.asarray([by_id[sid] for sid in sample_ids])


def prepare(source, output, separate, alphabet):
    rows, shape, motion, motion_rows = read_inputs(source)
    vocabulary = np.asarray([row['label'] in LABELS for row in rows])
    clip_rows = np.flatnonzero(vocabulary)
    video = vocabulary[motion_rows]
    video_rows = np.searchsorted(clip_rows, motion_rows[video])
    rows = [rows[i] for i in clip_rows]
    labels = np.asarray([LABELS.index(row['label']) for row in rows])
    ids = np.asarray([row['sequence_id'] for row in rows])
    split = np.asarray([row['split'] for row in rows])
    test = np.flatnonzero(split == 'test')
    letter_test = labels[test] < 26
    verify(separate, ['predictions.npz'])
    verify(alphabet, ['predictions.npz'])
    separate_pred = aligned_predictions(separate / 'predictions.npz', ids[test], 'prediction')
    alphabet_pred = aligned_predictions(alphabet / 'predictions.npz', ids[test][letter_test], 'probabilities')
    output.mkdir(parents=True)
    np.savez_compressed(output / 'joint_data.npz', shape=shape[clip_rows], motion=motion[video],
                        video_rows=video_rows, y=labels, split=split, sample_ids=ids,
                        separate_prediction=separate_pred, alphabet_prediction=alphabet_pred)
    for name in ('labels.json', 'scalers.npz'):
        shutil.copy2(source / name, output / name)
    (output / 'manifest.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
    write(output / 'config.json', dict(seed=42, output_labels=LABELS,
        source_package=str(source), source_checksums=digest(source / 'artifact_checksums.json'),
        baseline_predictions_sha256={p.parent.name: digest(p) for p in
            (separate / 'predictions.npz', alphabet / 'predictions.npz')},
        splits={name: int((split == name).sum()) for name in SPLITS},
        motion_missing='Zero tensor with an explicit gate; still images have no temporal observations.',
        train_augmentation='Each ONE–NINE training clip also contributes a handshape-only view. The two views share one sample weight.',
        scope='Closed-set 36-label offline comparison; background and live recognition are outside this run.'))
    shutil.copy2(__file__, output / 'train_stage2_joint.py')
    seal(output)


def seal(path):
    write(path / 'artifact_checksums.json', {p.name: digest(p) for p in path.iterdir()
                                             if p.is_file() and p.name != 'artifact_checksums.json'})


def load_joint(path):
    verify(path)
    with np.load(path / 'joint_data.npz', allow_pickle=False) as arrays:
        data = dict(arrays)
    n = len(data['y'])
    video_rows = data['video_rows']
    assert data['shape'].shape == (n, 128)
    assert data['motion'].shape == (len(video_rows), 40, 171)
    assert np.isfinite(data['shape']).all() and np.isfinite(data['motion']).all()
    assert len(set(data['sample_ids'])) == n and len(data['split']) == n
    assert np.all(np.diff(video_rows) > 0) and 0 <= video_rows[0] <= video_rows[-1] < n
    for split in SPLITS:
        assert set(data['y'][data['split'] == split]) == set(range(36))
    assert np.isin(np.flatnonzero(np.isin(data['y'], [LABELS.index(x) for x in ('J', 'Z', 'TEN')])), video_rows).all()
    return data


def build_model(tf):
    layers = tf.keras.layers
    hand = tf.keras.Input((128,), name='handshape')
    video = tf.keras.Input((40, 171), name='motion')
    has_video = tf.keras.Input((1,), name='motion_available')
    hand_embedding = layers.Dense(96, activation='relu')(hand)
    motion_embedding = layers.GRU(48)(layers.Masking(mask_value=0)(video))
    motion_embedding = layers.Multiply()([motion_embedding, has_video])
    fused = layers.Concatenate()([hand_embedding, motion_embedding])
    fused = layers.Dropout(.25)(layers.Dense(96, activation='relu')(fused))
    return tf.keras.Model([hand, video, has_video], layers.Dense(36, activation='softmax')(fused))


def train(prepared, output, seed):
    data = load_joint(prepared)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(seed)
    shape, y = data['shape'], data['y']
    tr, va, te = [np.flatnonzero(data['split'] == name) for name in SPLITS]
    video_index = np.full(len(y), -1, dtype=np.int64)
    video_index[data['video_rows']] = np.arange(len(data['video_rows']))

    def inputs(indices, use_motion=True):
        video = np.zeros((len(indices), 40, 171), dtype=np.float32)
        mapping = video_index[indices]
        present = (mapping >= 0) & use_motion
        video[present] = data['motion'][mapping[present]]
        return [shape[indices], video, present[:, None].astype(np.float32)]

    holds = np.isin(y[tr], [LABELS.index(label) for label in NUMBERS[:-1]]) & (video_index[tr] >= 0)
    augmented = tr[holds]
    weights = np.sqrt(len(tr) / (len(LABELS) * np.bincount(y[tr], minlength=len(LABELS))))[y[tr]]
    weights[holds] *= .5
    x = [np.concatenate([main, shape_only]) for main, shape_only in zip(inputs(tr), inputs(augmented, False))]
    weights = np.concatenate([weights, weights[holds]])
    model = build_model(tf)
    model.compile(optimizer=tf.keras.optimizers.Adam(.001),
                  loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    output.mkdir(parents=True)
    for name in ('labels.json', 'config.json', 'scalers.npz', 'train_stage2_joint.py'):
        shutil.copy2(prepared / name, output / name)
    write(output / 'run.json', dict(seed=seed, prepared=str(prepared),
                                  prepared_checksums=digest(prepared / 'artifact_checksums.json')))
    checkpoint = output / 'joint.keras'
    history = model.fit(x, y[np.concatenate([tr, augmented])], sample_weight=weights,
        validation_data=(inputs(va), y[va]), epochs=100, batch_size=32, verbose=2,
        callbacks=[tf.keras.callbacks.ModelCheckpoint(checkpoint, monitor='val_loss', save_best_only=True),
                   tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=15),
                   tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', patience=5, factor=.5),
                   tf.keras.callbacks.CSVLogger(output / 'epochs.csv')])
    model = tf.keras.models.load_model(checkpoint)
    probabilities = model.predict(inputs(te), verbose=0)
    truth = np.asarray(LABELS)[y[te]]
    predicted = np.asarray(LABELS)[probabilities.argmax(axis=1)]
    letters = y[te] < 26
    number_predictions = np.isin(predicted, NUMBERS)
    report = evaluate(truth, predicted, LABELS)
    report.update(best_epoch=int(np.argmin(history.history['val_loss'])) + 1,
        letter_to_number=int((letters & number_predictions).sum()),
        number_to_letter=int((~letters & ~number_predictions).sum()),
        separate_baseline=evaluate(truth, data['separate_prediction'], LABELS),
        protected_letters_joint=evaluate(truth[letters], predicted[letters], LABELS[:26]),
        protected_letters_seed43=evaluate(truth[letters], data['alphabet_prediction'], LABELS[:26]))
    write(output / 'evaluation.json', report)
    np.savez_compressed(output / 'predictions.npz', probabilities=probabilities,
                        truth=truth, prediction=predicted, sample_ids=data['sample_ids'][te])
    seal(output)
    print(f'Finished. Best validation checkpoint at epoch {report["best_epoch"]}: {checkpoint}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('prepare', 'verify', 'train'))
    parser.add_argument('--prepared', type=Path, required=True)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--separate', type=Path)
    parser.add_argument('--alphabet', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--seed', type=int, choices=(42, 43, 44), default=42)
    args = parser.parse_args()
    if args.mode == 'prepare':
        if args.prepared.exists() or any(p is None for p in (args.source, args.separate, args.alphabet)):
            parser.error('prepare requires a new --prepared path plus --source, --separate and --alphabet')
        prepare(args.source.resolve(), args.prepared.resolve(), args.separate.resolve(), args.alphabet.resolve())
    elif args.mode == 'train':
        if args.output is None or args.output.exists():
            parser.error('train requires a new --output path')
        train(args.prepared.resolve(), args.output.resolve(), args.seed)
    data = load_joint(args.prepared)
    print(f'Verified {len(data["y"])} samples and {len(data["video_rows"])} real motion inputs.')


if __name__ == '__main__':
    main()
