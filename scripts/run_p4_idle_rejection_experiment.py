"""Isolated P4 IDLE-weighting and validation-only stricter acceptance experiment.

Reads frozen P4 candidate tensors. Never writes to deployed artifacts or app code.
"""
from processed_paths import resolve_artifact_path
import argparse
from datetime import datetime, timezone
import gc
import itertools
import os
from pathlib import Path
import shutil
import time
import csv
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
os.environ.setdefault('OMP_NUM_THREADS', '4')
import numpy as np
from train_sign_rest_idle import SEEDS, NON_SIGN, read, write, sha, score

BASE_RULE = dict(confidence=.63, margin=.15, maxNonSignMass=1., minAgreement=0.)

def decisions(members, labels, rule):
    prob = members.mean(axis=0)
    ranked = np.argsort(prob, axis=1)[:, ::-1]
    top = ranked[:, 0]
    confidence = prob[np.arange(len(prob)), top]
    margin = confidence - prob[np.arange(len(prob)), ranked[:, 1]]
    non_sign = np.isin(labels, list(NON_SIGN))
    agreement = (members.argmax(axis=2) == top[None, :]).mean(axis=0)
    accepted = (~non_sign[top] & (confidence >= rule['confidence']) & (margin >= rule['margin'])
                & (prob[:, non_sign].sum(axis=1) <= rule['maxNonSignMass'])
                & (agreement >= rule['minAgreement']))
    return np.asarray(labels)[top], accepted

def rejection_metrics(members, labels, truth, rule):
    pred, accepted = decisions(members, labels, rule)
    truth = np.asarray(truth)
    sign = ~np.isin(truth, list(NON_SIGN))
    correct = pred == truth
    return dict(total=len(truth), signSamples=int(sign.sum()), nonSignSamples=int((~sign).sum()),
        signAccuracy=float(correct[sign].mean()), signCorrect=int((sign & correct).sum()),
        signCorrectAccepted=int((sign & correct & accepted).sum()),
        signWrongAccepted=int((sign & ~correct & accepted).sum()),
        signRejected=int((sign & ~accepted).sum()),
        nonSignFalseSignAccepted=int((~sign & accepted).sum()),
        nonSignExactCorrect=int((~sign & correct).sum()),
        byNonSign={label:dict(total=int((truth==label).sum()),
            acceptedAsSign=int(((truth==label) & accepted).sum()),
            exactCorrect=int(((truth==label) & correct).sum())) for label in sorted(NON_SIGN)})

def select_rule(members, labels, truth):
    # This function sees validation truth only; test predictions are read later.
    base = rejection_metrics(members, labels, truth, BASE_RULE)
    minimum = base['signCorrectAccepted'] - int(np.floor(.02 * base['signSamples']))
    rows = []
    candidates = [BASE_RULE]
    candidates += [dict(confidence=c, margin=m, maxNonSignMass=n, minAgreement=a)
        for c,m,n,a in itertools.product((.63,.70,.80,.90,.95,.98,.995), (.15,.25,.40), (1.,.25,.10,.05,.01), (0.,2/3,1.))]
    for rule in candidates:
        metrics = rejection_metrics(members, labels, truth, rule)
        eligible = metrics['signCorrectAccepted'] >= minimum
        rows.append(dict(rule=rule,metrics=metrics,eligible=eligible))
    eligible = [r for r in rows if r['eligible']]
    # Reject false non-sign accepts first, then wrong signs. Retain the most
    # correctly accepted signs; prefer the least restrictive rule on exact ties.
    def objective(r):
        m,r = r['metrics'],r['rule']
        return (m['nonSignFalseSignAccepted'],m['signWrongAccepted'],-m['signCorrectAccepted'],
                r['confidence'],r['margin'],-r['maxNonSignMass'],r['minAgreement'])
    selected = min(eligible,key=objective)
    return dict(rule=selected['rule'],validation=selected['metrics'],baselineValidation=base,
        minimumCorrectAccepted=minimum,selection='validation only; <=2pp loss in correct-sign acceptance',search=rows)

