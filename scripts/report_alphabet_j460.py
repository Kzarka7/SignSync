"""Verify all alphabet J-refresh runs and write a paired checkpoint comparison."""
from pathlib import Path
from collections import Counter
import hashlib
import json
import shutil

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix


def read(path):
    return json.loads(path.read_bytes())


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def metrics(y, q, labels):
    # Avoid sklearn's float32-epsilon clipping, which understates loss for a
    # confidently wrong sample. Keras uses the full softmax/logit cross entropy.
    true_p = q[np.arange(len(y)), y].astype(np.float64)
    loss = float(-np.log(np.maximum(true_p, np.finfo(np.float64).tiny)).mean())
    return dict(accuracy=float((q.argmax(1) == y).mean()), loss=loss,
        macroF1=float(classification_report(y, q.argmax(1), labels=range(26), output_dict=True, zero_division=0)['macro avg']['f1-score']),
        classificationReport=classification_report(y, q.argmax(1), labels=range(26), target_names=labels, output_dict=True, zero_division=0),
        confusionMatrix=confusion_matrix(y, q.argmax(1), labels=range(26)).tolist())


def main():
    root = Path(__file__).resolve().parents[2] / 'SignSync Dataset'
    parent = root / 'models/candidates/alphabet_26_j460_v2'
    prepared = root / 'processed/candidates/alphabet_26_j460_v2_seed42'
    source = root / 'processed/image-datasets/alphabet-v2-j460'
    old_folder = root / 'models/candidates/alphabet_26_mixed_v1/alphabet_26_mixed_v1_seed42'
    old = read(old_folder / 'evaluation.json')
    frozen = read(prepared / 'metadata.json')
    labels = frozen['labels']
    cohort = read(parent / 'comparison-cohort.json')
    cohort_ids = cohort['ids']
    with np.load(parent / 'previous-model-comparison-predictions.npz', allow_pickle=False) as arrays:
        previous_q, cohort_y = arrays['probabilities'].copy(), arrays['y_true'].copy()
        assert arrays['sample_ids'].tolist() == cohort_ids
    previous_shared = metrics(cohort_y, previous_q, labels)
    prior_repairs = read(parent / 'COMPARISON.json').get('verification', {}).get('staleChecksumSelfEntriesRemoved', []) if (parent / 'COMPARISON.json').exists() else []
    runs, repairs, new_probabilities = {}, list(prior_repairs), {}
    for seed in (42, 43, 44):
        folder = parent / f'alphabet_26_j460_v2_seed{seed}'
        checksums = read(folder / 'artifact_checksums.json')
        for name, expected in checksums.items():
            if name != 'artifact_checksums.json':
                assert digest(folder / name) == expected, (seed, name)
        # Seed 42 and an already-running seed 43 may have the old writer's
        # invalid self-reference. All other artifacts must verify before repair.
        if 'artifact_checksums.json' in checksums:
            del checksums['artifact_checksums.json']
            (folder / 'artifact_checksums.json').write_text(json.dumps(checksums, indent=2) + '\n', encoding='utf-8')
            if seed not in repairs:
                repairs.append(seed)
        assert digest(folder / 'prepared_data.npz') == digest(prepared / 'prepared_data.npz')
        assert digest(folder / 'scalers.npz') == digest(prepared / 'scalers.npz')
        evaluation = read(folder / 'evaluation.json')
        metadata = evaluation['metadata']
        assert metadata['seed'] == seed and metadata['sequenceIds'] == frozen['sequenceIds']
        assert metadata['sourceSha256'] == frozen['sourceSha256'] and metadata['labels'] == labels
        history = read(folder / 'history.json')
        assert len(history['loss']) == evaluation['epochsRun']
        assert int(np.argmin(history['val_loss'])) + 1 == evaluation['bestEpoch']
        with np.load(folder / 'predictions.npz', allow_pickle=False) as arrays:
            q, y, ids = [arrays[k].copy() for k in ('probabilities', 'y_true', 'sample_ids')]
        assert ids.tolist() == frozen['sequenceIds']['test']
        assert q.shape == (2522, 26) and np.isfinite(q).all() and np.allclose(q.sum(1), 1)
        recomputed = metrics(y, q, labels)
        assert abs(recomputed['accuracy'] - evaluation['testAccuracy']) < 1e-6
        assert abs(recomputed['loss'] - evaluation['testLoss']) < 1e-5
        assert abs(recomputed['macroF1'] - evaluation['macroF1']) < 1e-10
        assert recomputed['confusionMatrix'] == evaluation['confusionMatrix']
        with np.load(folder / 'validation_predictions.npz', allow_pickle=False) as arrays:
            vq, vy = arrays['probabilities'].copy(), arrays['y_true'].copy()
            assert arrays['sample_ids'].tolist() == frozen['sequenceIds']['validation']
        vm = metrics(vy, vq, labels)
        assert abs(vm['loss'] - min(history['val_loss'])) < 1e-5
        lookup = {sid: i for i, sid in enumerate(ids.tolist())}
        selected = [lookup[sid] for sid in cohort_ids]
        np.testing.assert_array_equal(y[selected], cohort_y)
        shared_q = q[selected]
        shared = metrics(cohort_y, shared_q, labels)
        old_correct, new_correct = previous_q.argmax(1) == cohort_y, shared_q.argmax(1) == cohort_y
        paired = dict(previousWrongNewCorrect=int((~old_correct & new_correct).sum()),
            previousCorrectNewWrong=int((old_correct & ~new_correct).sum()),
            bothCorrect=int((old_correct & new_correct).sum()), bothWrong=int((~old_correct & ~new_correct).sum()))
        confusions = [(labels[i], labels[j], n) for i, row in enumerate(evaluation['confusionMatrix'])
            for j, n in enumerate(row) if i != j and n]
        confusions.sort(key=lambda item: (-item[2], item[0], item[1]))
        runs[str(seed)] = dict(test=recomputed, validation=vm, shared=shared, paired=paired,
            bestEpoch=evaluation['bestEpoch'], epochsRun=evaluation['epochsRun'],
            bestValidationLoss=float(min(history['val_loss'])), topConfusions=confusions,
            checkpointSha256=digest(folder / 'best_model.keras'))
        new_probabilities[str(seed)] = shared_q
    validation_pick = min(runs, key=lambda seed: runs[seed]['bestValidationLoss'])
    summary = dict(runs=runs, previousOwnTest={k: old[k] for k in ('testAccuracy', 'testLoss', 'macroF1', 'bestEpoch', 'epochsRun')},
        previousShared=previous_shared, cohort=cohort, meanNewTestAccuracy=float(np.mean([r['test']['accuracy'] for r in runs.values()])),
        sampleStdNewTestAccuracy=float(np.std([r['test']['accuracy'] for r in runs.values()], ddof=1)),
        validationSelectedSeed=int(validation_pick), validationSelectionRule='Lowest checkpoint validation loss; test metrics not used to select.',
        verification=dict(identicalFrozenArraysSplitsScalers=True, savedMetricsRecomputed=True,
            oldCheckpointPredictionsReproduced=read(parent / 'previous-model-comparison.json')['originalCheckpointPredictionsReproduced'],
            staleChecksumSelfEntriesRemoved=repairs, seed42SelfEntryPreviouslyRepaired=True),
        limitations=['Own-test old/new scores use different test samples and are not a paired experiment.',
            'Shared-cohort eligibility excludes exact recordings seen in old training or validation. Related sessions/signers may still overlap.',
            'Static image/temporal clip length shortcut and wrist-relative trajectory loss are unchanged.',
            'No live intended-letter annotations, unseen-person test, background or transition evaluation. No deployment claim.'])
    (parent / 'COMPARISON.json').write_text(json.dumps(summary, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    lines = ['# Alphabet J-refresh: seeds 42, 43 and 44', '',
        'All three runs are complete. This report compares the new `alphabet_26_j460_v2` experiment with `alphabet_26_mixed_v1_seed42`, the previous alphabet checkpoint. It does not compare against the 57-class sign models.', '',
        f"New mean test accuracy: **{summary['meanNewTestAccuracy']:.2%}**, sample standard deviation **{summary['sampleStdNewTestAccuracy'] * 100:.3f} percentage points** across three seeds.", '',
        '## New experiment', '',
        'Same architecture, optimizer and callbacks as the previous alphabet pilot: masked GRU(64), Dense(32), dropout 0.30/0.20, Adam 0.001, batch 32, maximum 100 epochs. Stop after 15 consecutive epochs without lower validation loss; halve learning rate after 5, minimum 0.00001. Each run evaluates its minimum-validation-loss checkpoint.', '',
        'J is replaced by the 460 samples from current raw/J (215 retained reprocessed recordings + 245 new recordings). The removed 235 old samples are not reintroduced. Static samples remain 9,180; Z remains 450. Total 10,090 versus 10,080 previously. More new recordings, rather than a large increase in total count, is the data change.', '',
        'All seeds reuse exactly the frozen 6,054 / 1,514 / 2,522 sample partitions and training-only scalers (60/15/25, split seed 42). J counts: 276 / 69 / 115. Z counts: 270 / 68 / 112. Seed changes initialization, dropout and training order, not the split.', '',
        '| Seed | Best epoch | Epochs run | Validation accuracy | Validation loss | Test accuracy | Test loss | Macro F1 |',
        '|---|---:|---:|---:|---:|---:|---:|---:|']
    for seed, r in runs.items():
        lines.append(f"| {seed} | {r['bestEpoch']} | {r['epochsRun']} | {r['validation']['accuracy']:.2%} | {r['bestValidationLoss']:.5f} | {r['test']['accuracy']:.2%} | {r['test']['loss']:.5f} | {r['test']['macroF1']:.5f} |")
    lines += ['', f"Seed **{validation_pick}** has the lowest validation loss and is the candidate to try first. This choice does not use test accuracy. No Recognition Lab or deployed model was changed.", '',
        '## Comparison with previous alphabet model', '',
        f"Previous own-test accuracy: **{old['testAccuracy']:.2%}**, test loss {old['testLoss']:.5f}, macro F1 {old['macroF1']:.5f}, best epoch {old['bestEpoch']}. These are different test sets; use the following paired comparison for a closer assessment.", '',
        f"A fixed **{len(cohort_ids):,}-sample cohort** was drawn from the new test set, across all 26 labels. Static samples must also be in old test. Temporal source fingerprints must be absent from old training and validation. There are 70 J examples: 54 genuinely new recording fingerprints and 16 retained recordings that were old-test examples. The previous model uses its original scalers; new models use the frozen new training scalers. Previous saved-checkpoint predictions were reproduced numerically before comparison.", '',
        '| Model | Shared accuracy | Shared macro F1 | J correct / 70 | J precision | Z recall | J predicted T |',
        '|---|---:|---:|---:|---:|---:|---:|']
    for name, r in [('Previous seed 42', previous_shared)] + [(f'New seed {seed}', r['shared']) for seed, r in runs.items()]:
        jr = r['classificationReport']['J']
        lines.append(f"| {name} | {r['accuracy']:.2%} | {r['macroF1']:.5f} | {r['confusionMatrix'][9][9]} / 70 | {jr['precision']:.2%} | {r['classificationReport']['Z']['recall']:.2%} | {r['confusionMatrix'][9][19]} |")
    lines += ['', 'Paired error changes on that same cohort:', '', '| New seed | Old wrong → new correct | Old correct → new wrong |', '|---|---:|---:|']
    for seed, r in runs.items():
        lines.append(f"| {seed} | {r['paired']['previousWrongNewCorrect']} | {r['paired']['previousCorrectNewWrong']} |")
    old_j_errors = read(parent / 'previous-J-errors.json')
    lines += ['', 'Previous-model J errors on the shared cohort (clip numbers refer to current raw/J-clips):', '',
        '| Clip | Tracked hand | Previous | New 42 | New 43 | New 44 |', '|---|---|---|---|---|---|']
    for error in old_j_errors:
        index = cohort_ids.index(error['id'])
        predictions = [labels[int(new_probabilities[seed][index].argmax())] for seed in runs]
        lines.append(f"| {error['currentClipName']} | {error['dominantTrackedHand']} | {error['previousPrediction']} | " + ' | '.join(predictions) + ' |')
    lines += ['', '## J, Z and remaining errors on the full new test set', '', '| Seed | J recall / 115 | J precision | Z recall / 112 | Z precision | J → T count |', '|---|---:|---:|---:|---:|---:|']
    for seed, r in runs.items():
        j, z = r['test']['classificationReport']['J'], r['test']['classificationReport']['Z']
        lines.append(f"| {seed} | {j['recall']:.2%} | {j['precision']:.2%} | {z['recall']:.2%} | {z['precision']:.2%} | {r['test']['confusionMatrix'][9][19]} |")
    for seed, r in runs.items():
        lines += ['', f"Seed {seed} largest confusions: " + ', '.join(f'{a} → {b}: {n}' for a, b, n in r['topConfusions'][:8]) + '.']
    lines += ['', '## Per-letter test F1', '', '| Letter | New test support | Seed 42 | Seed 43 | Seed 44 |', '|---|---:|---:|---:|---:|']
    for label in labels:
        lines.append(f"| {label} | {int(runs['42']['test']['classificationReport'][label]['support'])} | " + ' | '.join(f"{runs[seed]['test']['classificationReport'][label]['f1-score']:.4f}" for seed in runs) + ' |')
    lines += ['', '## Interpretation and next step', '',
        'The shared cohort distinguishes J improvement from changes in the composition of the test split. Tiny overall differences amount to only a few examples and should not be described as a decisive overall improvement.', '',
        'These complete-clip results do not establish that live J → T errors are fixed. All models retain one-frame static inputs versus 40-frame J/Z inputs, wrist-relative features and no unknown/background training. The live adapter can still choose a static interpretation at the wrong point in a gesture. Different source files can share a signer or session; no unseen-person claim is supported.', '',
        f'The next useful experiment is to load validation-selected seed {validation_pick} into Recognition Lab as a candidate and collect intended-letter annotations for J/I/T, Z/D and transitions. Evaluate complete strokes, stationary holds and repeats separately. Integration is not performed by this training/report task.', '',
        '## Verification and artifacts', '',
        'All run checksums (excluding invalid historical self-references), prepared-array hashes, scaler hashes, split IDs, class maps, reported accuracies, macro F1, confusion matrices and minimum-validation-loss epochs were checked. A checksum-writer self-reference was corrected; checkpoint weights were not changed. Source scripts are saved with each run.', '',
        '- `COMPARISON.json`: full metrics, cohort policy and paired counts.',
        '- `comparison-cohort.json`: exact comparison IDs.',
        '- `previous-model-comparison-predictions.npz`: previous probabilities on the shared cohort.',
        '- `alphabet_26_j460_v2_seed42/`, `...seed43/`, `...seed44/`: checkpoints and individual reports.',
        '- `training-seed43.log`, `training-seed44.log`: training logs.',
        '- `learning-curves.png`: validation curves. Old and new validation sets differ, so these curves describe convergence rather than a paired data comparison.', '']
    (parent / 'REPORT_COMPARISON.md').write_text('\n'.join(lines), encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), constrained_layout=True)
    for label, folder in [('Previous', old_folder)] + [(f'New {seed}', parent / f'alphabet_26_j460_v2_seed{seed}') for seed in runs]:
        h = read(folder / 'history.json')
        epoch = np.arange(1, len(h['loss']) + 1)
        axes[0].plot(epoch, h['val_loss'], label=label)
        axes[1].plot(epoch, np.asarray(h['val_accuracy']) * 100, label=label)
    axes[0].set(title='Validation loss', xlabel='Epoch', ylabel='Cross-entropy loss', ylim=(0, .4))
    axes[1].set(title='Validation accuracy', xlabel='Epoch', ylabel='Accuracy (%)', ylim=(90, 100))
    for ax in axes:
        ax.grid(alpha=.2)
        ax.legend()
    fig.suptitle('Alphabet checkpoints: previous dataset vs J-refresh seeds')
    fig.savefig(parent / 'learning-curves.png', dpi=160)
    plt.close(fig)
    shutil.copy2(__file__, parent / Path(__file__).name)
    (parent / 'comparison-artifact-checksums.json').write_text(json.dumps({p.name: digest(p) for p in parent.iterdir()
        if p.is_file() and p.suffix not in ('.log',) and p.name != 'comparison-artifact-checksums.json'}, indent=2), encoding='utf-8')
    print(json.dumps({k: summary[k] for k in ('meanNewTestAccuracy', 'sampleStdNewTestAccuracy', 'validationSelectedSeed')}, indent=2))
    for seed, run in runs.items():
        print(seed, 'test', run['test']['accuracy'], 'shared', run['shared']['accuracy'], 'J', run['test']['classificationReport']['J'], flush=True)
    print('REPORT', parent / 'REPORT_COMPARISON.md', flush=True)


if __name__ == '__main__':
    main()
