"""Verify and report a frozen seed-42 SignSync sequence pilot."""
import argparse
from collections import Counter
from pathlib import Path
import re
import shutil

import numpy as np
from sklearn.metrics import classification_report
import tensorflow as tf

from model_paths import model_artifact_folder
from processed_paths import processed_artifact_path
from run_recordings_v5_experiments import raw_geometry_features, standardize_for_model
from sample_pipeline import SPLITS, SUFFIXES, digest, group_components, load_sample, read_csv, read_json, write_json
from sample_training import validate_candidate
from shape_motion_sequence import SHAPE_MOTION_V1, raw_shape_motion_features
from prepare_similarity_pilot import CANDIDATE as SIMILARITY_43, held_pose, shifted as shift_sequence


GROUPED_38 = 'samples_38_signs_grouped_v1'
CLIP_38 = 'samples_38_signs_clip_70_15_15_v1'
WEEKDAYS_33 = 'samples_33_signs_weekdays_clip_70_15_15_v1'
DAYS_NUMBERS_43 = 'samples_43_signs_days_numbers_clip_70_15_15_v1'
SHAPE_MOTION_43 = 'samples_43_signs_shape_motion_v1'
VOCABULARY = 'Frontend/src/hooks/useDatasetRecorder.ts'
V5 = 'gru_p01_p02_train_p03_test_geometry_v3_recordings_v5'
GROUPED_55 = 'samples_55_signs_rest_idle_geometry_v1'
CLIP_55 = 'samples_55_signs_rest_idle_clip_60_15_25_v1'


def vocabulary(config):
    path = Path(__file__).resolve().parents[1] / VOCABULARY
    source = path.read_bytes()
    collector = re.search(r'DEFAULT_SIGN_LABELS\s*=\s*\[([^\]]+)\]', source.decode('utf-8')).group(1)
    labels = re.findall(r"'([A-Z_]+)'", collector)
    weekdays = config['name'] in (WEEKDAYS_33, DAYS_NUMBERS_43, SHAPE_MOTION_43, SIMILARITY_43)
    calendar = ('MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY SUNDAY' if weekdays else
                'JANUARY FEBRUARY MARCH APRIL MAY JUNE JULY AUGUST SEPTEMBER OCTOBER NOVEMBER DECEMBER')
    families = {'First 20': labels[:20]}
    if config['name'] in (DAYS_NUMBERS_43, SHAPE_MOTION_43, SIMILARITY_43):
        families['Numbers'] = labels[20:30]
    families['Days of the week' if weekdays else 'Months'] = calendar.split()
    families['Greetings and time words'] = 'GOOD_MORNING GOOD_AFTERNOON GOOD_EVENING TODAY TOMORROW YESTERDAY'.split()
    expected = sum(families.values(), [])
    if config['labels'] != expected or len(set(expected)) != len(expected):
        raise ValueError('Frozen config differs from the requested vocabulary')
    return families, digest(source)


def scores(truth, predicted, labels):
    report = classification_report(truth, predicted, labels=labels, output_dict=True, zero_division=0)
    return {'clips': len(truth), 'accuracy': float(np.mean(truth == predicted)),
            'macroF1': report['macro avg']['f1-score'], 'perLabel': {label: report[label] for label in labels}}


def coverage(labels, rows, ids):
    groups, _ = group_components(list(rows.values()))
    report = {}
    for label in labels:
        members = [row for row in rows.values() if row['label'] == label]
        components = {groups[row['sequence_id']] for row in members}
        held_out = len(components & {groups[sid] for sid in ids['test'] if rows[sid]['label'] == label})
        report[label] = dict(
            usableClips=len(members), knownSigners=sorted({r['signer_id'] for r in members if r['signer_id']}),
            unknownSignerClips=sum(not r['signer_id'] for r in members),
            sourceRecordingFingerprints=len({r['source_recording'] for r in members if r['source_recording']}),
            groups=len(components), testGroups=held_out, singleGroupTest=held_out < 2,
            clipsBySplit={s: sum(rows[sid]['label'] == label for sid in ids[s]) for s in SPLITS},
        )
    return report