def protect_check(protected):
    changed=[p for p,h in protected.items() if not resolve_artifact_path(p).is_file() or sha(p)!=h]
    if changed: raise ValueError('Protected files changed: '+str(changed))

def prepare(root, baseline, output):
    if output.exists() or root/'experiments' not in output.parents:
        raise ValueError('Use a NEW output folder inside dataset-root/experiments')
    for rel,h in read(baseline/'artifact_checksums.json').items():
        if sha(baseline/rel)!=h: raise ValueError('Baseline checksum mismatch: '+rel)
    repo=Path(__file__).resolve().parents[1]
    watched=[p for p in baseline.rglob('*') if p.is_file()]
    # Historical source hashes include app files intentionally changed since
    # the old experiment. Freeze their CURRENT values, not obsolete versions.
    watched += [resolve_artifact_path(p) for p in read(baseline/'protocol.json')['protectedFileSha256'] if resolve_artifact_path(p).is_file()]
    watched += [p for base in (repo/'Backend/app', repo/'Frontend/src') for p in base.rglob('*') if p.is_file() and '__pycache__' not in str(p)]
    watched += [Path(__file__), repo/'scripts/train_sign_rest_idle.py']
    protected={str(p):sha(p) for p in watched}
    output.mkdir(parents=True)
    for name in ('models','baseline_predictions','source','rules'): (output/name).mkdir()
    for name in (Path(__file__).name,'train_sign_rest_idle.py'):
        shutil.copy2(repo/'scripts'/name,output/'source'/name)
    protocol=dict(createdAt=datetime.now(timezone.utc).isoformat(),datasetRoot=str(root),baseline=str(baseline),
        folds=[p.name for p in sorted((baseline/'folds').iterdir()) if p.is_dir()],seeds=list(SEEDS),
        idleWeight=2.,otherClassWeights=1.,architecture='GRU64 Dropout.30 Dense32relu Dropout.20 Dense22softmax',
        optimizer='Adam .001',epochs=100,batchSize=16,earlyStoppingPatience=15,
        learningRateReduction='factor .5 patience5 min1e-5',checkpointSelection='minimum unweighted validation loss',
        augmentation=None,normalization='reuse frozen P4 training-only normalization exactly',
        acceptanceSelection='per-fold validation only; no test tuning; 2pp maximum loss in correctly accepted validation signs',
        baseRule=BASE_RULE,protectedFileSha256=protected,
        limitations=['Existing development hold-outs reused; no fresh independent test.',
            'Fair comparisons use only the three models excluding the test participant, not all nine deployed members.',
            'Isolated clips do not measure automatic boundaries or false accepts per minute.',
            'Only P1-P3 have REST/IDLE; P4 contributes signs only.',
            'Rejection is abstention, not relabeling an uncertain sign as IDLE.',
            'No changes to app behavior, live models, source data, labels or original splits.'])
    write(output/'protocol.json',protocol)
    return protocol

