"""Train and evaluate an isolated 22-class candidate; never update live models."""
from processed_paths import processed_glob, resolve_artifact_path
from model_paths import model_artifact_folder
import argparse
from collections import Counter
from datetime import datetime, timezone
import gc
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
os.environ.setdefault('OMP_NUM_THREADS', '4')
import numpy as np

SEEDS = (42, 43, 44)
NON_SIGN = {'REST', 'IDLE_MOVEMENT'}


def read(path):
    path = resolve_artifact_path(path)
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def sha(path):
    path = resolve_artifact_path(path)
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def score(probabilities, labels, truth):
    from sklearn.metrics import classification_report, confusion_matrix
    ranked = np.argsort(probabilities, axis=1)[:, ::-1]
    predicted = np.asarray(labels)[ranked[:, 0]]
    confident = (probabilities[np.arange(len(truth)), ranked[:, 0]] >= .63) & (
        probabilities[np.arange(len(truth)), ranked[:, 0]] - probabilities[np.arange(len(truth)), ranked[:, 1]] >= .15)
    truth = np.asarray(truth)
    sign = ~np.isin(truth, list(NON_SIGN))
    predicted_sign = ~np.isin(predicted, list(NON_SIGN))
    accepted_sign = confident & predicted_sign
    correct = predicted == truth
    report_labels = sorted(set(labels) | set(truth))
    report = classification_report(truth, predicted, labels=report_labels, output_dict=True, zero_division=0)
    result = dict(total=len(truth), overallAccuracy=float(correct.mean()), macroF1=float(report['macro avg']['f1-score']),
        signSamples=int(sign.sum()), signCorrect=int((correct & sign).sum()),
        signAccuracy=float(correct[sign].mean()), signCorrectAccepted=int((sign & correct & accepted_sign).sum()),
        signWrongAccepted=int((sign & ~correct & accepted_sign).sum()), signAbstained=int((sign & ~accepted_sign).sum()),
        signPredictedNonSign=int((sign & ~predicted_sign).sum()), nonSignSamples=int((~sign).sum()),
        nonSignExactCorrect=int((~sign & correct).sum()), nonSignFalseSignAccepted=int((~sign & accepted_sign).sum()),
        nonSignPredictedSign=int((~sign & predicted_sign).sum()),
        perClass=report, confusionLabels=report_labels,
        confusionMatrix=confusion_matrix(truth, predicted, labels=report_labels).tolist())
    result['nonSignByCategory'] = {}
    for label in sorted(NON_SIGN):
        mask = truth == label
        result['nonSignByCategory'][label] = dict(total=int(mask.sum()), correct=int((mask & correct).sum()),
            acceptedAsSign=int((mask & accepted_sign).sum()), predictedAsOtherNonSign=int((mask & ~correct & ~predicted_sign).sum()))
    return result