def checked_sequence(root, row, order):
    export, sequence, checksum, _ = load_sample(root / row['sample_path'], row['label'])
    if checksum != row['sha256'] or export['featureSchema']['order'] != order or sequence['id'] != row['sequence_id']:
        raise ValueError(f"Frozen sample mismatch: {row['sample_path']}")
    return sequence


def baseline_comparisons(root, ids, truth, prediction, rows, order, output, candidate):
    v5_prepared = processed_artifact_path(root / 'processed', V5)
    v5_meta = read_json(v5_prepared / 'metadata.json')
    v5_run = model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v5') / V5
    v5_eval = read_json(v5_run / 'evaluation.json')
    if v5_eval['preprocessingMetadata'] != v5_meta or v5_eval['randomSeed'] != 42:
        raise ValueError('V5 baseline metadata mismatch')
    runs = {V5: (v5_run, v5_meta)}
    baselines = {
        GROUPED_38: (GROUPED_55,),
        CLIP_38: (GROUPED_55, GROUPED_38, CLIP_55),
        WEEKDAYS_33: (CLIP_38, CLIP_55),
        DAYS_NUMBERS_43: (WEEKDAYS_33, CLIP_55),
        SHAPE_MOTION_43: (DAYS_NUMBERS_43,),
        SIMILARITY_43: (SHAPE_MOTION_43,),
    }[candidate]
    for name in baselines:
        folder = root / 'models' / 'candidates' / name / name
        evaluation = read_json(folder / 'evaluation.json')
        if evaluation['randomSeed'] != 42 or evaluation['experiment'] != name:
            raise ValueError(f'Baseline checkpoint identity mismatch: {name}')
        runs[name] = folder, evaluation['preprocessingMetadata']
    results = {}
    for name, (folder, meta) in runs.items():
        common = np.flatnonzero(np.isin(ids, meta['sequenceIds']['test']) & np.isin(truth, list(meta['labelToIndex'])))
        if not len(common):
            continue
        baseline_labels = np.asarray(sorted(meta['labelToIndex'], key=meta['labelToIndex'].get))
        if name == V5:
            raw = np.stack([raw_geometry_features(checked_sequence(root, rows[ids[i]], order), order, 40)
                            for i in common])
            with np.load(v5_prepared / 'gru_data.npz', allow_pickle=False) as arrays:
                inputs = standardize_for_model(raw, arrays['feature_mean'], arrays['feature_std'])
            model = tf.keras.models.load_model(v5_run / 'best_model.h5', compile=False)
            probabilities = model.predict(inputs, verbose=0)
        else:
            with np.load(folder / 'predictions.npz', allow_pickle=False) as saved:
                index = {sid: i for i, sid in enumerate(saved['sequence_ids'])}
                selected = [index[ids[i]] for i in common]
                for i in common:
                    row = rows[ids[i]]
                    if row['sha256'] != meta['sourceSha256'][row['sample_path']]:
                        raise ValueError(f'Baseline has different source bytes: {name}')
                np.testing.assert_array_equal(baseline_labels[saved['y_true'][selected]], truth[common])
                probabilities = saved['probabilities'][selected]
        baseline = baseline_labels[probabilities.argmax(axis=1)]
        labels = sorted(set(truth[common]))
        results[name] = dict(candidate=scores(truth[common], prediction[common], labels),
                             baseline=scores(truth[common], baseline, labels), labels=labels)
        np.savez_compressed(output / f'comparison_{name}.npz', sequence_ids=ids[common], truth=truth[common],
                            candidate_prediction=prediction[common], baseline_prediction=baseline,
                            baseline_probabilities=probabilities, baseline_labels=baseline_labels)
    return results