def train(baseline,output,protocol):
    import tensorflow as tf
    tf.config.threading.set_intra_op_parallelism_threads(4)
    tf.config.threading.set_inter_op_parallelism_threads(1)
    write(output/'environment.json',dict(tensorflow=tf.__version__,numpy=np.__version__,devices=[str(x) for x in tf.config.list_physical_devices()]))
    class Progress(tf.keras.callbacks.Callback):
        def __init__(self,name): super().__init__(); self.name=name
        def on_epoch_end(self,epoch,logs=None):
            if epoch==0 or (epoch+1)%10==0:
                print(f'{self.name} epoch {epoch+1}: loss={logs["loss"]:.4f} val_loss={logs["val_loss"]:.4f}',flush=True)
    for fold in protocol['folds']:
        folder=baseline/'folds'/fold; meta=read(folder/'metadata.json')
        labels=sorted(meta['labelToIndex'],key=meta['labelToIndex'].get)
        with np.load(folder/'gru_data.npz',allow_pickle=False) as data: arrays={k:data[k].copy() for k in data.files}
        assert meta['testParticipant'] not in meta['participantIds']['training']+meta['participantIds']['validation']
        for seed in SEEDS:
            name=fold+f'_seed{seed}'; dest=output/'models'/name
            if (dest/'evaluation.json').exists():
                e=read(dest/'evaluation.json')
                if e['seed']!=seed or e['preprocessingMetadata']!=meta or e['idleWeight']!=2.: raise ValueError('Incompatible run')
                continue
            if dest.exists(): raise ValueError('Incomplete run directory; preserve it before resuming: '+str(dest))
            tf.keras.backend.clear_session();gc.collect();tf.keras.utils.set_random_seed(seed)
            # Cache old validation predictions in the NEW output directory.
            cache=output/'baseline_predictions'/(name+'.npz')
            if not cache.exists():
                old=tf.keras.models.load_model(baseline/'models'/name/'best_model.h5',compile=False)
                p=old.predict(arrays['X_validation'],batch_size=64,verbose=0)
                np.savez_compressed(cache,validation=p,y_validation=arrays['y_validation'],validation_ids=np.asarray(meta['sequenceIds']['validation']))
                del old;tf.keras.backend.clear_session();gc.collect();tf.keras.utils.set_random_seed(seed)
            dest.mkdir()
            model=tf.keras.Sequential([tf.keras.layers.Input(shape=(40,238),name='landmark_sequence'),
                tf.keras.layers.GRU(64,name='gru'),tf.keras.layers.Dropout(.30,name='gru_dropout'),
                tf.keras.layers.Dense(32,activation='relu',name='dense'),tf.keras.layers.Dropout(.20,name='dense_dropout'),
                tf.keras.layers.Dense(22,activation='softmax',name='sign_probabilities')],name='signsync_gru_sign_rest_idle')
            model.compile(optimizer=tf.keras.optimizers.Adam(.001),loss='sparse_categorical_crossentropy',metrics=['accuracy'])
            weights={i:(2. if label=='IDLE_MOVEMENT' else 1.) for i,label in enumerate(labels)}
            callbacks=[tf.keras.callbacks.EarlyStopping(monitor='val_loss',patience=15,restore_best_weights=True),
                tf.keras.callbacks.ReduceLROnPlateau(monitor='val_loss',factor=.5,patience=5,min_lr=.00001),
                tf.keras.callbacks.ModelCheckpoint(str(dest/'best_model.h5'),monitor='val_loss',save_best_only=True),
                tf.keras.callbacks.CSVLogger(str(dest/'epochs.csv')),Progress(name)]
            print('START',name,flush=True);started=time.monotonic()
            history=model.fit(arrays['X_train'],arrays['y_train'],validation_data=(arrays['X_validation'],arrays['y_validation']),
                class_weight=weights,epochs=100,batch_size=16,callbacks=callbacks,verbose=0)
            model=tf.keras.models.load_model(dest/'best_model.h5',compile=False)
            val=model.predict(arrays['X_validation'],batch_size=64,verbose=0)
            test=model.predict(arrays['X_test'],batch_size=64,verbose=0)
            for p,n in [(val,len(arrays['y_validation'])),(test,len(arrays['y_test']))]:
                assert p.shape==(n,22) and np.isfinite(p).all()
                np.testing.assert_allclose(p.sum(axis=1),1,atol=1e-5)
            np.savez_compressed(dest/'predictions.npz',validation=val,test=test,y_validation=arrays['y_validation'],y_test=arrays['y_test'],
                validation_ids=np.asarray(meta['sequenceIds']['validation']),test_ids=np.asarray(meta['sequenceIds']['test']))
            metrics=score(test,labels,np.asarray(labels)[arrays['y_test']])
            write(dest/'history.json',history.history)
            write(dest/'evaluation.json',dict(seed=seed,fold=fold,preprocessingMetadata=meta,idleWeight=2.,
                epochs=len(history.history['loss']),bestEpoch=int(np.argmin(history.history['val_loss']))+1,
                seconds=time.monotonic()-started,metrics=metrics))
            print('DONE',name,'epochs',len(history.history['loss']),'sign accuracy',metrics['signAccuracy'],'non-sign false accepts',metrics['nonSignFalseSignAccepted'],flush=True)
            protect_check(protocol['protectedFileSha256'])
    compare(baseline,output,protocol)