def run(dataset_root, prepared, output):
    dataset_root, prepared, output = dataset_root.resolve(), prepared.resolve(), output.resolve()
    if output.exists() or dataset_root / 'experiments' not in output.parents:
        raise ValueError('Use a NEW output folder inside dataset-root/experiments')
    checks = read(prepared / 'checksums.json')
    for relative, expected in checks.items():
        if sha(prepared / relative) != expected:
            raise ValueError('Prepared dataset checksum mismatch: ' + relative)
    manifest = read(prepared / 'manifest.json')
    protected = dict(manifest['protectedFileSha256'])
    # Include live service code and every prepared artifact in the integrity check.
    repo = Path(__file__).resolve().parent.parent
    for p in [repo / 'Backend/app/recognition.py', *[p for p in prepared.rglob('*') if p.is_file()]]:
        protected[str(p)] = sha(p)
    for p, expected in protected.items():
        if sha(p) != expected:
            raise ValueError('Protected source changed since preparation: ' + p)
    folds = sorted((prepared / 'folds').iterdir())
    if len(folds) != 3:
        raise ValueError('Expected three participant-held-out folds')
    output.mkdir(parents=True)
    (output / 'models').mkdir(parents=True); (output / 'baseline_predictions').mkdir(parents=True)
    shutil.copy2(__file__, output / Path(__file__).name)
    write(output / 'protocol.json', dict(createdAt=datetime.now(timezone.utc).isoformat(), prepared=str(prepared),
        seeds=SEEDS, architecture='GRU64, Dropout0.30, Dense32 relu, Dropout0.20, Dense22 softmax',
        optimizer='Adam 0.001', batchSize=16, epochsLimit=100,
        checkpointSelection='minimum validation loss; early stopping patience15; LR reduction factor0.5 patience5 min1e-5',
        classWeighting=None, augmentation=None, thresholds=dict(confidence=.63, margin=.15),
        comparison='Matched held-out v5 seed ensembles; deployed nine-member ensemble additionally reported as descriptive/in-sample for signs',
        constraints='No tuning on test results, no model promotion; isolated clips cannot measure continuous boundaries or false triggers per minute',
        protectedFileSha256=protected))
    import tensorflow as tf
    tf.config.threading.set_intra_op_parallelism_threads(4)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    write(output / 'environment.json', dict(tensorflow=tf.__version__, numpy=np.__version__,
        devices=[str(d) for d in tf.config.list_physical_devices()]))
    print('Validated prepared dataset. Training on', tf.config.list_physical_devices(), flush=True)

    class Progress(tf.keras.callbacks.Callback):
        def __init__(self, name):
            super().__init__(); self.name = name
        def on_epoch_end(self, epoch, logs=None):
            if epoch == 0 or (epoch + 1) % 10 == 0:
                print(f'{self.name} epoch {epoch+1}: loss={logs["loss"]:.4f} val_loss={logs["val_loss"]:.4f} val_acc={logs["val_accuracy"]:.4f}', flush=True)

    per_run = []
    for folder in folds:
        metadata = read(folder / 'metadata.json')
        labels = [name for name, i in sorted(metadata['labelToIndex'].items(), key=lambda x: x[1])]
        assert len(labels) == 22 and set(metadata['sequenceIds']['training']).isdisjoint(metadata['sequenceIds']['test'])
        with np.load(folder / 'gru_data.npz', allow_pickle=False) as data:
            arrays = {key: data[key].copy() for key in data.files}
        for seed in SEEDS:
            tf.keras.backend.clear_session(); gc.collect()
            tf.keras.utils.set_random_seed(seed)
            name = folder.name + f'_seed{seed}'
            dest = output / 'models' / name; dest.mkdir(parents=True)
            model = tf.keras.Sequential([
                tf.keras.layers.Input(shape=(40, 238), name='landmark_sequence'),
                tf.keras.layers.GRU(64, name='gru'), tf.keras.layers.Dropout(.30, name='gru_dropout'),
                tf.keras.layers.Dense(32, activation='relu', name='dense'), tf.keras.layers.Dropout(.20, name='dense_dropout'),
                tf.keras.layers.Dense(22, activation='softmax', name='sign_probabilities')], name='signsync_gru_sign_rest_idle')
            model.compile(optimizer=tf.keras.optimizers.Adam(.001), loss='sparse_categorical_crossentropy', metrics=['accuracy'])
            started = time.monotonic()
            callbacks = [tf.keras.callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True),
                tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss', factor=.5, patience=5, min_lr=.00001),
                tf.keras.callbacks.ModelCheckpoint(str(dest / 'best_model.h5'), monitor='val_loss', save_best_only=True),
                tf.keras.callbacks.CSVLogger(str(dest / 'epochs.csv')), Progress(name)]
            print('START', name, flush=True)
            history = model.fit(arrays['X_train'], arrays['y_train'], validation_data=(arrays['X_validation'], arrays['y_validation']),
                epochs=100, batch_size=16, callbacks=callbacks, verbose=0)
            # Evaluate the persisted best-validation checkpoint, not final epoch weights.
            model = tf.keras.models.load_model(dest / 'best_model.h5', compile=False)
            probs = model.predict(arrays['X_test'], batch_size=64, verbose=0)
            assert probs.shape == (451, 22) and np.isfinite(probs).all()
            truth = np.asarray(labels)[arrays['y_test']]
            metrics = score(probs, labels, truth)
            evaluation = dict(seed=seed, fold=folder.name, heldOut=metadata['testParticipant'],
                epochs=len(history.history['loss']), bestEpoch=int(np.argmin(history.history['val_loss']))+1,
                seconds=time.monotonic()-started, preprocessingMetadata=metadata, metrics=metrics)
            write(dest / 'evaluation.json', evaluation)
            write(dest / 'history.json', history.history)
            np.savez_compressed(dest / 'predictions.npz', probabilities=probs, y_true=arrays['y_test'],
                sequence_ids=np.asarray(metadata['sequenceIds']['test']))
            per_run.append({k: v for k, v in evaluation.items() if k != 'preprocessingMetadata'})
            write(output / 'training_progress.json', per_run)
            print(f'DONE {name}: {evaluation["epochs"]} epochs, sign_acc={metrics["signAccuracy"]:.4f}, non_sign_false_accept={metrics["nonSignFalseSignAccepted"]}/51', flush=True)
    compare(tf, dataset_root, prepared, output, folds, per_run)
    changed = [p for p, expected in protected.items() if sha(p) != expected]
    write(output / 'integrity.json', dict(protectedFileCount=len(protected), unchanged=not changed, changedFiles=changed,
        liveCheckpointCount=manifest['liveCheckpointsVerifiedUnchanged']))
    if changed:
        raise RuntimeError('Protected files changed: ' + str(changed))
    print('COMPLETE: all source datasets and live checkpoints unchanged.', flush=True)


