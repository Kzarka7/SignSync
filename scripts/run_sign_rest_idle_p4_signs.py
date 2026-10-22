"""Add reviewed P4 signs to the frozen P1-P3 sign/rest/idle experiment.

No live promotion or modification of existing artifacts. HDF5 checkpoints are
used because native Keras saves stall on this Windows environment.
"""
from processed_paths import processed_artifact_path, processed_glob
import argparse
from collections import Counter
from datetime import datetime, timezone
import gc
import os
from pathlib import Path
import shutil
import time

os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
os.environ.setdefault('OMP_NUM_THREADS', '4')
import numpy as np

from merge_dataset import merge
from run_recordings_v5_experiments import raw_geometry_features
from train_sign_rest_idle import SEEDS, NON_SIGN, read, write, sha, score


def verify(protected):
    changed = [path for path, expected in protected.items() if sha(path) != expected]
    if changed:
        raise ValueError('Protected files changed: ' + str(changed))


def prepare(root, prepared, baseline, output):
    if output.exists() or root / 'experiments' not in output.parents:
        raise ValueError('Output must be a NEW folder in dataset-root/experiments')
    protected = dict(read(baseline / 'protocol.json')['protectedFileSha256'])
    for base, name in [(prepared, 'checksums.json'), (baseline, 'artifact_checksums.json')]:
        for relative, expected in read(base / name).items():
            if sha(base / relative) != expected:
                raise ValueError('Reference artifact mismatch: ' + str(base / relative))
        for path in base.rglob('*'):
            if path.is_file():
                protected[str(path)] = sha(path)
    if not read(baseline / 'integrity.json')['unchanged']:
        raise ValueError('Baseline integrity was not confirmed')
    review_root = root / 'experiments' / 'p4_which_replacement_v1'
    p4, warnings, scanned = merge(root / 'clean' / 'participant_04' / 'merge-input-v5')
    reviewed_path = processed_artifact_path(review_root / 'processed', 'participant_04-dataset-v6.json')
    reviewed = read(reviewed_path)
    if warnings or scanned != 400 or len(p4['sequences']) != 400:
        raise ValueError('Expected exactly 400 reviewed P4 signs without merge warnings')
    if {s['id']: s for s in p4['sequences']} != {s['id']: s for s in reviewed['sequences']}:
        raise ValueError('Clean P4 samples differ from the reviewed replacement experiment')
    if len(p4['labels']) != 20 or set(Counter(s['label'] for s in p4['sequences']).values()) != {20}:
        raise ValueError('P4 signs must have 20 labels and 20 recordings each')
    protected[str(reviewed_path)] = sha(reviewed_path)
    for path in (root / 'clean' / 'participant_04' / 'merge-input-v5').glob('*.json'):
        protected[str(path)] = sha(path)
    protected[str(review_root / 'source-provenance.json')] = sha(review_root / 'source-provenance.json')
    sources = {}
    for p in ['participant_01', 'participant_02', 'participant_03']:
        sources[p] = read(prepared / 'datasets' / f'{p}-sign-rest-idle-v1.json')
    schema = sources['participant_01']['featureSchema']
    labels = sources['participant_01']['labels']
    if p4['featureSchema'] != schema or set(p4['labels']) != set(labels) - NON_SIGN:
        raise ValueError('P4 schema or sign label set differs')
    p4_ids = [s['id'] for s in p4['sequences']]
    existing_ids = {s['id'] for d in sources.values() for s in d['sequences']}
    if len(set(p4_ids)) != 400 or existing_ids & set(p4_ids):
        raise ValueError('P4 sample IDs overlap or duplicate')
    quality = dict(samples=400, minimumFrames=min(len(s['frames']) for s in p4['sequences']),
        minimumDurationMs=min(s['durationMs'] for s in p4['sequences']), lowFpsSamples=0)
    for s in p4['sequences']:
        frames=s['frames']; values=np.asarray([f['features'] for f in frames]); times=np.asarray([f['timestamp'] for f in frames])
        if values.shape != (len(frames), 164) or not np.isfinite(values).all() or np.any(np.diff(times) <= 0):
            raise ValueError('Invalid reviewed P4 frames: ' + s['id'])
        fps=(len(frames)-1)*1000/s['durationMs'] if s['durationMs']>0 else 0
        quality['lowFpsSamples'] += int(fps<10)
    raw = {p: np.stack([raw_geometry_features(s, schema['order'], 40) for s in d['sequences']]) for p,d in sources.items()}
    raw['participant_04'] = np.stack([raw_geometry_features(s, schema['order'], 40) for s in p4['sequences']])
    if any(not np.isfinite(x).all() or x.shape[1:]!=(40,238) for x in raw.values()):
        raise ValueError('Invalid feature reconstruction')
    mapping={label:i for i,label in enumerate(labels)}
    ids={p:[s['id'] for s in d['sequences']] for p,d in sources.items()}
    ids['participant_04']=p4_ids
    targets={p:np.asarray([mapping[s['label']] for s in d['sequences']],dtype=np.int64) for p,d in sources.items()}
    targets['participant_04']=np.asarray([mapping[s['label']] for s in p4['sequences']],dtype=np.int64)
    output.mkdir(parents=True)
    for name in ['datasets','folds','models','source']:
        (output/name).mkdir(parents=True)
    # Existing P1-P3 merged files are copied exactly; their sources are frozen.
    for p in sources:
        shutil.copy2(prepared/'datasets'/f'{p}-sign-rest-idle-v1.json',output/'datasets'/f'{p}-sign-rest-idle-v1.json')
    write(output/'datasets'/'participant_04-reviewed-signs.json',p4)
    repo=Path(__file__).resolve().parent
    for name in [Path(__file__).name,'train_sign_rest_idle.py','run_recordings_v5_experiments.py',
                 'preprocess_dataset.py','prepare_handshape_experiments.py','prepare_geometry_experiments.py',
                 'gesture_geometry.py','model_paths.py','processed_paths.py','merge_dataset.py']:
        path=repo/name;protected[str(path)]=sha(path);shutil.copy2(path,output/'source'/name)
    fold_reports=[]
    for original in sorted((prepared/'folds').iterdir()):
        meta=read(original/'metadata.json');held_out=meta['testParticipant']
        reference=[p for p in processed_glob(review_root/'processed', 'gru_*/metadata.json') if read(p)['testParticipant']==held_out]
        if len(reference)!=1:raise ValueError('Ambiguous reviewed P4 split reference')
        reference_path=reference[0];protected[str(reference_path)]=sha(reference_path);p4_meta=read(reference_path)
        split_ids={s:list(meta['sequenceIds'][s]) for s in ['training','validation','test']}
        members={s:list(meta['participantIds'][s]) for s in split_ids}
        xs={};ys={}
        with np.load(original/'gru_data.npz',allow_pickle=False) as old_arrays:
            old_raw={}
            for split in split_ids:
                pos={p:{sid:i for i,sid in enumerate(ids[p])} for p in sources}
                old_raw[split]=np.stack([raw[p][pos[p][sid]] for sid,p in zip(split_ids[split],members[split])])
                suffix={'training':'train','validation':'validation','test':'test'}[split]
                reconstructed=((old_raw[split]-old_arrays['feature_mean'])/old_arrays['feature_std']).astype(np.float32)
                np.testing.assert_allclose(reconstructed,old_arrays['X_'+suffix],rtol=2e-5,atol=2e-4)
            for split in ['training','validation']:
                addition=[sid for sid,p in zip(p4_meta['sequenceIds'][split],p4_meta['participantIds'][split]) if p=='participant_04']
                if len(addition)!=(320 if split=='training' else 80):raise ValueError('Wrong P4 split count')
                p4pos={sid:i for i,sid in enumerate(p4_ids)};ix=[p4pos[sid] for sid in addition]
                xs[split]=np.concatenate([old_raw[split],raw['participant_04'][ix]])
                suffix='train' if split=='training' else 'validation'
                ys[split]=np.concatenate([old_arrays['y_'+suffix],targets['participant_04'][ix]])
                split_ids[split].extend(addition);members[split].extend(['participant_04']*len(addition))
            xs['test']=old_raw['test'];ys['test']=old_arrays['y_test'].copy()
        sets=[set(v) for v in split_ids.values()]
        if any(a&b for i,a in enumerate(sets) for b in sets[i+1:]) or set.union(*sets)!=existing_ids|set(p4_ids):
            raise ValueError('Overlapping or missing split IDs')
        assert split_ids['test']==meta['sequenceIds']['test'] and members['test']==meta['participantIds']['test']
        assert held_out not in members['training']+members['validation']
        mean=xs['training'].mean(axis=(0,1),keepdims=True);std=xs['training'].std(axis=(0,1),keepdims=True);std[std<1e-6]=1
        arrays=dict(feature_mean=mean.astype(np.float32),feature_std=std.astype(np.float32))
        for split,suffix in [('training','train'),('validation','validation'),('test','test')]:
            arrays['X_'+suffix]=((xs[split]-mean)/std).astype(np.float32);arrays['y_'+suffix]=ys[split]
            assert np.isfinite(arrays['X_'+suffix]).all()
        name=original.name.replace('_sign_rest_idle_v1','_sign_rest_idle_p4_signs_v1')
        dest=output/'folds'/name;dest.mkdir(parents=True);np.savez_compressed(dest/'gru_data.npz',**arrays)
        new_meta=dict(meta)
        new_meta.update(trainingParticipants=meta['trainingParticipants']+['participant_04'],sequenceIds=split_ids,participantIds=members,
            trainSources=[str(output/'datasets'/f'{p}-sign-rest-idle-v1.json') for p in meta['trainingParticipants']]+[str(output/'datasets'/'participant_04-reviewed-signs.json')],
            testSource=str(output/'datasets'/f'{held_out}-sign-rest-idle-v1.json'),
            sourceSha256={str(p):sha(p) for p in (output/'datasets').glob('*.json')},
            baselineCandidateFold=original.name,p4SplitReference=str(reference_path),
            split=dict(seed=42,validationPerLabel=4,existingAssignments='All P1-P3 IDs and membership retained; P4 uses reviewed experiment assignments',
                counts={s:dict(Counter(labels[int(y)] for y in v)) for s,v in ys.items()}),
            purpose='P4 signs-only addition; same P1-P3 held-out tests; no P4 rest/idle data or P4 holdout claim')
        write(dest/'metadata.json',new_meta)
        with np.load(dest/'gru_data.npz',allow_pickle=False) as saved:
            for key,value in arrays.items():np.testing.assert_array_equal(saved[key],value)
        result=dict(fold=name,baselineFold=original.name,heldOut=held_out,
            counts={s:len(v) for s,v in ys.items()},p1p3AssignmentsUnchanged=True,testRawFeaturesUnchanged=True)
        fold_reports.append(result);print('PREPARED',result,flush=True)
    verify(protected)
    protocol=dict(createdAt=datetime.now(timezone.utc).isoformat(),datasetRoot=str(root),preparedBaseline=str(prepared),baselineModels=str(baseline),
        reviewedP4Source=str(reviewed_path),p4SourceFiles=400,p4Quality=quality,folds=fold_reports,
        seeds=list(SEEDS),architecture='GRU64, Dropout0.30, Dense32 relu, Dropout0.20, Dense22 softmax',
        optimizer='Adam 0.001',batchSize=16,epochsLimit=100,earlyStoppingPatience=15,
        learningRateReduction='factor0.5, patience5, min1e-5',checkpointSelection='minimum validation loss',
        classWeighting=None,augmentation=None,confidence=.63,margin=.15,
        protectedFileSha256=protected,
        limitations=['P4 contributes only signs; no P4 non-sign performance can be inferred.',
            'Same P1-P3 development test sets reused; no independent confirmation or continuous boundary evaluation.',
            'Training normalization refitted after adding P4; existing normalization and artifacts unchanged.',
            'All reviewed P4 samples retained, including low-FPS clips; no relabeling or filtering.'])
    write(output/'protocol.json',protocol)
    return protocol