def compare(baseline,output,protocol):
    groups={}; collected={k:[] for k in ('current','currentStrict','idleWeighted','idleWeightedStrict')}; all_truth=[];errors=[]
    for fold in protocol['folds']:
        meta=read(baseline/'folds'/fold/'metadata.json'); labels=np.asarray(sorted(meta['labelToIndex'],key=meta['labelToIndex'].get))
        current_val=[];new_val=[];current_test=[];new_test=[]
        for seed in SEEDS:
            name=fold+f'_seed{seed}'
            with np.load(output/'baseline_predictions'/(name+'.npz'),allow_pickle=False) as data:
                np.testing.assert_array_equal(data['validation_ids'],meta['sequenceIds']['validation']);current_val.append(data['validation'])
            with np.load(output/'models'/name/'predictions.npz',allow_pickle=False) as data:
                np.testing.assert_array_equal(data['validation_ids'],meta['sequenceIds']['validation']);new_val.append(data['validation']);y_val=data['y_validation']
            # Lock rules BEFORE evaluating this fold's test predictions.
        rules={k:select_rule(np.stack(v),labels,labels[y_val]) for k,v in [('current',current_val),('idleWeighted',new_val)]}
        write(output/'rules'/(fold+'.json'),rules)
        for seed in SEEDS:
            name=fold+f'_seed{seed}'
            with np.load(baseline/'models'/name/'predictions.npz',allow_pickle=False) as data:
                np.testing.assert_array_equal(data['sequence_ids'],meta['sequenceIds']['test']);current_test.append(data['probabilities']);old_y=data['y_true']
            with np.load(output/'models'/name/'predictions.npz',allow_pickle=False) as data:
                np.testing.assert_array_equal(data['test_ids'],meta['sequenceIds']['test']);np.testing.assert_array_equal(data['y_test'],old_y)
                new_test.append(data['test']);truth=labels[data['y_test']]
        arrays={'current':np.stack(current_test),'idleWeighted':np.stack(new_test)}
        variants={'current':(arrays['current'],BASE_RULE),'currentStrict':(arrays['current'],rules['current']['rule']),
            'idleWeighted':(arrays['idleWeighted'],BASE_RULE),'idleWeightedStrict':(arrays['idleWeighted'],rules['idleWeighted']['rule'])}
        group={}
        decisions_by_variant={}
        for key,(members,rule) in variants.items():
            metrics=rejection_metrics(members,labels,truth,rule);group[key]=metrics
            collected[key].append((members,truth,rule))
            decisions_by_variant[key]=decisions(members,labels,rule)
        groups[meta['testParticipant']]=dict(metrics=group,selectedRules={k:{f:v for f,v in r.items() if f!='search'} for k,r in rules.items()})
        for i,sid in enumerate(meta['sequenceIds']['test']):
            row=dict(participant=meta['testParticipant'],sequenceId=sid,trueLabel=str(truth[i]))
            for key,(pred,accepted) in decisions_by_variant.items():
                row[key+'Label']=str(pred[i]);row[key+'Accepted']=bool(accepted[i])
            if any(row[k+'Accepted'] and row[k+'Label']!=row['trueLabel'] for k in variants) or len({row[k+'Label'] for k in variants})>1:
                errors.append(row)
        print('COMPARED',meta['testParticipant'],{k:(v['signCorrectAccepted'],v['nonSignFalseSignAccepted']) for k,v in group.items()},flush=True)
    aggregate={}
    for key,parts in collected.items():
        sum_fields=['total','signSamples','nonSignSamples','signCorrect','signCorrectAccepted','signWrongAccepted','signRejected','nonSignFalseSignAccepted','nonSignExactCorrect']
        metrics=[rejection_metrics(m,labels,t,r) for m,t,r in parts]
        a={f:sum(v[f] for v in metrics) for f in sum_fields};a['signAccuracy']=a['signCorrect']/a['signSamples']
        a['byNonSign']={label:{f:sum(m['byNonSign'][label][f] for m in metrics) for f in ['total','acceptedAsSign','exactCorrect']} for label in sorted(NON_SIGN)}
        aggregate[key]=a
    # Exact reproduction of the previously reported matched baseline.
    previous=read(baseline/'comparison.json')['aggregate']['p4Signs']
    for field in ['signCorrectAccepted','signWrongAccepted','nonSignFalseSignAccepted','nonSignExactCorrect']:
        assert aggregate['current'][field]==previous[field],(field,aggregate['current'][field],previous[field])
    result=dict(aggregate=aggregate,byParticipant=groups,limitations=protocol['limitations'])
    write(output/'comparison.json',result)
    with (output/'error_review.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=list(errors[0]) if errors else ['participant','sequenceId','trueLabel']);writer.writeheader();writer.writerows(errors)
    lines=['# P4 candidate: stricter acceptance and IDLE weighting','',
        'Existing frozen dataset, identical participant-held-out tests, seeds 42/43/44. IDLE weight 2; every other class weight 1. No augmentation. Rules selected using validation only, with at most 2pp loss in correctly accepted validation signs. No live deployment.','',
        '| Variant | Sign accuracy | Correct signs accepted / 1200 | Wrong signs accepted | Non-sign accepted as sign / 153 | Exact REST/IDLE / 153 |',
        '|---|---:|---:|---:|---:|---:|']
    for k,v in aggregate.items():lines.append(f'| {k} | {v["signAccuracy"]:.2%} | {v["signCorrectAccepted"]} | {v["signWrongAccepted"]} | {v["nonSignFalseSignAccepted"]} | {v["nonSignExactCorrect"]} |')
    lines+=['','Rules do not change the predicted label; rejected results are abstentions. Scores are model outputs, not calibrated accuracy. These metrics exclude live segmentation and hand-visibility filtering.','',
        '## By held-out participant','', '| Participant | Variant | Correct signs accepted / 400 | Wrong signs accepted | Non-sign false accepts / 51 |','|---|---|---:|---:|---:|']
    for p,g in groups.items():
        for k,v in g['metrics'].items():lines.append(f'| {p} | {k} | {v["signCorrectAccepted"]} | {v["signWrongAccepted"]} | {v["nonSignFalseSignAccepted"]} |')
    lines+=['','## Limitations','',*['- '+s for s in protocol['limitations']],
        '- Only 16 non-sign validation clips per fold: rejection estimates and selected rules are uncertain.',
        '- The 2pp validation constraint is not a guarantee on held-out tests or live camera behavior.',
        '- Consult rules/*.json for the full validation search and error_review.csv for held-out errors.']
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    protect_check(protocol['protectedFileSha256'])
    write(output/'integrity.json',dict(unchanged=True,changedFiles=[],protectedFileCount=len(protocol['protectedFileSha256'])))
    write(output/'artifact_checksums.json',{str(p.relative_to(output)):sha(p) for p in output.rglob('*') if p.is_file() and p.name!='artifact_checksums.json'})
    print('AGGREGATE',aggregate,flush=True)
    print('COMPLETE; protected data, candidate and live artifacts unchanged.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root',type=Path,required=True);parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--resume',action='store_true')
    args=parser.parse_args();root,baseline,output=[p.resolve() for p in (args.dataset_root,args.baseline,args.output)]
    if args.resume:
        protocol=read(output/'protocol.json')
        if protocol['baseline']!=str(baseline) or protocol['datasetRoot']!=str(root):raise ValueError('Source path mismatch')
        if (output/'comparison.json').exists():raise ValueError('Experiment already completed')
        protect_check(protocol['protectedFileSha256'])
    else:protocol=prepare(root,baseline,output)
    train(baseline,output,protocol)