def compare(tf, dataset_root, prepared, output, folds, per_run):
    from run_recordings_v5_experiments import raw_geometry_features, standardize_for_model
    grouped = {}; pooled = {key: [] for key in ['baselineHeldOut', 'candidateHeldOut', 'deployedEnsembleDescriptive']}
    truths = []
    # Predict all nine saved live members on each participant, selecting only
    # their held-out three-member subset for the fair model comparison.
    for folder in folds:
        meta = read(folder / 'metadata.json'); p = meta['testParticipant']
        dataset = read(prepared / 'datasets' / f'{p}-sign-rest-idle-v1.json')
        source = {s['id']: s for s in dataset['sequences']}
        ordered = [source[sid] for sid in meta['sequenceIds']['test']]
        raw = np.stack([raw_geometry_features(s, dataset['featureSchema']['order'], 40) for s in ordered])
        truth = np.asarray([s['label'] for s in ordered]); truths.extend(truth.tolist())
        labels = [k for k, v in sorted(meta['labelToIndex'].items(), key=lambda x:x[1])]
        candidate = []
        for seed in SEEDS:
            with np.load(output / 'models' / (folder.name + f'_seed{seed}') / 'predictions.npz', allow_pickle=False) as a:
                np.testing.assert_array_equal(a['sequence_ids'], meta['sequenceIds']['test'])
                candidate.append(a['probabilities'].copy())
        candidate = np.mean(candidate, axis=0)
        all_old, held_old = [], []
        baseline_labels = None
        for baseline_folder in sorted(processed_glob(dataset_root / 'processed', 'gru_*_geometry_v3_recordings_v5')):
            bm = read(baseline_folder / 'metadata.json')
            current_labels = [k for k,v in sorted(bm['labelToIndex'].items(), key=lambda x:x[1])]
            assert baseline_labels is None or baseline_labels == current_labels
            baseline_labels = current_labels
            with np.load(baseline_folder / 'gru_data.npz', allow_pickle=False) as a:
                x = standardize_for_model(raw, a['feature_mean'], a['feature_std'])
            for seed in SEEDS:
                run = baseline_folder.name + (f'_seed{seed}' if seed != 42 else '')
                saved_folder = model_artifact_folder(dataset_root / 'models', 'gru_model_train_test_geometry_v3_recordings_v5') / run
                tf.keras.backend.clear_session(); gc.collect()
                model = tf.keras.models.load_model(saved_folder / 'best_model.h5', compile=False)
                prob = model.predict(x, batch_size=64, verbose=0)
                assert prob.shape == (451, 20) and np.isfinite(prob).all()
                all_old.append(prob)
                if bm['testParticipant'] == p:
                    held_old.append(prob)
                    positions = {sid:i for i,sid in enumerate(meta['sequenceIds']['test'])}
                    ix = [positions[sid] for sid in bm['sequenceIds']['test']]
                    actual = np.mean(np.asarray(current_labels)[prob[ix].argmax(axis=1)] == truth[ix])
                    recorded = read(saved_folder / 'evaluation.json')['testAccuracy']
                    if not np.isclose(actual, recorded, atol=1e-6):
                        raise ValueError(f'Baseline sign accuracy differs: {run}: {actual} vs {recorded}')
                    if (saved_folder / 'predictions.npz').exists():
                        with np.load(saved_folder / 'predictions.npz', allow_pickle=False) as old_predictions:
                            ix = [positions[str(sid)] for sid in old_predictions['sequence_ids']]
                            np.testing.assert_allclose(prob[ix], old_predictions['probabilities'], rtol=2e-4, atol=2e-4)
                np.savez_compressed(output / 'baseline_predictions' / f'{p}__{run}.npz',
                    probabilities=prob, sequence_ids=np.asarray(meta['sequenceIds']['test']), labels=np.asarray(current_labels))
        assert len(held_old)==3 and len(all_old)==9
        probabilities = dict(baselineHeldOut=np.mean(held_old,axis=0), candidateHeldOut=candidate,
            deployedEnsembleDescriptive=np.mean(all_old,axis=0))
        grouped[p] = {}
        for key, prob in probabilities.items():
            model_labels = labels if key == 'candidateHeldOut' else baseline_labels
            grouped[p][key] = score(prob, model_labels, truth)
            pooled[key].append(prob)
        # Capture validation currently precedes live inference. Report its effect
        # only for the deployed ensemble; primary comparison retains every clip.
        allowed=[]
        for s in ordered:
            frames=s['frames']; v=np.asarray([f['features'] for f in frames]); t=np.asarray([f['timestamp'] for f in frames])
            allowed.append(8 <= len(frames) <= 240 and np.all(np.diff(t)>0) and 400 <= t[-1]-t[0] <=10000
                and np.mean([f['valid'] for f in frames]) >= .8 and np.mean(v[:,[36,100]].max(axis=1)) >= .5)
        allowed=np.asarray(allowed)
        deployed=probabilities['deployedEnsembleDescriptive']; ranked=np.sort(deployed,axis=1)
        accepts=(ranked[:,-1]>=.63)&(ranked[:,-1]-ranked[:,-2]>=.15)&allowed
        grouped[p]['deployedCaptureGate'] = dict(rejectedClips=int((~allowed).sum()),
            nonSignFalseAccepted=int((accepts & np.isin(truth,list(NON_SIGN))).sum()))
        print('COMPARED',p, 'baseline/candidate sign accuracy', grouped[p]['baselineHeldOut']['signAccuracy'],
            grouped[p]['candidateHeldOut']['signAccuracy'],flush=True)
        del dataset, source, ordered, raw, x, model; gc.collect()
    aggregate = {key: score(np.concatenate(arrays), labels if key=='candidateHeldOut' else baseline_labels, truths) for key,arrays in pooled.items()}
    comparison=dict(byParticipant=grouped,aggregate=aggregate,individualCandidateRuns=per_run,
        confidence=.63,margin=.15,baselineSignAccuracyReproduced=True,
        limitations=['Fixed isolated clips; not false activations per minute or continuous boundary accuracy.',
            'Primary comparison uses participant-held-out three-seed ensembles, not all nine deployed members.',
            'Deployed nine-member results are descriptive: six members saw each participant in training/validation.',
            'P1-P3 informed prior development; later non-sign sessions may introduce session confounding.',
            'P1 rest postures unspecified; no General idle recordings.'])
    write(output/'comparison.json',comparison)
    b,c=aggregate['baselineHeldOut'],aggregate['candidateHeldOut']
    lines=['# Sign/rest/idle candidate evaluation','',
        'Nine candidate checkpoints: three held-out-participant folds x seeds 42/43/44. Same GRU architecture and optimization settings as v5, with 22 output classes. Minimum validation-loss checkpoint selected; test results were not used for tuning. No live promotion.','',
        '## Fair held-out comparison','',
        'Three-seed probabilities averaged within each fold; pooled across 1,200 signs and 153 non-sign clips. Thresholds fixed at 0.63 confidence and 0.15 margin. REST/IDLE_MOVEMENT predictions do not emit signs.','',
        '| Metric | Current v5 held-out members | Candidate |','|---|---:|---:|',
        f'| Sign top-1 accuracy | {b["signAccuracy"]:.2%} | {c["signAccuracy"]:.2%} |',
        f'| Correct signs accepted / 1200 | {b["signCorrectAccepted"]} | {c["signCorrectAccepted"]} |',
        f'| Incorrect signs accepted / 1200 | {b["signWrongAccepted"]} | {c["signWrongAccepted"]} |',
        f'| Non-sign clips accepted as signs / 153 | {b["nonSignFalseSignAccepted"]} | {c["nonSignFalseSignAccepted"]} |',
        f'| Exact REST/IDLE recognition / 153 | Not supported | {c["nonSignExactCorrect"]} |',
        '',f'Candidate 22-class accuracy: {c["overallAccuracy"]:.2%}; macro F1: {c["macroF1"]:.4f}.',
        '', '## By held-out participant','', '| Participant | v5 sign accuracy | Candidate sign accuracy | v5 non-sign false accepts / 51 | Candidate non-sign false accepts / 51 |', '|---|---:|---:|---:|---:|']
    for p,groups in grouped.items():
        b,c=groups['baselineHeldOut'],groups['candidateHeldOut']
        lines.append(f'| {p} | {b["signAccuracy"]:.2%} | {c["signAccuracy"]:.2%} | {b["nonSignFalseSignAccepted"]} | {c["nonSignFalseSignAccepted"]} |')
    lines+=['','## Per-sign recall','', '| Sign | v5 correct / 60 | Candidate correct / 60 |','|---|---:|---:|']
    for label in baseline_labels:
        b=aggregate['baselineHeldOut']['perClass'][label];c=aggregate['candidateHeldOut']['perClass'][label]
        lines.append(f'| {label} | {round(b["recall"]*b["support"])} | {round(c["recall"]*c["support"])} |')
    d=aggregate['deployedEnsembleDescriptive']
    lines+=['','## Deployed nine-model ensemble (descriptive only)','',
        f'Sign accuracy {d["signAccuracy"]:.2%}; non-sign false sign accepts {d["nonSignFalseSignAccepted"]}/153 before the live capture-quality gate, '+
        f'{sum(g["deployedCaptureGate"]["nonSignFalseAccepted"] for g in grouped.values())}/153 after that gate.',
        'Six of nine live members saw each participant during training/validation, so these results are not an unseen-participant comparison. The primary table uses only the three appropriate held-out members.','',
        '## Limitations','', *['- '+item for item in comparison['limitations']], '',
        'Existing live checkpoints, prepared data and backend recognition code are protected by SHA-256 checks in protocol.json and integrity.json. Models and predictions are stored only in this experiment folder.']
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from sklearn.metrics import ConfusionMatrixDisplay
    m=aggregate['candidateHeldOut']
    fig,ax=plt.subplots(figsize=(14,13))
    ConfusionMatrixDisplay(np.asarray(m['confusionMatrix']),display_labels=m['confusionLabels']).plot(ax=ax,xticks_rotation=90,colorbar=False)
    ax.set_title('22-class candidate: held-out three-seed ensembles (1,353 clips)')
    fig.tight_layout();fig.savefig(output/'candidate_confusion_matrix.png',dpi=150);plt.close(fig)
    print(json.dumps({key:{k:v for k,v in m.items() if k not in ['perClass','confusionLabels','confusionMatrix']} for key,m in aggregate.items()}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root',type=Path,required=True)
    parser.add_argument('--prepared',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--compare-only',action='store_true',help='Finish comparison for nine completed runs; never retrain')
    args=parser.parse_args()
    if args.compare_only:
        output=args.output.resolve(); prepared=args.prepared.resolve()
        protocol=read(output/'protocol.json')
        if protocol['prepared'] != str(prepared) or (output/'comparison.json').exists():
            raise ValueError('Prepared data mismatch or comparison already completed')
        protected=protocol['protectedFileSha256']
        for p,expected in protected.items():
            if sha(p)!=expected: raise ValueError('Protected source changed: '+p)
        per_run=read(output/'training_progress.json')
        if len(per_run)!=9: raise ValueError('Expected nine completed training runs')
        import tensorflow as tf
        tf.config.threading.set_intra_op_parallelism_threads(4)
        tf.config.threading.set_inter_op_parallelism_threads(1)
        shutil.copy2(__file__,output/Path(__file__).name)
        compare(tf,args.dataset_root.resolve(),prepared,output,sorted((prepared/'folds').iterdir()),per_run)
        changed=[p for p,expected in protected.items() if sha(p)!=expected]
        write(output/'integrity.json',dict(protectedFileCount=len(protected),unchanged=not changed,
            changedFiles=changed,liveCheckpointCount=read(prepared/'manifest.json')['liveCheckpointsVerifiedUnchanged']))
        if changed: raise RuntimeError('Protected sources changed')
        print('COMPLETE: all source datasets and live checkpoints unchanged.',flush=True)
    else:
        run(args.dataset_root,args.prepared,args.output)
