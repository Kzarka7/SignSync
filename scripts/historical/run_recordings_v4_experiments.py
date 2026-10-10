"""Train full geometry v3 on the P2/P3 WAIT replacement recordings.

Run --prepare-only to build/verify tensors. Otherwise trains nine runs, resumes
completed evaluations, then compares saved v3 models and retrained models on
the same v4 samples.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
from collections import Counter

import numpy as np
from prepare_handshape_experiments import ROOT, BASELINES, handshape, resample_shape
from prepare_handshape_experiments import prepare as prepare_handshape
from prepare_geometry_experiments import prepare as prepare_geometry
from gesture_geometry import geometry, resample as resample_geometry, feature_names
from preprocess_dataset import resample_sequence
from model_paths import find_model_folder, recordings_v4_model_folder

TARGETS = {'WAIT'}
OUTPUT = ROOT/'models'/'geometry_v3_recordings_v4_comparison'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def verify_replacements():
    """Only P2/P3 WAIT may change; retained source frames must be identical."""
    all_ids = set()
    for participant in ('participant_01', 'participant_02', 'participant_03'):
        old = read_json(ROOT/'processed'/(participant+'-dataset-v3.json'))
        new = read_json(ROOT/'processed'/(participant+'-dataset-v4.json'))
        if old['featureSchema'] != new['featureSchema']:
            raise ValueError('Collector schema changed')
        before = {s['id']: s for s in old['sequences']}
        after = {s['id']: s for s in new['sequences']}
        counts = Counter(s['label'] for s in after.values())
        if len(after) != 400 or len(new['sequences']) != 400 or len(counts) != 20 or set(counts.values()) != {20}:
            raise ValueError('Expected 400 unique samples, 20 per sign')
        if all_ids & set(after):
            raise ValueError('Sequence IDs overlap participants')
        all_ids.update(after)
        common = before.keys() & after.keys()
        expected = 400 if participant == 'participant_01' else 380
        if len(common) != expected:
            raise ValueError('Unexpected retained sample count')
        for sid in common:
            if before[sid]['frames'] != after[sid]['frames'] or before[sid]['label'] != after[sid]['label']:
                raise ValueError('A retained sequence was modified: '+sid)
        for mapping, other in ((before, after), (after, before)):
            if any(mapping[sid]['label'] != 'WAIT' for sid in mapping.keys()-other.keys()):
                raise ValueError('A sign other than WAIT was replaced')
    print('Verified: P1 unchanged; exactly 20 WAIT replacements each for P2/P3', flush=True)


def run_script(name, args, log_path):
    script = SCRIPT_DIR / name
    code = 'import sys,runpy;sys.path[:0]='+repr(sys.path)+';sys.argv='+repr([name, *args])+';runpy.run_path('+repr(str(script))+',run_name="__main__")'
    with log_path.open('w', encoding='utf-8') as log:
        result = subprocess.run([sys.executable, '-u', '-c', code], stdout=log,
                                stderr=subprocess.STDOUT,
                                env=dict(os.environ, MPLBACKEND='Agg'))
    if result.returncode:
        raise RuntimeError('Command failed; inspect '+str(log_path))


def verify_sources(meta, expected):
    if meta['sourceSha256'] != expected:
        raise ValueError('Prepared inputs reference different source exports')
    if meta['split']['seed'] != 42 or meta['split']['validationPerLabel'] != 4:
        raise ValueError('Unexpected preprocessing split settings')
    if meta['sequenceLength'] != 40:
        raise ValueError('Unexpected sequence length')


def prepare(base):
    reference = base.replace('_v1', '_geometry_v3_recordings_v3')
    old = read_json(ROOT/'processed'/reference/'metadata.json')
    raw_name = base.replace('_v1', '_recordings_v4')
    shape_name = base.replace('_v1', '_handshape_v2_recordings_v4')
    experiment = base.replace('_v1', '_geometry_v3_recordings_v4')
    participants = old['trainingParticipants']+[old['testParticipant']]
    sources = [(ROOT/'processed'/(p+'-dataset-v4.json')).resolve() for p in participants]
    hashes = {str(p): digest(p) for p in sources}
    raw_folder = ROOT/'processed'/raw_name
    if not raw_folder.exists():
        print('Preprocessing', raw_name, flush=True)
        args = ['--train', *map(str, sources[:2]), '--train-participants', *participants[:2],
                '--test', str(sources[2]), '--test-participant', participants[2],
                '--output', str(raw_folder), '--seed', '42']
        run_script('preprocess_dataset.py', args, OUTPUT/(raw_name+'.log'))
    verify_sources(read_json(raw_folder/'metadata.json'), hashes)
    shape_folder = ROOT/'processed'/shape_name
    if not shape_folder.exists():
        prepare_handshape(raw_name, target_name=shape_name)
    verify_sources(read_json(shape_folder/'metadata.json'), hashes)
    folder = ROOT/'processed'/experiment
    if not folder.exists():
        prepare_geometry(base, source_name=shape_name, target_name=experiment)
    meta = read_json(folder/'metadata.json')
    verify_sources(meta, hashes)
    if meta['featureCount'] != 238 or meta['geometryFeatureNames'] != feature_names():
        raise ValueError('Expected the unchanged full geometry-v3 feature schema')
    if meta['labelToIndex'] != old['labelToIndex']:
        raise ValueError('Label mapping changed')
    old_ids = set().union(*map(set, old['sequenceIds'].values()))
    new_ids = set().union(*map(set, meta['sequenceIds'].values()))
    common = old_ids & new_ids
    if len(common) != 1160:
        raise ValueError('Expected 1,160 retained recordings and 40 replacements')
    for split, count in [('training', 640), ('validation', 160), ('test', 400)]:
        if len(meta['sequenceIds'][split]) != count:
            raise ValueError('Unexpected split size')
        if (set(meta['sequenceIds'][split]) & common) != (set(old['sequenceIds'][split]) & common):
            raise ValueError('Retained samples changed training/validation/test assignment')
    with np.load(folder/'gru_data.npz', allow_pickle=False) as data:
        for key, count in [('X_train', 640), ('X_validation', 160), ('X_test', 400)]:
            if data[key].shape != (count, 40, 238) or not np.isfinite(data[key]).all():
                raise ValueError('Invalid tensor '+key)
    print('Verified', experiment, '640/160/400 samples, 238 features; retained splits unchanged', flush=True)
    return experiment


def raw_geometry_features(sequence, order, length):
    """Reproduce all three original feature groups before standardization."""
    vectors = np.asarray([f['features'] for f in sequence['frames']], dtype=float)
    return np.concatenate([
        resample_sequence(sequence['frames'], length, sequence['id']),
        resample_shape(handshape(vectors, order), length),
        resample_geometry(geometry(vectors, order), length),
    ], axis=1)


def standardize_for_model(raw, mean, std):
    if raw.shape[-1] != 238 or mean.shape != (1, 1, 238) or std.shape != mean.shape:
        raise ValueError('Expected full geometry-v3 normalization')
    if not np.isfinite(raw).all() or not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std <= 0):
        raise ValueError('Invalid normalization inputs')
    return ((raw-mean)/std).astype(np.float32)


def metrics(y, probabilities, labels):
    from sklearn.metrics import accuracy_score, classification_report, log_loss
    predictions = probabilities.argmax(axis=1)
    report = classification_report(y, predictions, labels=np.arange(len(labels)),
                                   target_names=labels, output_dict=True, zero_division=0)
    return dict(testAccuracy=float(accuracy_score(y, predictions)),
                testLoss=float(log_loss(y, probabilities, labels=np.arange(len(labels)))),
                macroF1=report['macro avg']['f1-score'], classificationReport=report)


def report_results(rows, predictions_folder):
    (OUTPUT/'comparison.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
    lines = ['# Replacement recordings: full geometry v3', '',
             'Saved v3 and retrained v4 models evaluated on identical v4 held-out samples. Each uses its own training-fitted normalization. Architecture, 238 feature definitions and seeds 42/43/44 are unchanged. P2/P3 WAIT were replaced; P1 recordings and all other signs remain identical. Retained recordings keep their original splits. This is development evaluation; flagged WAIT tracking/execution questions remain unresolved, and manifest updates remain pending. This is an exploratory retraining authorized using the current batch.', '',
             '| Test participant | Seed | Old model accuracy | Retrained accuracy | Old loss | Retrained loss | Old macro F1 | Retrained macro F1 |',
             '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        a,b=r['old_on_v4'],r['new_on_v4']
        lines.append(f"| {r['participant']} | {r['seed']} | {a['testAccuracy']:.2%} | {b['testAccuracy']:.2%} | {a['testLoss']:.4f} | {b['testLoss']:.4f} | {a['macroF1']:.4f} | {b['macroF1']:.4f} |")
    lines += ['', '## Means across seeds', '', '| Participant | Runs | Old accuracy | Retrained accuracy | Old macro F1 | Retrained macro F1 |', '|---|---:|---:|---:|---:|---:|']
    for p in sorted({r['participant'] for r in rows})+['ALL']:
        subset=[r for r in rows if p=='ALL' or r['participant']==p]
        avg=lambda v,k:sum(r[v][k] for r in subset)/len(subset)
        lines.append(f"| {p} | {len(subset)} | {avg('old_on_v4','testAccuracy'):.2%} | {avg('new_on_v4','testAccuracy'):.2%} | {avg('old_on_v4','macroF1'):.4f} | {avg('new_on_v4','macroF1'):.4f} |")
    lines += ['', '## Every sign, correct out of 20', '', '| Participant | Seed | Sign | Old | Retrained | Change |', '|---|---:|---|---:|---:|---:|']
    for r in rows:
        for label in sorted(r['old_on_v4']['classificationReport']):
            if label not in r['labels']: continue
            a,b=[round(r[v]['classificationReport'][label]['recall']*20) for v in ('old_on_v4','new_on_v4')]
            lines.append(f"| {r['participant']} | {r['seed']} | {label} | {a} | {b} | {b-a:+d} |")
    lines += ['', 'Predictions: '+str(predictions_folder), '',
              'Loss uses sklearn log_loss for both sides. Historical v3-model results are retained in comparison.json for context, but the paired comparison uses identical v4 test samples. Input reconstruction is checked against retained v3 test tensors before saved-model inference.']
    (OUTPUT/'report.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')


def compare(experiments):
    import tensorflow as tf
    from export_predictions import prediction_rows, write_excel_csv, compare_seed_rows
    predictions_folder = ROOT/'models'/'prediction-reports'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    predictions_folder.mkdir(parents=True, exist_ok=False)
    rows=[]; summaries=[]; consistency=[]
    for experiment in experiments:
        folder=ROOT/'processed'/experiment
        meta=read_json(folder/'metadata.json')
        reference=experiment.removesuffix('_recordings_v4')+'_recordings_v3'
        old_folder=ROOT/'processed'/reference
        old_meta=read_json(old_folder/'metadata.json')
        source=read_json(Path(meta['testSource']))
        sequences={s['id']:s for s in source['sequences']}
        raw=np.stack([raw_geometry_features(sequences[sid], source['featureSchema']['order'], 40) for sid in meta['sequenceIds']['test']])
        labels=[x for x,i in sorted(meta['labelToIndex'].items(), key=lambda kv:kv[1])]
        with np.load(folder/'gru_data.npz', allow_pickle=False) as d:
            new_x=d['X_test'].copy(); y=d['y_test'].copy()
            rebuilt=standardize_for_model(raw,d['feature_mean'],d['feature_std'])
            np.testing.assert_allclose(rebuilt,new_x,rtol=2e-5,atol=2e-4)
        with np.load(old_folder/'gru_data.npz', allow_pickle=False) as d:
            old_x=standardize_for_model(raw,d['feature_mean'],d['feature_std'])
            old_index={sid:i for i,sid in enumerate(old_meta['sequenceIds']['test'])}
            common=[(i,old_index[sid]) for i,sid in enumerate(meta['sequenceIds']['test']) if sid in old_index]
            expected_common=400 if meta['testParticipant']=='participant_01' else 380
            if len(common)!=expected_common: raise ValueError('Unexpected unchanged test recording count')
            np.testing.assert_allclose(old_x[[a for a,b in common]], d['X_test'][[b for a,b in common]], rtol=2e-5, atol=2e-4)
        seed_rows={}
        for seed in (42,43,44):
            suffix='' if seed==42 else f'_seed{seed}'
            run=experiment+suffix
            new_folder=recordings_v4_model_folder(ROOT/'models',run)
            old_model_folder=find_model_folder(ROOT/'models',reference+suffix)
            old_eval=read_json(old_model_folder/'evaluation.json')
            new_eval=read_json(new_folder/'evaluation.json')
            if old_eval['preprocessingMetadata']!=old_meta or new_eval['preprocessingMetadata']!=meta:
                raise ValueError('Saved model preprocessing metadata mismatch')
            row=dict(participant=meta['testParticipant'],seed=seed,labels=labels,
                     old_historical={k:old_eval[k] for k in ('testAccuracy','testLoss','macroF1')})
            for version,model_folder,x in [('old_on_v4',old_model_folder,old_x),('new_on_v4',new_folder,new_x)]:
                checkpoint = 'best_model.h5' if version == 'new_on_v4' else 'best_model.keras'
                model=tf.keras.models.load_model(model_folder/checkpoint,compile=False)
                probs=np.asarray(model.predict(x,batch_size=16,verbose=0))
                row[version]=metrics(y,probs,labels)
                row[version]['subsetAccuracy']={group:float(np.mean(probs[mask].argmax(axis=1)==y[mask])) for group,mask in
                    [('replacement_signs',np.isin(y,[meta['labelToIndex'][s] for s in TARGETS])),
                     ('retained_signs',~np.isin(y,[meta['labelToIndex'][s] for s in TARGETS]))]}
                model_experiment=experiment if version=='new_on_v4' else reference
                model_run=model_experiment+suffix
                pred=prediction_rows(meta,y,probs,model_experiment)
                for item in pred: item.update(seed=seed,run_name=model_run)
                filename=run if version=='new_on_v4' else 'old_on_v4__'+reference+suffix
                write_excel_csv(predictions_folder/(filename+'.csv'),pred)
                if version=='new_on_v4':
                    matches=all(np.isclose(row[version][k],new_eval[k]) for k in ('testAccuracy','macroF1'))
                    if not matches: raise ValueError('New inference does not reproduce saved metrics')
                    seed_rows[seed]=pred
                    summaries.append(dict(runName=run,savedMetricsMatch=bool(matches),samples=len(y)))
                del model
                tf.keras.backend.clear_session()
            rows.append(row);report_results(rows,predictions_folder)
            print('Compared',run,'old/new accuracy',row['old_on_v4']['testAccuracy'],row['new_on_v4']['testAccuracy'],flush=True)
        consistency.extend(compare_seed_rows(seed_rows))
    write_excel_csv(predictions_folder/'consistency.csv',consistency)
    (predictions_folder/'summary.json').write_text(json.dumps(summaries,indent=2),encoding='utf-8')
    print('Predictions:',predictions_folder,flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args()
    OUTPUT.mkdir(exist_ok=True)
    verify_replacements()
    protected={}
    for base in BASELINES:
        reference=base.replace('_v1','_geometry_v3_recordings_v3')
        meta=read_json(ROOT/'processed'/reference/'metadata.json')
        for path,h in meta['sourceSha256'].items():
            if digest(Path(path))!=h: raise ValueError('V3 source changed: '+path)
            protected[path]=h
        for seed in (42,43,44):
            run=reference+('' if seed==42 else f'_seed{seed}')
            folder=find_model_folder(ROOT/'models',run)
            old=read_json(folder/'evaluation.json')
            if old['preprocessingMetadata']!=meta or old['randomSeed']!=seed: raise ValueError('Invalid reference run')
            for name in ('best_model.keras','evaluation.json'):
                p=folder/name;protected[str(p)]=digest(p)
    for i in (1,2,3):
        p=(ROOT/'processed'/f'participant_{i:02d}-dataset-v4.json').resolve()
        protected[str(p)]=digest(p)
    manifest=(ROOT/'manifests'/'samples.csv').resolve()
    protected[str(manifest)]=digest(manifest)
    provenance=OUTPUT/'source_and_reference_hashes.json'
    if provenance.exists() and read_json(provenance)!=protected: raise ValueError('Experiment source/reference changed since first run')
    provenance.write_text(json.dumps(protected,indent=2),encoding='utf-8')
    experiments=[prepare(base) for base in BASELINES]
    if args.prepare_only: return
    for experiment in experiments:
        meta=read_json(ROOT/'processed'/experiment/'metadata.json')
        for seed in (42,43,44):
            run=experiment+('' if seed==42 else f'_seed{seed}')
            result=recordings_v4_model_folder(ROOT/'models',run)/'evaluation.json'
            if not result.exists():
                print('Training',run,flush=True)
                run_script('train_gru.py',['--experiment',experiment,'--seed',str(seed)],OUTPUT/(run+'.log'))
            evaluation=read_json(result)
            if evaluation['preprocessingMetadata']!=meta or evaluation['randomSeed']!=seed or evaluation['experiment']!=experiment:
                raise ValueError('Existing model metadata mismatch')
            print('Finished',run,{k:evaluation[k] for k in ('testAccuracy','testLoss','macroF1')},flush=True)
    compare(experiments)
    if any(digest(Path(p))!=h for p,h in protected.items()): raise ValueError('Source/reference changed during experiment')
    print('Completed:',OUTPUT/'report.md',flush=True)


if __name__=='__main__':
    main()
