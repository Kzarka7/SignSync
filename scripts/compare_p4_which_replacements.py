"""Compare isolated P4 WHICH replacement retraining with saved v6 models."""
from processed_paths import processed_artifact_path, resolve_artifact_path
from model_paths import model_artifact_folder
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from compare_stable_palm_experiment import metrics
from run_recordings_v6_experiments import PARTICIPANTS, experiment_name


def read(path):
    path = resolve_artifact_path(path)
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', required=True, type=Path)
    parser.add_argument('--candidate-root', required=True, type=Path)
    args = parser.parse_args()
    baseline, candidate = args.dataset_root.resolve(), args.candidate_root.resolve()
    result = {'runs': [], 'ensembles': {}, 'splitChecks': {}}
    old_p4 = {s['id']: s for s in read(processed_artifact_path(baseline / 'processed', 'participant_04-dataset-v6.json'))['sequences']}
    new_p4 = {s['id']: s for s in read(processed_artifact_path(candidate / 'processed', 'participant_04-dataset-v6.json'))['sequences']}
    shared_p4 = old_p4.keys() & new_p4.keys()
    assert len(shared_p4) == 394 and all(old_p4[sid] == new_p4[sid] for sid in shared_p4)
    result['retainedP4RecordingsExactlyUnchanged'] = True
    del old_p4, new_p4
    for participant in PARTICIPANTS:
        exp = experiment_name(participant)
        metas = {k: read(processed_artifact_path(root / 'processed', exp) / 'metadata.json') for k, root in [('baseline', baseline), ('candidate', candidate)]}
        labels = [label for label, index in sorted(metas['baseline']['labelToIndex'].items(), key=lambda kv: kv[1])]
        assert metas['baseline']['labelToIndex'] == metas['candidate']['labelToIndex']
        # Retained samples must keep their train/validation/test assignments.
        assignments = {k: {sid: split for split, ids in m['sequenceIds'].items() for sid in ids} for k, m in metas.items()}
        common = set(assignments['baseline']) & set(assignments['candidate'])
        assert all(assignments['baseline'][sid] == assignments['candidate'][sid] for sid in common)
        with np.load(processed_artifact_path(baseline / 'processed', exp) / 'gru_data.npz') as b, np.load(processed_artifact_path(candidate / 'processed', exp) / 'gru_data.npz') as c:
            same_training = bool(np.array_equal(b['X_train'], c['X_train']) and np.array_equal(b['y_train'], c['y_train']))
            same_validation = bool(np.array_equal(b['X_validation'], c['X_validation']) and np.array_equal(b['y_validation'], c['y_validation']))
        if participant == 'participant_04':
            assert same_training and same_validation
        result['splitChecks'][participant] = dict(commonIdsKeepAssignment=True, sameTrainingTensors=same_training, sameValidationTensors=same_validation)
        probabilities = {'baseline': [], 'candidate': []}
        truths, ids = {}, {}
        for seed in (42, 43, 44):
            run = exp + (f'_seed{seed}' if seed != 42 else '')
            row = dict(participant=participant, seed=seed)
            for kind, root in [('baseline', baseline), ('candidate', candidate)]:
                folder = model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v6') / run
                evaluation = read(folder / 'evaluation.json')
                assert evaluation['randomSeed'] == seed
                with np.load(folder / 'predictions.npz', allow_pickle=False) as saved:
                    p, y, sid = saved['probabilities'].copy(), saved['y_true'].copy(), saved['sequence_ids'].tolist()
                assert sid == metas[kind]['sequenceIds']['test']
                assert abs((p.argmax(axis=1) == y).mean() - evaluation['testAccuracy']) < 1e-6
                probabilities[kind].append(p)
                truths[kind], ids[kind] = y, sid
                row[kind] = dict(macroF1=evaluation['macroF1'], **metrics(p, y, labels))
            result['runs'].append(row)
        shared = sorted(set(ids['baseline']) & set(ids['candidate']))
        ensemble = {}
        for kind in probabilities:
            p = np.mean(probabilities[kind], axis=0)
            indices = [ids[kind].index(sid) for sid in shared]
            replaced = [i for i, sid in enumerate(ids[kind]) if sid not in shared]
            ensemble[kind] = {'all': metrics(p, truths[kind], labels),
                              'common': metrics(p[indices], truths[kind][indices], labels)}
            if replaced:
                ensemble[kind]['replacedSix'] = metrics(p[replaced], truths[kind][replaced], labels)
        ensemble['commonCount'] = len(shared)
        if participant == 'participant_04':
            result['p4CommonProbabilitiesExactlyIdentical'] = all(
                np.array_equal(a[[ids['baseline'].index(sid) for sid in shared]],
                               b[[ids['candidate'].index(sid) for sid in shared]])
                for a, b in zip(probabilities['baseline'], probabilities['candidate']))
        result['ensembles'][participant] = ensemble
    result['meanRunAccuracy'] = {kind: float(np.mean([r[kind]['accuracy'] for r in result['runs']])) for kind in probabilities}
    result['meanRunMacroF1'] = {kind: float(np.mean([r[kind]['macroF1'] for r in result['runs']])) for kind in probabilities}
    for name in ('source-provenance.json', 'baseline-model-hashes.json'):
        document = read(candidate / name)
        hashes = document['sourceSha256'] if name == 'source-provenance.json' else document
        for path, expected in hashes.items():
            assert hashlib.sha256(resolve_artifact_path(path).read_bytes()).hexdigest() == expected, path
    result['baselineIntegrityVerified'] = True
    (candidate / 'replacement-comparison.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    lines = ['# P4 WHICH replacement retraining comparison', '',
             'Same base geometry features, architecture, four held-out participant folds and seeds 42/43/44. Six P4 WHICH recordings replaced; all other recordings retain split assignments. No live change.', '',
             'P1–P3 test sets are unchanged. P4 test data differs in six clips and is development data. P4 training/validation tensors are identical between runs: a P4 score increase cannot be attributed to learning from the new P4 samples in that fold. Rerun differences on common P4 clips reflect training variability.', '',
             '| Participant | Cohort | Model | Accuracy | Wrong accepted | Correct rejected | WHICH→HELP accepted |',
             '|---|---|---|---:|---:|---:|---:|']
    for participant, groups in result['ensembles'].items():
        for cohort in ('all', 'common', 'replacedSix'):
            for kind in ('baseline', 'candidate'):
                if cohort not in groups[kind]:
                    continue
                m = groups[kind][cohort]; t = m['thresholds']['0.63']
                lines.append(f'| {participant} | {cohort} | {kind} | {m["accuracy"]:.2%} | {t["wrongAccepted"]} | {t["correctRejected"]} | {m["WHICHToHelp"]["accepted63"]} |')
    lines += ['', 'Thresholds fixed at confidence 63% / margin 15 points; the JSON also includes 70% results, per-sign counts and individual seed runs.', '',
              'Mean individual-run accuracy: ' + str(result['meanRunAccuracy']),
              'Mean individual-run macro F1: ' + str(result['meanRunMacroF1']), '',
              '## Changes in per-sign correct counts (whole held-out sets)', '', '| Participant | Sign | Baseline | Candidate |', '|---|---|---:|---:|']
    for participant, groups in result['ensembles'].items():
        for label, before in groups['baseline']['all']['perSign'].items():
            after = groups['candidate']['all']['perSign'][label]
            if before['correct'] != after['correct']:
                lines.append(f'| {participant} | {label} | {before["correct"]} | {after["correct"]} |')
    lines += ['', 'Original source and saved baseline checkpoint/prediction/evaluation hashes verified unchanged.',
              'All 394 retained P4 recordings are exactly unchanged. P4 predictions on those recordings are bit-identical across all three seeds: ' + str(result['p4CommonProbabilitiesExactlyIdentical'])]
    (candidate / 'replacement-comparison.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines).replace('→', '->').replace('–', '-'), flush=True)


if __name__ == '__main__':
    main()