def train_and_compare(root,prepared,baseline,output,protocol):
    import tensorflow as tf
    tf.config.threading.set_intra_op_parallelism_threads(4);tf.config.threading.set_inter_op_parallelism_threads(1)
    write(output/'environment.json',dict(tensorflow=tf.__version__,numpy=np.__version__,devices=[str(x) for x in tf.config.list_physical_devices()]))
    print('TRAINING DEVICES',tf.config.list_physical_devices(),flush=True)
    class Progress(tf.keras.callbacks.Callback):
        def __init__(self,name):super().__init__();self.name=name
        def on_epoch_end(self,epoch,logs=None):
            if epoch==0 or (epoch+1)%10==0:print(f'{self.name} epoch {epoch+1}: loss={logs["loss"]:.4f} val_loss={logs["val_loss"]:.4f} val_acc={logs["val_accuracy"]:.4f}',flush=True)
    runs=[]
    for fold in sorted((output/'folds').iterdir()):
        meta=read(fold/'metadata.json');labels=[k for k,v in sorted(meta['labelToIndex'].items(),key=lambda x:x[1])]
        with np.load(fold/'gru_data.npz',allow_pickle=False) as data:arrays={k:data[k].copy() for k in data.files}
        for seed in SEEDS:
            name=fold.name+f'_seed{seed}';dest=output/'models'/name
            if (dest/'evaluation.json').exists():
                evaluation=read(dest/'evaluation.json')
                if evaluation['seed']!=seed or evaluation['preprocessingMetadata']!=meta:raise ValueError('Incompatible completed run')
                runs.append({k:v for k,v in evaluation.items() if k!='preprocessingMetadata'});continue
            if dest.exists():raise ValueError('Incomplete run directory; preserve it before restart: '+str(dest))
            tf.keras.backend.clear_session();gc.collect();tf.keras.utils.set_random_seed(seed);dest.mkdir(parents=True)
            model=tf.keras.Sequential([tf.keras.layers.Input(shape=(40,238),name='landmark_sequence'),
                tf.keras.layers.GRU(64,name='gru'),tf.keras.layers.Dropout(.30,name='gru_dropout'),
                tf.keras.layers.Dense(32,activation='relu',name='dense'),tf.keras.layers.Dropout(.20,name='dense_dropout'),
                tf.keras.layers.Dense(22,activation='softmax',name='sign_probabilities')],name='signsync_gru_sign_rest_idle')
            model.compile(optimizer=tf.keras.optimizers.Adam(.001),loss='sparse_categorical_crossentropy',metrics=['accuracy'])
            callbacks=[tf.keras.callbacks.EarlyStopping(monitor='val_loss',patience=15,restore_best_weights=True),
                tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss',factor=.5,patience=5,min_lr=.00001),
                tf.keras.callbacks.ModelCheckpoint(str(dest/'best_model.h5'),monitor='val_loss',save_best_only=True),
                tf.keras.callbacks.CSVLogger(str(dest/'epochs.csv')),Progress(name)]
            started=time.monotonic();print('START',name,flush=True)
            history=model.fit(arrays['X_train'],arrays['y_train'],validation_data=(arrays['X_validation'],arrays['y_validation']),
                epochs=100,batch_size=16,callbacks=callbacks,verbose=0)
            model=tf.keras.models.load_model(dest/'best_model.h5',compile=False)
            prob=model.predict(arrays['X_test'],batch_size=64,verbose=0)
            if prob.shape!=(451,22) or not np.isfinite(prob).all():raise ValueError('Invalid candidate probabilities')
            truth=np.asarray(labels)[arrays['y_test']];metrics=score(prob,labels,truth)
            evaluation=dict(seed=seed,fold=fold.name,heldOut=meta['testParticipant'],epochs=len(history.history['loss']),
                bestEpoch=int(np.argmin(history.history['val_loss']))+1,seconds=time.monotonic()-started,
                preprocessingMetadata=meta,metrics=metrics)
            write(dest/'evaluation.json',evaluation);write(dest/'history.json',history.history)
            np.savez_compressed(dest/'predictions.npz',probabilities=prob,y_true=arrays['y_test'],sequence_ids=np.asarray(meta['sequenceIds']['test']))
            runs.append({k:v for k,v in evaluation.items() if k!='preprocessingMetadata'});write(output/'training_progress.json',runs)
            print(f'DONE {name}: {evaluation["epochs"]} epochs sign_acc={metrics["signAccuracy"]:.4f} non_sign_false_accept={metrics["nonSignFalseSignAccepted"]}/51',flush=True)
    compare(prepared,baseline,output,runs,protocol)
    verify(protocol['protectedFileSha256'])
    write(output/'integrity.json',dict(unchanged=True,changedFiles=[],protectedFileCount=len(protocol['protectedFileSha256']),liveCheckpointCount=9))
    checks={str(p.relative_to(output)):sha(p) for p in output.rglob('*') if p.is_file() and p.name!='artifact_checksums.json'}
    write(output/'artifact_checksums.json',checks)
    print('COMPLETE: nine runs compared; original datasets, baseline candidates and live checkpoints unchanged.',flush=True)


