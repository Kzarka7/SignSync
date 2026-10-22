"""Compare completed isolated palm-floor candidate with saved v6, without tuning."""
from processed_paths import processed_artifact_path, resolve_artifact_path
from model_paths import model_artifact_folder
import argparse
import json
from pathlib import Path
import numpy as np
from run_recordings_v6_experiments import PARTICIPANTS, experiment_name


def read(path):
    path = resolve_artifact_path(path)
    return json.loads(path.read_text(encoding='utf-8'))


def metrics(probs, y, labels):
    ranked = np.argsort(probs, axis=1)[:, ::-1]
    pred = ranked[:, 0]
    score = probs[np.arange(len(y)), pred]
    margin = score - probs[np.arange(len(y)), ranked[:, 1]]
    correct = pred == y
    result = dict(accuracy=float(correct.mean()), thresholds={}, perSign={})
    for threshold in (.63, .70):
        accept = (score >= threshold) & (margin >= .15)
        result['thresholds'][str(threshold)] = dict(
            correctAccepted=int((correct & accept).sum()), wrongAccepted=int((~correct & accept).sum()),
            correctRejected=int((correct & ~accept).sum()), wrongRejected=int((~correct & ~accept).sum()))
    for i, label in enumerate(labels):
        subset = y == i
        result['perSign'][label] = dict(correct=int(correct[subset].sum()), total=int(subset.sum()))
    for label in ('WHICH', 'HOW'):
        errors = (y == labels.index(label)) & (pred == labels.index('HELP'))
        result[label + 'ToHelp'] = dict(total=int(errors.sum()), accepted63=int((errors & (score >= .63) & (margin >= .15)).sum()))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, required=True)
    parser.add_argument('--candidate-root', type=Path, required=True)
    args = parser.parse_args()
    result = dict(runs=[], ensembles={})
    for p in PARTICIPANTS:
        exp = experiment_name(p)
        meta = read(processed_artifact_path(args.dataset_root / 'processed', exp) / 'metadata.json')
        labels = [k for k, v in sorted(meta['labelToIndex'].items(), key=lambda kv: kv[1])]
        arrays = {'baseline': [], 'candidate': []}
        for seed in (42, 43, 44):
            run = exp + (f'_seed{seed}' if seed != 42 else '')
            row = dict(participant=p, seed=seed)
            for kind, root in [('baseline', args.dataset_root), ('candidate', args.candidate_root)]:
                folder = model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v6') / run
                evaluation = read(folder / 'evaluation.json')
                with np.load(folder / 'predictions.npz', allow_pickle=False) as data:
                    np.testing.assert_array_equal(data['sequence_ids'], meta['sequenceIds']['test'])
                    probs, y = data['probabilities'].copy(), data['y_true'].copy()
                if kind == 'baseline':
                    baseline_y = y
                else:
                    np.testing.assert_array_equal(y, baseline_y)
                assert abs(float(np.mean(probs.argmax(axis=1) == y)) - evaluation['testAccuracy']) < 1e-6
                arrays[kind].append(probs)
                row[kind] = dict(macroF1=evaluation['macroF1'], **metrics(probs, y, labels))
            result['runs'].append(row)
        result['ensembles'][p] = {kind: metrics(np.mean(probs, axis=0), y, labels) for kind, probs in arrays.items()}
    result['meanRunAccuracy'] = {kind: float(np.mean([r[kind]['accuracy'] for r in result['runs']])) for kind in ('baseline', 'candidate')}
    result['meanRunMacroF1'] = {kind: float(np.mean([r[kind]['macroF1'] for r in result['runs']])) for kind in ('baseline', 'candidate')}
    p4 = result['ensembles']['participant_04']
    result['prespecifiedGate'] = dict(
        fewerP4WhichToHelp=p4['candidate']['WHICHToHelp']['accepted63'] < p4['baseline']['WHICHToHelp']['accepted63'],
        noMoreP4AcceptedErrors=p4['candidate']['thresholds']['0.63']['wrongAccepted'] <= p4['baseline']['thresholds']['0.63']['wrongAccepted'],
        meanAccuracyLossAtMostOnePoint=result['meanRunAccuracy']['candidate'] >= result['meanRunAccuracy']['baseline'] - .01)
    (args.candidate_root / 'comparison.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    lines = ['# Stable palm normalization experiment', '',
             'Compared with saved v6 baseline using identical four participant-held-out folds, split IDs, labels, seeds 42/43/44, trainer, architecture and optimization settings. Only 24 distance-ratio channels changed; the other 214 channels and their normalization are bit-identical. Statistics fit on training only. All 400 samples per held-out participant retained, including the short P1 clip rejected by live capture checks.', '',
             '## Mean of 12 individual runs', '',
             '| Metric | Baseline | Candidate |', '|---|---:|---:|',
             f'| Accuracy | {result["meanRunAccuracy"]["baseline"]:.2%} | {result["meanRunAccuracy"]["candidate"]:.2%} |',
             f'| Macro F1 | {result["meanRunMacroF1"]["baseline"]:.4f} | {result["meanRunMacroF1"]["candidate"]:.4f} |', '',
             '## Three-seed held-out ensembles at 63% confidence / 15-point margin', '',
             '| Participant | Model | Accuracy | Wrong accepted | Correct rejected | WHICH to HELP accepted | HOW to HELP accepted |',
             '|---|---|---:|---:|---:|---:|---:|']
    for p, groups in result['ensembles'].items():
        for kind, m in groups.items():
            c = m['thresholds']['0.63']
            lines.append(f'| {p} | {kind} | {m["accuracy"]:.2%} | {c["wrongAccepted"]} | {c["correctRejected"]} | {m["WHICHToHelp"]["accepted63"]} | {m["HOWToHelp"]["accepted63"]} |')
    lines += ['', '## Paired individual runs', '', '| Participant | Seed | Baseline accuracy | Candidate accuracy |', '|---|---:|---:|---:|']
    for r in result['runs']:
        lines.append(f'| {r["participant"]} | {r["seed"]} | {r["baseline"]["accuracy"]:.2%} | {r["candidate"]["accuracy"]:.2%} |')
    lines += ['', '## Per-sign ensemble recall changes', '', '| Participant | Sign | Baseline correct / 20 | Candidate correct / 20 |', '|---|---|---:|---:|']
    for p, groups in result['ensembles'].items():
        for label, before in groups['baseline']['perSign'].items():
            after = groups['candidate']['perSign'][label]
            if before['correct'] != after['correct']:
                lines.append(f'| {p} | {label} | {before["correct"]} | {after["correct"]} |')
    lines += ['', '## Prespecified experimental gate', '', json.dumps(result['prespecifiedGate']), '',
              'Passing the numerical gate still requires review of per-sign regressions. This is a P4-informed development experiment, not independent confirmation. No labels were changed and no linguistic verification is claimed from landmark snapshots. No P5 samples were used. Live v5, its 63%/15-point rule and manual confirmation remain unchanged.', '',
              'Review artifacts: which-review.json and four which-review PNGs cover all 20 P4 WHICH clips. Protocol and source snapshot are saved before training. baseline-integrity.json inventories preserved artifacts. comparison.json contains all seed metrics, per-sign counts and both fixed threshold results. The candidate models stay isolated under this experiment directory.']
    (args.candidate_root / 'report.md').write_text('\n'.join(lines), encoding='utf-8')
    print('Mean per-run accuracy', result['meanRunAccuracy'])
    print('Mean per-run macro F1', result['meanRunMacroF1'])
    for p, groups in result['ensembles'].items():
        for kind, m in groups.items():
            print(p, kind, m['accuracy'], m['thresholds']['0.63'], 'WHICH->HELP', m['WHICHToHelp'], 'HOW->HELP', m['HOWToHelp'])


if __name__ == '__main__':
    main()
