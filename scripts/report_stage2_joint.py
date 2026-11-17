"""Verify and report the completed Stage 2 joint runs without retraining."""

import argparse
import csv
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def verify(path):
    checksums = read(path / 'artifact_checksums.json')
    for name, expected in checksums.items():
        if digest(path / name) != expected:
            raise ValueError(f'Checksum mismatch: {path / name}')
    return checksums


def scores(truth, prediction, labels):
    letters = np.isin(truth, labels[:26])
    correct = truth == prediction
    by_class = {}
    for label in labels:
        actual, selected = truth == label, prediction == label
        tp = int((actual & selected).sum())
        support, predicted = int(actual.sum()), int(selected.sum())
        by_class[label] = dict(support=support, correct=tp, precision=tp / predicted if predicted else 0,
                               recall=tp / support if support else 0, f1=2 * tp / (support + predicted))
    return dict(accuracy=float(correct.mean()), macro_f1=float(np.mean([m['f1'] for m in by_class.values()])),
                letters=float(correct[letters].mean()), numbers=float(correct[~letters].mean()),
                letter_to_number=int((letters & ~np.isin(prediction, labels[:26])).sum()),
                number_to_letter=int((~letters & np.isin(prediction, labels[:26])).sum()), per_class=by_class)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', required=True, type=Path)
    parser.add_argument('--runs-dir', type=Path, help='Folder containing the three completed seed runs')
    args = parser.parse_args()
    root = args.dataset_root.resolve()
    parent = args.runs_dir.resolve() if args.runs_dir else root / 'models/candidates/alphabet_numbers_36_joint_v1'
    prepared = root / 'processed/candidates/alphabet_numbers_36_joint_v1_seed42'
    verify(prepared)
    label_map = read(prepared / 'labels.json')
    labels = sorted(label_map, key=label_map.get)
    with np.load(prepared / 'joint_data.npz', allow_pickle=False) as data:
        frozen = dict(data)
    val, test = (np.flatnonzero(frozen['split'] == name) for name in ('validation', 'test'))
    truth = np.asarray(labels)[frozen['y'][test]]
    ids = frozen['sample_ids'][test]
    separate = frozen['separate_prediction']
    letter_mask = frozen['y'][test] < 26
    alphabet_baseline = float((truth[letter_mask] == frozen['alphabet_prediction']).mean())
    video_index = np.full(len(frozen['y']), -1)
    video_index[frozen['video_rows']] = np.arange(len(frozen['video_rows']))
    motion = np.zeros((len(val), 40, 171), dtype=np.float32)
    present = video_index[val] >= 0
    motion[present] = frozen['motion'][video_index[val][present]]
    inputs = [frozen['shape'][val], motion, present[:, None].astype(np.float32)]
    validation_truth = frozen['y'][val]
    import tensorflow as tf

    runs, histories, predictions = {}, {}, {}
    for seed in (42, 43, 44):
        folder = parent / f'alphabet_numbers_36_joint_v1_seed{seed}'
        checksums = verify(folder)
        provenance = read(folder / 'run.json')
        assert provenance['seed'] == seed and provenance['prepared_checksums'] == digest(prepared / 'artifact_checksums.json')
        assert digest(folder / 'scalers.npz') == digest(prepared / 'scalers.npz')
        with (folder / 'epochs.csv').open(newline='') as handle:
            rows = list(csv.DictReader(handle))
        history = {key: [float(row[key]) for row in rows] for key in rows[0] if key != 'epoch'}
        best = int(np.argmin(history['val_loss']))
        evaluation = read(folder / 'evaluation.json')
        assert best + 1 == evaluation['best_epoch']
        with np.load(folder / 'predictions.npz', allow_pickle=False) as data:
            np.testing.assert_array_equal(data['sample_ids'], ids)
            np.testing.assert_array_equal(data['truth'], truth)
            predicted = data['prediction']
            np.testing.assert_array_equal(predicted, np.asarray(labels)[data['probabilities'].argmax(axis=1)])
        result = scores(truth, predicted, labels)
        assert abs(result['macro_f1'] - evaluation['classification']['macro avg']['f1-score']) < 1e-10
        model = tf.keras.models.load_model(folder / 'joint.keras', compile=False)
        q = model.predict(inputs, verbose=0)
        assert q.shape == (len(val), 36) and np.isfinite(q).all() and np.allclose(q.sum(axis=1), 1)
        # Keras computes loss from logits, so preserve confidently wrong scores.
        true_probabilities = q[np.arange(len(val)), validation_truth].astype(np.float64)
        loss = -np.log(np.maximum(true_probabilities, np.finfo(np.float64).tiny)).mean()
        assert np.isclose(loss, history['val_loss'][best], atol=1e-5), (seed, loss, history['val_loss'][best])
        assert np.isclose((q.argmax(axis=1) == validation_truth).mean(), history['val_accuracy'][best], atol=1e-6)
        result.update(best_epoch=best + 1, epochs_run=len(rows), validation_loss=history['val_loss'][best],
                      validation_accuracy=history['val_accuracy'][best],
                      joint_only_correct=int(((predicted == truth) & (separate != truth)).sum()),
                      separate_only_correct=int(((separate == truth) & (predicted != truth)).sum()))
        histories[seed], runs[seed], predictions[f'seed{seed}'] = history, result, predicted
        write(folder / 'history.json', history)
        np.savez_compressed(folder / 'validation_predictions.npz', probabilities=q, y_true=validation_truth,
                            sample_ids=frozen['sample_ids'][val])
        lines = [f'# Stage 2 joint seed {seed}', '',
                 f'Best checkpoint epoch {best + 1}/{len(rows)}. Validation loss {result["validation_loss"]:.5f}.',
                 f'Held-out accuracy **{result["accuracy"]:.2%}** and macro F1 **{result["macro_f1"]:.2%}**.',
                 '', 'Closed-set isolated clips. Live recognition and unseen-signer performance are unverified.',
                 '', '| Label | Clips | Precision | Recall | F1 |', '|---|---:|---:|---:|---:|']
        for label, m in result['per_class'].items():
            lines.append(f'| {label} | {m["support"]} | {m["precision"]:.2%} | {m["recall"]:.2%} | {m["f1"]:.2%} |')
        (folder / 'REPORT.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        for name in ('history.json', 'validation_predictions.npz', 'REPORT.md'):
            checksums[name] = digest(folder / name)
        write(folder / 'artifact_checksums.json', checksums)
        verify(folder)
        print(f'Verified seed {seed}, including validation checkpoint replay', flush=True)
    selected = min(runs, key=lambda seed: runs[seed]['validation_loss'])
    baseline = scores(truth, separate, labels)
    write(parent / 'comparison-cohort.json', dict(ids=ids.tolist(), labels=truth.tolist(),
        protected_alphabet_count=int(letter_mask.sum()), validation_count=len(val),
        prepared_checksums=digest(prepared / 'artifact_checksums.json')))
    write(parent / 'COMPARISON.json', dict(runs=runs, validation_selected_seed=selected,
        two_model_baseline=baseline, alphabet_seed43_accuracy=alphabet_baseline))
    np.savez_compressed(parent / 'comparison-predictions.npz', sample_ids=ids, truth=truth,
                        two_model_seed42=separate, alphabet_seed43=frozen['alphabet_prediction'],
                        alphabet_mask=letter_mask, **predictions)
    lines = ['# Stage 2 joint model comparison', '',
             f'**Validation-selected checkpoint: seed {selected}.** All runs share {len(ids):,} held-out clips.',
             '', '| Run | Validation loss | Test accuracy | Macro F1 | Letter accuracy | Number accuracy |',
             '|---|---:|---:|---:|---:|---:|']
    for name, result in [(f'Joint seed {s}', r) for s, r in runs.items()] + [('Two-model seed 42', baseline)]:
        loss = f'{result["validation_loss"]:.5f}' if 'validation_loss' in result else '—'
        lines.append(f'| {name} | {loss} | {result["accuracy"]:.2%} | {result["macro_f1"]:.2%} | '
                     f'{result["letters"]:.2%} | {result["numbers"]:.2%} |')
    lines += ['', f'Alphabet-only seed 43 scored {alphabet_baseline:.2%} on the protected letter subset.',
              '', '| Run | J correct | Z correct | TEN correct | Letter → number | Number → letter |',
              '|---|---:|---:|---:|---:|---:|']
    for name, result in [(f'Joint seed {s}', r) for s, r in runs.items()] + [('Two-model seed 42', baseline)]:
        motion_scores = [result['per_class'][label] for label in ('J', 'Z', 'TEN')]
        values = ' | '.join(f'{m["correct"]}/{m["support"]}' for m in motion_scores)
        lines.append(f'| {name} | {values} | {result["letter_to_number"]} | {result["number_to_letter"]} |')
    lines += ['', 'All scores describe isolated, closed-set clips. Live routing, background rejection, '
              'and unseen-signer performance require separate evaluation.']
    (parent / 'REPORT_COMPARISON.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), constrained_layout=True)
    for seed, history in histories.items():
        epoch = np.arange(1, len(history['val_loss']) + 1)
        for ax, key, scale in zip(axes, ('val_loss', 'val_accuracy'), (1, 100)):
            values = np.asarray(history[key]) * scale
            ax.plot(epoch, values, label=f'Seed {seed}')
            best = runs[seed]['best_epoch']
            ax.scatter(best, values[best - 1], s=24)
    axes[0].set(title='Validation loss', xlabel='Epoch', ylabel='Cross-entropy')
    axes[1].set(title='Validation accuracy', xlabel='Epoch', ylabel='Accuracy (%)')
    for ax in axes:
        ax.grid(alpha=.2)
        ax.legend()
    fig.savefig(parent / 'learning-curves.png', dpi=160)
    plt.close(fig)
    script = parent / Path(__file__).name
    if Path(__file__).resolve() != script.resolve():
        shutil.copy2(__file__, script)
    names = ('COMPARISON.json', 'comparison-cohort.json', 'comparison-predictions.npz',
             'REPORT_COMPARISON.md', 'learning-curves.png', script.name)
    write(parent / 'comparison-artifact-checksums.json', {name: digest(parent / name) for name in names})
    print(parent / 'REPORT_COMPARISON.md', flush=True)


if __name__ == '__main__':
    main()