def rejection_predictions(root, rows, order, labels, model, mean, std, threshold,
                          raw_features=raw_geometry_features):
    predictions = []
    for row in rows:
        if row['status'] != 'approved' or row['label'] in labels:
            raise ValueError('Expected approved clips outside the model vocabulary')
        sequence = checked_sequence(root, row, order)
        frames = sequence['frames']
        raw = raw_features(sequence, order, 40)[None, ...]
        probabilities = np.asarray(model(standardize_for_model(raw, mean, std), training=False))[0]
        pred = int(probabilities.argmax())
        visible = np.mean([f['valid'] and (f['features'][36] == 1 or f['features'][100] == 1) for f in frames])
        capture_ok = (8 <= len(frames) <= 240 and 400 <= frames[-1]['timestamp'] - frames[0]['timestamp'] <= 10000
                      and np.mean([f['valid'] for f in frames]) >= .8
                      and np.isin([[f['features'][36], f['features'][100]] for f in frames], [0, 1]).all())
        score = float(probabilities[pred])
        predictions.append(dict(sequenceId=row['sequence_id'], sha256=row['sha256'], actual=row['label'],
                                prediction=labels[pred], score=score, captureEligible=bool(capture_ok),
                                validHandFraction=float(visible), thresholdAccept=score >= threshold,
                                labGateAccept=bool(score >= threshold and capture_ok and visible >= .5)))
    return predictions


def rejection_counts(predictions):
    if not predictions:
        raise ValueError('Expected frozen rejection clips')
    return dict(clips=len(predictions), captureEligible=sum(p['captureEligible'] for p in predictions),
                thresholdAccepts=sum(p['thresholdAccept'] for p in predictions),
                labGateAccepts=sum(p['labGateAccept'] for p in predictions),
                mostAcceptedLabels=Counter(p['prediction'] for p in predictions if p['labGateAccept']).most_common())


def pair_stress_checks(root, rows, order, ids, truth, labels, model, mean, std, previous=DAYS_NUMBERS_43):
    baseline = root / 'models' / 'candidates' / previous / previous
    old_model = tf.keras.models.load_model(baseline / 'best_model.h5', compile=False)
    with np.load(baseline / 'preparation' / 'gru_data.npz', allow_pickle=False) as saved:
        old_mean, old_std = saved['feature_mean'], saved['feature_std']
    pair_labels = {'ONE', 'WHAT', 'SIX', 'WEDNESDAY', 'TEN'}
    columns = {name: index for index, name in enumerate(order)}
    cases = {
        'original': (0., 0., pair_labels),
        'hand raised': (0., -.18, pair_labels),
        'hand lowered': (0., .18, pair_labels),
        'ONE with gradual sideways drift': (.12, 0., {'ONE'}),
    }
    inputs = {name: ([], [], []) for name in cases}
    if previous == SHAPE_MOTION_43:
        inputs.update({f'{label} {condition}': ([], [], []) for label in ('ONE', 'SIX')
                       for condition in ('held steady', 'held with drift')})
    for sid, label in zip(ids, truth):
        if label not in pair_labels:
            continue
        sequence = checked_sequence(root, rows[sid], order)
        frames = sequence['frames']
        time = np.asarray([frame['timestamp'] for frame in frames])
        progress = (time - time[0]) / (time[-1] - time[0])
        raw = np.asarray([frame['features'] for frame in frames], dtype=float)
        for name, (dx, dy, supported) in cases.items():
            if label not in supported:
                continue
            changed = raw.copy()
            for side, offset in (('left', 36), ('right', 100)):
                tracked = raw[:, offset] == 1
                changed[:, offset + 1:offset + 64:3] += (dx * progress * tracked)[:, None]
                changed[:, offset + 2:offset + 64:3] += (dy * tracked)[:, None]
                for joint, weight in (('Wrist', 1.), ('Elbow', .5)):
                    changed[:, columns[f'pose.{side}{joint}.x']] += dx * progress * tracked * weight
                    changed[:, columns[f'pose.{side}{joint}.y']] += dy * tracked * weight
            shifted = dict(sequence, frames=[dict(f, features=v) for f, v in zip(frames, changed)])
            inputs[name][0].append(label)
            revised = raw_shape_motion_features(shifted, order, 40)
            inputs[name][1].append(revised if previous == SHAPE_MOTION_43 else raw_geometry_features(shifted, order, 40))
            inputs[name][2].append(revised)
        if previous == SHAPE_MOTION_43 and label in ('ONE', 'SIX'):
            hold = held_pose(sequence)
            if hold is None:
                continue
            for condition, pose in (('held steady', hold), ('held with drift', shift_sequence(hold, drift=.04))):
                x = raw_shape_motion_features(pose, order, 40)
                actual, original, revised = inputs[f'{label} {condition}']
                actual.append(label); original.append(x); revised.append(x)

    result = {}
    for name, (true_labels, original, revised) in inputs.items():
        y = np.asarray(true_labels)
        result[name] = {}
        for kind, network, values, offset, scale in (
            ('previous', old_model, original, old_mean, old_std),
            ('candidate', model, revised, mean, std),
        ):
            predicted = labels[network.predict(standardize_for_model(np.stack(values), offset, scale), verbose=0).argmax(axis=1)]
            result[name][kind] = dict(clips=len(y), correct=int((predicted == y).sum()),
                                      confusions=[(a, b, n) for (a,b),n in Counter(zip(y,predicted)).most_common() if a != b])
    return result