def compare(prepared,baseline,output,runs,protocol):
    import csv
    pooled={'baseline':[],'p4Signs':[]};truths=[];groups={};paired=[];errors=[]
    for item in protocol['folds']:
        fold=item['fold'];meta=read(output/'folds'/fold/'metadata.json')
        labels=np.asarray([k for k,v in sorted(meta['labelToIndex'].items(),key=lambda x:x[1])])
        probabilities={key:[] for key in pooled}
        for seed in SEEDS:
            by_seed={}
            for key,folder in [('baseline',baseline/'models'/(item['baselineFold']+f'_seed{seed}')),
                               ('p4Signs',output/'models'/(fold+f'_seed{seed}'))]:
                with np.load(folder/'predictions.npz',allow_pickle=False) as saved:
                    np.testing.assert_array_equal(saved['sequence_ids'],meta['sequenceIds']['test'])
                    truth=labels[saved['y_true']];prob=saved['probabilities'].copy()
                probabilities[key].append(prob);by_seed[key]=score(prob,labels,truth)
            paired.append(dict(participant=item['heldOut'],seed=seed,baseline=by_seed['baseline'],p4Signs=by_seed['p4Signs']))
        ensemble={key:np.mean(values,axis=0) for key,values in probabilities.items()}
        groups[item['heldOut']]={key:score(prob,labels,truth) for key,prob in ensemble.items()}
        truths.extend(truth.tolist())
        for key,prob in ensemble.items():pooled[key].append(prob)
        oldpred=labels[ensemble['baseline'].argmax(1)];newpred=labels[ensemble['p4Signs'].argmax(1)]
        ranked=np.argsort(ensemble['p4Signs'],axis=1)[:,::-1]
        conf=ensemble['p4Signs'][np.arange(451),ranked[:,0]]
        margin=conf-ensemble['p4Signs'][np.arange(451),ranked[:,1]]
        for i,sid in enumerate(meta['sequenceIds']['test']):
            if newpred[i]!=truth[i] or oldpred[i]!=newpred[i]:
                errors.append(dict(participant=item['heldOut'],sequenceId=sid,trueLabel=str(truth[i]),baselineLabel=str(oldpred[i]),
                    p4SignsLabel=str(newpred[i]),p4SignsConfidence=float(conf[i]),p4SignsMargin=float(margin[i]),
                    p4SignsEmittedSign=bool(conf[i]>=.63 and margin[i]>=.15 and newpred[i] not in NON_SIGN)))
        print('COMPARED',item['heldOut'],{k:dict(signAccuracy=v['signAccuracy'],nonSignFalseSignAccepted=v['nonSignFalseSignAccepted']) for k,v in groups[item['heldOut']].items()},flush=True)
    aggregate={key:score(np.concatenate(values),labels,truths) for key,values in pooled.items()}
    write(output/'comparison.json',dict(aggregate=aggregate,byParticipant=groups,pairedRuns=paired,
        comparison='Same held-out IDs and true labels; P4 signs added only to training/validation; all nine runs retained',
        confidence=.63,margin=.15,limitations=protocol['limitations']))
    with (output/'error_review.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=list(errors[0]));writer.writeheader();writer.writerows(errors)
    b,c=aggregate['baseline'],aggregate['p4Signs']
    lines=['# P4 signs addition to sign/rest/idle recognition','',
        'Three P1-P3 held-out folds, seeds 42/43/44. Added reviewed P4 signs (320 training / 80 validation per fold). Existing P1-P3 assignments, test IDs, feature definitions, architecture and training settings are retained. Normalization is refitted on the enlarged training subset only. Minimum validation-loss checkpoints selected; test results not used for tuning.','',
        '## Three-seed ensemble comparison','', '| Metric | P1-P3 candidate | With P4 signs |','|---|---:|---:|',
        f'| Sign accuracy | {b["signAccuracy"]:.2%} | {c["signAccuracy"]:.2%} |',
        f'| Correct signs accepted / 1200 | {b["signCorrectAccepted"]} | {c["signCorrectAccepted"]} |',
        f'| Incorrect signs accepted / 1200 | {b["signWrongAccepted"]} | {c["signWrongAccepted"]} |',
        f'| Non-sign clips accepted as signs / 153 | {b["nonSignFalseSignAccepted"]} | {c["nonSignFalseSignAccepted"]} |',
        f'| Exact REST/IDLE labels / 153 | {b["nonSignExactCorrect"]} | {c["nonSignExactCorrect"]} |',
        f'| 22-class accuracy | {b["overallAccuracy"]:.2%} | {c["overallAccuracy"]:.2%} |',
        f'| Macro F1 | {b["macroF1"]:.4f} | {c["macroF1"]:.4f} |','',
        'Confidence 0.63 / margin 0.15 for both. REST/IDLE predictions do not emit signs. These are isolated-clip model results, without live segmentation or capture-quality filtering.','',
        '## By held-out participant','', '| Participant | Baseline signs | P4-added signs | Baseline non-sign false accepts / 51 | P4-added non-sign false accepts / 51 |','|---|---:|---:|---:|---:|']
    for p,g in groups.items():
        b,c=g['baseline'],g['p4Signs'];lines.append(f'| {p} | {b["signAccuracy"]:.2%} | {c["signAccuracy"]:.2%} | {b["nonSignFalseSignAccepted"]} | {c["nonSignFalseSignAccepted"]} |')
    lines+=['','## Per-sign correct predictions','', '| Label | Baseline | With P4 signs | Total |','|---|---:|---:|---:|']
    for label in labels:
        b,c=aggregate['baseline']['perClass'][label],aggregate['p4Signs']['perClass'][label]
        lines.append(f'| {label} | {round(b["recall"]*b["support"])} | {round(c["recall"]*c["support"])} | {int(c["support"])} |')
    lines+=['','## Paired individual runs','', '| Participant | Seed | Baseline sign accuracy | P4-added sign accuracy | P4-added non-sign false accepts / 51 |','|---|---:|---:|---:|---:|']
    for r in paired:lines.append(f'| {r["participant"]} | {r["seed"]} | {r["baseline"]["signAccuracy"]:.2%} | {r["p4Signs"]["signAccuracy"]:.2%} | {r["p4Signs"]["nonSignFalseSignAccepted"]} |')
    lines+=['','## Scope and integrity','',*['- '+item for item in protocol['limitations']],
        '- All original source data, prepared datasets, comparison models and live artifacts are protected by SHA-256 checks in protocol.json and integrity.json.',
        '- P4 contains no REST or IDLE_MOVEMENT examples. P1-P3 are the only held-out tests; no P4 generalization claim is made.',
        '- See error_review.csv for changed predictions and candidate errors. No model was deployed.']
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('AGGREGATE', {k:{field:v[field] for field in ['signAccuracy','signCorrectAccepted','signWrongAccepted','nonSignFalseSignAccepted','nonSignExactCorrect']} for k,v in aggregate.items()},flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root',type=Path,required=True)
    parser.add_argument('--prepared',type=Path,required=True)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--resume',action='store_true',help='Resume complete compatible runs; refuses incomplete run directories')
    args=parser.parse_args()
    root,prepared,baseline,output=[p.resolve() for p in [args.dataset_root,args.prepared,args.baseline,args.output]]
    if args.resume:
        protocol=read(output/'protocol.json')
        if protocol['datasetRoot']!=str(root) or protocol['preparedBaseline']!=str(prepared) or protocol['baselineModels']!=str(baseline):
            raise ValueError('Resume source paths differ')
        if (output/'comparison.json').exists():raise ValueError('Comparison already completed')
        verify(protocol['protectedFileSha256'])
    else:
        protocol=prepare(root,prepared,baseline,output)
    train_and_compare(root,prepared,baseline,output,protocol)