def write_report(output, report):
    sizes = report['splitCounts']
    class_count = report['vocabularySize']
    feature_description = report['featureDescription']
    lines = [f'# SignSync {class_count}-sign GRU pilot', '',
             f'Seed 42. Full clips are resampled to 40 frames with 238 features. {feature_description} '
             'Scaling was fitted on training signs, checkpoint selection used validation loss, and the score threshold was selected on validation sign macro F1.', '',
             f"Frozen splits contain {sizes['training']:,} training, {sizes['validation']:,} validation, and {sizes['test']:,} test clips. "
             + report['splitDescription'], '',
             '## Held-out signs', '', '| Vocabulary | Clips | Accuracy | Macro F1 |', '|---|---:|---:|---:|']
    for name, result in {f'All {class_count}': report['overall'], **report['families']}.items():
        lines.append(f"| {name} | {result['clips']} | {result['accuracy']:.2%} | {result['macroF1']:.2%} |")
    lines += ['', f'Breakout accuracy uses each group’s clips. Breakout macro F1 averages the full {class_count}-way per-label F1 values in that group.', '',
              '## Coverage and per-label results', '',
              report['coverageDescription'] + ' Clip totals include the existing approvals with documented tracking findings.', '',
              '| Label | Usable clips | Known signers | Source fingerprints | Groups total | Train / val / test clips | Test groups | Single group | Precision | Recall |',
              '|---|---:|---:|---:|---:|---:|---:|:---:|---:|---:|']
    for label, row in report['coverage'].items():
        result = report['overall']['perLabel'][label]
        counts = ' / '.join(str(row['clipsBySplit'][s]) for s in SPLITS)
        lines.append(f"| {label} | {row['usableClips']} | {len(row['knownSigners'])} | {row['sourceRecordingFingerprints']} | "
                     f"{row['groups']} | {counts} | {row['testGroups']} | {'Yes' if row['singleGroupTest'] else ''} | "
                     f"{result['precision']:.2%} | {result['recall']:.2%} |")
    lines += ['', '## Most common confusions', '', '| Actual | Predicted | Clips |', '|---|---|---:|']
    lines += [f'| {actual} | {predicted} | {n} |' for actual, predicted, n in report['confusions'][:12]]
    lines += ['', '## Separate false-accept checks', '',
              f"The validation-selected score threshold is {report['threshold']:.2f}. Background clips came from the frozen approval snapshot for participant 03. "
              'The Lab capture and visibility gates are shown separately from the threshold alone. These rates are per isolated clip. '
              + report['backgroundDescription'], '',
              '| Background | Clips | Score passes | Backend clip-gate false accepts |', '|---|---:|---:|---:|']
    for label, row in report['background'].items():
        n = row['clips']
        lines.append(f"| {label} | {n} | {row['thresholdAccepts']}/{n} | {row['labGateAccepts']}/{n} ({row['labGateAccepts']/n:.1%}) |")
    if 'similarityTraining' in report:
        settings = report['similarityTraining']
        lines += ['', '## Similarity training', '',
                  f"Fine-tuned the current checkpoint with {settings['augmentedRows']:,} synthetic views of approved training clips. "
                  'The training scaler and original clip assignments were reused. Augmentation varied placement and speed and added short holds for ONE through NINE. '
                  'ONE, WHAT, SIX and WEDNESDAY received additional training weight. The short-hold tests repeat a visible pose from the middle of held-out clips.', '']
        for label, baseline in report['backgroundBaseline'].items():
            lines.append(f"The current model’s clip gate accepted {baseline['labGateAccepts']}/{baseline['clips']} {label} clips.")
    if 'excludedMonths' in report:
        months = report['excludedMonths']
        n = months['clips']
        accepts = months['labGateAccepts']
        lines += ['', '## Excluded month signs', '', report['scopeLimitation'], '',
                  f'The clip gate accepted {accepts}/{n} ({accepts/n:.1%}) of the original 38-sign pilot’s test month clips '
                  'as one of the supported signs. These clips are outside the current model’s vocabulary. The count applies to isolated clips.', '']
    lines += ['', '## Baselines on shared held-out clips', '',
              'Each baseline uses its own training scaler and its native output space. Both models are scored on the same clip IDs for each row. Predictions outside the shared true-label set count as errors. The v5 comparison uses its participant-03-held-out seed-42 member.', '',
              '| Baseline | Shared labels | Clips | Candidate accuracy / F1 | Baseline accuracy / F1 |', '|---|---:|---:|---:|---:|']
    for name, pair in report['baselines'].items():
        a, b = pair['candidate'], pair['baseline']
        lines.append(f"| {name} | {len(pair['labels'])} | {a['clips']} | {a['accuracy']:.2%} / {a['macroF1']:.2%} | {b['accuracy']:.2%} / {b['macroF1']:.2%} |")
    if 'pairStressChecks' in report:
        lines += ['', '## Example sign pairs', '',
                  'The test subset uses ONE, WHAT, SIX, WEDNESDAY and TEN. Placement probes move tracked hand landmarks and their matching arm coordinates by 0.18 shoulder widths vertically. '
                  'The drift probe adds 0.12 shoulder widths of gradual lateral movement to ONE. Synthetic landmark edits test sensitivity to these controlled changes.', '',
                  '| Clip condition | Previous correct | Candidate correct |', '|---|---:|---:|']
        for name, pair in report['pairStressChecks'].items():
            old, new = pair['previous'], pair['candidate']
            lines.append(f"| {name} | {old['correct']}/{old['clips']} | {new['correct']}/{new['clips']} |")
    lines += ['', '## Continuous evaluation', '', report['continuous'], '']
    if 'controlledReplay' in report:
        lines += ['### Controlled Lab replay', '',
                  'Both checkpoints used the same preview and confirmation settings. Counts below are correct clips, wrong accepts, and clips without a correct accept.', '',
                  '| Label | Clips | Previous correct / wrong / missed | Candidate correct / wrong / missed |',
                  '|---|---:|---:|---:|']
        for label, row in report['controlledReplay']['byLabel'].items():
            old, new = row['baseline'], row['candidate']
            lines.append(f"| {label} | {row['clips']} | {old['correctClips']} / {old['wrongAccepts']} / {old['misses'] if old['misses'] is not None else '—'} | "
                         f"{new['correctClips']} / {new['wrongAccepts']} / {new['misses'] if new['misses'] is not None else '—'} |")
        lines += ['', *report['controlledReplay']['limitations'], '',
                  '`controlled_replay.json` contains clip IDs, transcript entries, and timing offsets from the controlled reference points.', '']
    lines += ['## Run files', '',
              '- `best_model.h5` is the verified checkpoint, saved in the same HDF5 format as the earlier pilot.',
              '- `preparation/` contains the frozen split IDs, configuration, feature schema, arrays, scaler, and approval snapshot.',
              '- `evaluation.json`, `runtime.json`, and `history.json` record the seed, settings, environment, and training history.',
              '- `predictions.npz` and `validation_predictions.npz` contain probabilities in checkpoint label-index order and sequence IDs.',
              '- `pilot_summary.json`, `background_predictions.json`, and `comparison_*.npz` contain the detailed metrics and aligned predictions.', '']
    (output / 'pilot_report.md').write_text('\n'.join(lines), encoding='utf-8')


def main(root, candidate):
    processed = root / 'processed'
    prepared = (processed_artifact_path(processed, candidate) if candidate == SIMILARITY_43
                else processed / 'candidates' / candidate)
    models = root / 'models'
    model_group = (model_artifact_folder(models, candidate) if candidate == SIMILARITY_43
                   else models / 'candidates' / candidate)
    output = model_group / candidate
    metadata = read_json(prepared / 'metadata.json')
    config = validate_candidate(prepared, metadata)
    if config['name'] != candidate:
        raise ValueError('Prepared experiment name does not match the selected candidate')
    families, vocabulary_sha = vocabulary(config)
    shape_motion = candidate in (SHAPE_MOTION_43, SIMILARITY_43)
    if shape_motion != (config.get('featureVariant') == SHAPE_MOTION_V1):
        raise ValueError('Pilot feature variant mismatch')
    if shape_motion:
        previous = SHAPE_MOTION_43 if candidate == SIMILARITY_43 else DAYS_NUMBERS_43
        baseline = read_json(root / 'processed' / 'candidates' / previous / 'metadata.json')
        for key in ('sequenceIds', 'labelToIndex', 'sourceSha256'):
            if metadata[key] != baseline[key]:
                raise ValueError(f'Feature comparison must preserve the original {key}')
    raw_features = raw_shape_motion_features if shape_motion else raw_geometry_features
    rows = read_csv(prepared / 'samples.csv')
    order = read_json(prepared / 'feature_schema.json')['order']
    labels = np.asarray(sorted(metadata['labelToIndex'], key=metadata['labelToIndex'].get))
    np.testing.assert_array_equal(labels, sorted(config['labels']))
    evaluation = read_json(output / 'evaluation.json')
    selection = read_json(output / 'threshold_selection.json')
    threshold = selection['selected']['threshold']
    if (evaluation['randomSeed'] != 42 or evaluation['preprocessingMetadata'] != metadata or
            evaluation['acceptance']['threshold'] != threshold or selection['selectedOn'] != 'validation only'):
        raise ValueError('Pilot evaluation and frozen artifacts disagree')
    if evaluation['checkpoint'] != 'best_model.h5':
        raise ValueError('Pilot evaluation must reference its HDF5 checkpoint')
    checkpoint = output / evaluation['checkpoint']
    model = tf.keras.models.load_model(checkpoint, compile=False)
    class_count = len(labels)
    if tuple(model.input_shape[1:]) != (40, 238) or model.output_shape[-1] != class_count:
        raise ValueError('Checkpoint does not have the expected input and output shapes')
    suffixes = dict(zip(SPLITS, SUFFIXES))
    for split, artifact in (('validation', 'validation_predictions.npz'), ('test', 'predictions.npz')):
        suffix = suffixes[split]
        with np.load(prepared / 'gru_data.npz', allow_pickle=False) as arrays, np.load(output / artifact, allow_pickle=False) as saved:
            probabilities = model.predict(arrays[f'X_{suffix}'], verbose=0)
            if not np.isfinite(probabilities).all():
                raise ValueError(f'Checkpoint returned non-finite probabilities on {split}')
            np.testing.assert_allclose(probabilities.sum(axis=1), 1, atol=1e-6)
            np.testing.assert_allclose(probabilities, saved['probabilities'], atol=2e-6, rtol=1e-5)
            np.testing.assert_array_equal(arrays[f'y_{suffix}'], saved['y_true'])
            np.testing.assert_array_equal(metadata['sequenceIds'][split], saved['sequence_ids'])
            mean, std = arrays['feature_mean'], arrays['feature_std']
            ids, truth = saved['sequence_ids'], labels[saved['y_true']]
    predicted = labels[probabilities.argmax(axis=1)]
    overall = scores(truth, predicted, labels.tolist())
    by_family = {}
    for name, members in families.items():
        mask = np.isin(truth, members)
        by_family[name] = dict(clips=int(mask.sum()), accuracy=float((truth[mask] == predicted[mask]).mean()),
                               macroF1=float(np.mean([overall['perLabel'][label]['f1-score'] for label in members])))
    background = config['backgroundChecks']
    background_rows = [r for r in read_csv(prepared / 'review-manifest.csv').values()
                       if r['status'] == 'approved' and r['label'] in background['labels']
                       and r['signer_id'] == background['signerId']]
    negatives = rejection_predictions(root, background_rows, order, labels, model, mean, std, threshold, raw_features)
    counts = {label: rejection_counts([p for p in negatives if p['actual'] == label]) for label in background['labels']}
    clip_split = config.get('splitMethod') == 'stratified-clip-exploratory'
    if clip_split:
        batches = {'source-105-fsl-signs': '105 FSL Signs', 'source-transactional': 'Transactional'}
        sources = Counter(r['collection_batch'] for r in rows.values())
        training_sources = ' and '.join(f'{sources[key]} {batches[key]} clips' for key in config['evaluationExcludedBatches'])
        split_description = (f'The target ratio is 70/15/15. All {class_count} labels appear in each split. All {training_sources} '
                             'are in training. Validation and test IDs are available for a later paired source comparison.')
        if candidate == WEEKDAYS_33:
            split_description += ' The 26 shared labels retain their assignments from the earlier 38-sign clip pilot.'
        elif candidate == DAYS_NUMBERS_43:
            split_description += ' The 33 shared labels retain their assignments from the earlier days-of-the-week pilot.'
        elif candidate == SIMILARITY_43:
            split_description += ' The comparison reuses the original handshape-and-motion split IDs.'
        elif shape_motion:
            split_description += ' The comparison uses the exact split IDs from the earlier 43-sign days-and-numbers pilot.'
        coverage_description = ('Known recording fingerprints stay in one split. Signers and collection batches can cross splits. '
                                'Unknown signers are tracked by recording fingerprint and batch for provenance. '
                                'Test-group counts show source coverage and may include groups seen in training. '
                                'The score measures held-out clips under this policy.')
        background_description = 'Participant 03 also contributed training signs. The background recordings are separate clips.'
    else:
        split_description = ('P1/P4 train, P2 validates, and P3 tests. The batch allocation retains all 38 labels in every split '
                             'and prioritizes wider test-batch coverage.')
        coverage_description = ('Each known signer stays in one split. Missing signer IDs are grouped by source recording fingerprint '
                                'and collection batch, with entire connected groups kept together. Cross-batch signer identity is unknown. '
                                'A single test group is flagged. For the first 20 signs the sole test group is participant 03.')
        background_description = ''
    feature_description = ('Hand joints are wrist-relative and normalized by hand size. Timestamp-based wrist and palm motion and thumb-to-finger geometry supplement the body context.'
                           if shape_motion else 'The input uses geometry-v3 features.')
    report = dict(vocabularySize=class_count, featureDescription=feature_description, overall=overall, families=by_family,
                  coverage=coverage(config['labels'], rows, metadata['sequenceIds']),
                  splitCounts={s: len(metadata['sequenceIds'][s]) for s in SPLITS},
                  splitDescription=split_description, coverageDescription=coverage_description,
                  backgroundDescription=background_description,
                  confusions=[(a, b, n) for (a, b), n in Counter(zip(truth, predicted)).most_common() if a != b],
                  threshold=threshold, background=counts,
                  baselines=baseline_comparisons(root, ids, truth, predicted, rows, order, output, candidate),
                  continuous='No reviewed continuous recordings with sign timing ground truth were found for this pilot. '
                  f'Record new untrimmed sessions from identified, held-out signers with multiple takes of all {class_count} signs, '
                  'isolated rest-to-sign-to-rest, adjacent signs, same-sign repetitions, and minutes of rest and casual hand movement. '
                  'Save the video or synchronized landmarks, signer/session IDs, and independently reviewed sign labels with onset and offset timestamps. '
                  'Also mark background and tracking interruptions. Match accepts one-to-one to annotated signs and report correct accepts, '
                  'wrong or extra accepts, misses, and delay relative to annotated sign end.')
    if candidate == SIMILARITY_43:
        previous_output = root / 'models' / 'candidates' / SHAPE_MOTION_43 / SHAPE_MOTION_43
        prior_negatives = read_json(previous_output / 'background_predictions.json')
        if {r['sequenceId']: r['sha256'] for r in prior_negatives} != {r['sequenceId']: r['sha256'] for r in negatives}:
            raise ValueError('Background comparison must reuse the exact checked recordings')
        report['backgroundBaseline'] = {label: rejection_counts([r for r in prior_negatives if r['actual'] == label])
                                        for label in background['labels']}
        report['similarityTraining'] = config['similarityTraining']
        replay_file = output / 'controlled_replay.json'
        if replay_file.is_file():
            replay = read_json(replay_file)
            report['controlledReplay'] = {key: replay[key] for key in ('byLabel', 'limitations')}
    if 'outOfVocabularyCheck' in config:
        excluded = config['outOfVocabularyCheck']
        prior = root / 'processed' / 'candidates' / CLIP_38
        prior_metadata = read_json(prior / 'metadata.json')
        prior_config = validate_candidate(prior, prior_metadata)
        if excluded != dict(labels=vocabulary(prior_config)[0]['Months'], candidate=CLIP_38, split='test'):
            raise ValueError('Excluded-month check does not match the prior frozen test set')
        prior_rows = read_csv(prior / 'samples.csv')
        months = [prior_rows[sid] for sid in prior_metadata['sequenceIds']['test']
                  if prior_rows[sid]['label'] in excluded['labels']]
        if {r['content_sha256'] for r in months} & {r['content_sha256'] for r in rows.values()}:
            raise ValueError('Excluded-month clips overlap the current dataset')
        month_predictions = rejection_predictions(root, months, order, labels, model, mean, std, threshold, raw_features)
        report['excludedMonths'] = rejection_counts(month_predictions)
        report['scopeLimitation'] = config['scopeLimitation']
        write_json(output / 'excluded_month_predictions.json', month_predictions)
    if shape_motion:
        report['pairStressChecks'] = pair_stress_checks(root, rows, order, ids, truth, labels, model, mean, std, previous)
    write_json(output / 'pilot_summary.json', report)
    write_json(output / 'background_predictions.json', negatives)
    write_report(output, report)
    shutil.copy2(Path(__file__), output / Path(__file__).name)
    write_json(output / 'checkpoint_verification.json', dict(experiment=candidate, seed=42, labels=labels.tolist(),
               checkpoint=checkpoint.name, checkpointSha256=digest(checkpoint.read_bytes()),
               metadataSha256=digest((prepared / 'metadata.json').read_bytes()),
               vocabularySource=VOCABULARY, vocabularySourceSha256=vocabulary_sha,
               reloadedPredictionsMatch=['validation', 'test']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, default=Path(__file__).resolve().parents[2] / 'SignSync Dataset')
    parser.add_argument('--candidate', choices=(GROUPED_38, CLIP_38, WEEKDAYS_33, DAYS_NUMBERS_43, SHAPE_MOTION_43, SIMILARITY_43), default=GROUPED_38)
    args = parser.parse_args()
    main(args.dataset_root, args.candidate)
