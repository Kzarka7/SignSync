"""Prepare and train four-participant geometry-v3 experiments without overwrites.

P1-P3 retain their v5 recordings; P4 uses the reviewed merge-input-v5 folder.
Each fold trains on three participants and holds the fourth out of training
and validation. Existing split settings, architecture, and seeds are retained.
"""
from processed_paths import processed_artifact_path, processed_glob, resolve_artifact_path
from model_paths import model_artifact_folder
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np

from merge_dataset import merge
from preprocess_dataset import load_export, stratified_train_validation_split
from run_recordings_v5_experiments import raw_geometry_features, standardize_for_model
from gesture_geometry import feature_names

PARTICIPANTS = [f'participant_{i:02d}' for i in range(1, 5)]
SEEDS = (42, 43, 44)


def read(path):
    path = resolve_artifact_path(path)
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    path = resolve_artifact_path(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def experiment_name(held_out):
    train = [p for p in PARTICIPANTS if p != held_out]
    return 'gru_' + '_'.join('p'+p[-2:] for p in train) + '_train_p'+held_out[-2:]+'_test_geometry_v3_recordings_v6'


def prepare(root, output):
    input_folder = root/'clean'/'participant_04'/'merge-input-v5'
    p4, warnings, scanned = merge(input_folder)
    if warnings or scanned != 400 or len(p4['sequences']) != 400:
        raise ValueError('P4 merge failed: '+str(warnings))
    p4_path = processed_artifact_path(root/'processed', 'participant_04-dataset-v6.json')
    if p4_path.exists():
        old = read(p4_path)
        if any(old[k] != p4[k] for k in ('featureSchema','labels','sequenceCount','sequences')):
            raise ValueError('Existing P4 merged source differs; choose a new dataset version')
    else:
        p4_path.write_text(json.dumps(p4, indent=2), encoding='utf-8')

    paths = {p: processed_artifact_path(root/'processed', p+'-dataset-v5.json') for p in PARTICIPANTS[:3]}
    paths['participant_04'] = p4_path
    sources = {p:load_export(path) for p,path in paths.items()}
    schema = sources['participant_01']['featureSchema']
    labels = sorted(sources['participant_01']['labels'])
    mapping = {label:i for i,label in enumerate(labels)}
    all_ids = set()
    hashes = {str(path.resolve()):sha(path) for path in paths.values()}
    raw, ids, targets = {}, {}, {}
    for participant,data in sources.items():
        counts = Counter(s['label'] for s in data['sequences'])
        if data['featureSchema'] != schema or sorted(counts) != labels or set(counts.values()) != {20}:
            raise ValueError('Schema, labels or counts differ: '+participant)
        ids[participant] = [s['id'] for s in data['sequences']]
        if len(set(ids[participant])) != 400 or all_ids.intersection(ids[participant]):
            raise ValueError('Overlapping sequence IDs')
        all_ids.update(ids[participant])
        raw[participant] = np.stack([raw_geometry_features(s,schema['order'],40) for s in data['sequences']])
        if raw[participant].shape != (400,40,238) or not np.isfinite(raw[participant]).all():
            raise ValueError('Invalid feature reconstruction')
        targets[participant] = np.asarray([mapping[s['label']] for s in data['sequences']],dtype=np.int64)
        print('Reconstructed',participant,raw[participant].shape,flush=True)

    # Confirm compatibility with already prepared v5 tensors before training.
    parity = []
    for folder in sorted(processed_glob(root/'processed', 'gru_*_geometry_v3_recordings_v5')):
        meta = read(folder/'metadata.json')
        p = meta['testParticipant']
        positions = {sid:i for i,sid in enumerate(ids[p])}
        indices = [positions[sid] for sid in meta['sequenceIds']['test']]
        with np.load(folder/'gru_data.npz',allow_pickle=False) as saved:
            rebuilt = standardize_for_model(raw[p][indices],saved['feature_mean'],saved['feature_std'])
            np.testing.assert_allclose(rebuilt,saved['X_test'],rtol=2e-5,atol=2e-4)
            parity.append(dict(experiment=folder.name,maxAbsoluteDifference=float(np.max(abs(rebuilt-saved['X_test'])))))

    for held_out in PARTICIPANTS:
        train_participants = [p for p in PARTICIPANTS if p != held_out]
        name = experiment_name(held_out)
        folder = processed_artifact_path(root/'processed', name)
        split_raw, split_y, split_ids, split_participants = {}, {}, {}, {}
        for split, take_validation in [('training',False),('validation',True)]:
            xs, ys, sids, members = [], [], [], []
            for p in train_participants:
                tr,va = stratified_train_validation_split(targets[p],4,42)
                indices = va if take_validation else tr
                xs.append(raw[p][indices]);ys.append(targets[p][indices])
                sids += [ids[p][i] for i in indices]
                members += [p]*len(indices)
            split_raw[split] = np.concatenate(xs)
            split_y[split] = np.concatenate(ys)
            split_ids[split],split_participants[split] = sids,members
        split_raw['test'],split_y['test'] = raw[held_out],targets[held_out]
        split_ids['test'],split_participants['test'] = ids[held_out],[held_out]*400
        mean = split_raw['training'].mean(axis=(0,1),keepdims=True)
        std = split_raw['training'].std(axis=(0,1),keepdims=True)
        std[std<1e-6] = 1
        arrays = dict(feature_mean=mean.astype(np.float32),feature_std=std.astype(np.float32))
        for split,suffix in [('training','train'),('validation','validation'),('test','test')]:
            arrays['X_'+suffix] = ((split_raw[split]-mean)/std).astype(np.float32)
            arrays['y_'+suffix] = split_y[split]
            if not np.isfinite(arrays['X_'+suffix]).all():
                raise ValueError('Nonfinite standardized tensor')
        meta = dict(metadataVersion=2,trainingParticipants=train_participants,testParticipant=held_out,
            trainSources=[str(paths[p].resolve()) for p in train_participants],testSource=str(paths[held_out].resolve()),
            sourceSha256=hashes,sequenceIds=split_ids,participantIds=split_participants,
            labelToIndex=mapping,sequenceLength=40,featureCount=238,geometryVersion=3,
            geometryFeatureNames=feature_names(),standardizationFit='training subset only',
            split=dict(seed=42,validationPerLabel=4,stratification='participant and label; not sign variant'),
            resampling='Existing v5 raw_geometry_features: frame-index interpolation and masked derived geometry',
            manifestAnnotationsUsed=False,
            qualityNotes='P4 retains all 400 reviewed samples, including 115 below 10 FPS; no filtering or relabeling.',
            evaluationScope='Four-participant development evaluation; validation signers also appear in training, test signer is unseen.')
        if folder.exists():
            old = read(folder/'metadata.json')
            if old != meta:
                raise ValueError('Existing prepared metadata differs: '+name)
            with np.load(folder/'gru_data.npz',allow_pickle=False) as saved:
                for key,value in arrays.items():
                    np.testing.assert_array_equal(saved[key],value)
        else:
            folder.mkdir(parents=True)
            np.savez_compressed(folder/'gru_data.npz',**arrays)
            (folder/'metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
        print('Prepared',name,'960 training / 240 validation / 400 test',flush=True)
    provenance = dict(createdAt=datetime.now(timezone.utc).isoformat(),sourceSha256=hashes,
        p4InputSha256={p.name:sha(p) for p in sorted(input_folder.glob('*.json'))},v5Parity=parity)
    (output/'provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')


def summarize(root,output):
    rows = []
    for held_out in PARTICIPANTS:
        name = experiment_name(held_out)
        for seed in SEEDS:
            run = name if seed==42 else name+f'_seed{seed}'
            folder = model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v6')/run
            path = folder/'evaluation.json'
            if path.exists():
                data = read(path)
                rows.append(dict(participant=held_out,seed=seed,accuracy=data['testAccuracy'],
                    macroF1=data['macroF1'],loss=data['testLoss'],modelFolder=str(folder),
                    classificationReport=data['classificationReport']))
    (output/'summary.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
    lines = ['# Four-participant retraining: recordings v6','',
        '20 isolated signs; P1–P3 v5 sources plus all 400 P4 samples. Same 238-feature geometry and GRU architecture; seeds 42/43/44. Each fold has 960 training, 240 validation and 400 test samples. Training-only normalization. Test participant is excluded from training and validation. Validation contains held-out recordings from training signers.',
        '', 'Development results; P1–P3 have already informed model design. P4 contains 115 low-FPS samples. This is not continuous conversation evaluation. Existing live v5 models are unchanged.',
        '',f'Completed runs: {len(rows)}/12.','',
        '| Held-out participant | Seed | Accuracy | Macro F1 | Loss |','|---|---:|---:|---:|---:|']
    for r in rows:
        lines.append(f"| {r['participant']} | {r['seed']} | {r['accuracy']:.2%} | {r['macroF1']:.4f} | {r['loss']:.4f} |")
    lines += ['', '## Means and historical v5 context','',
        'For P1–P3, v5 used two training participants; v6 adds P4. Test recordings are unchanged. P4 has no historical v5 fold. The overall four-participant mean is not directly comparable to the old three-participant mean.', '',
        '| Test participant | Runs | v6 mean accuracy | v6 macro F1 | Historical v5 mean accuracy |','|---|---:|---:|---:|---:|']
    for p in PARTICIPANTS:
        group = [r for r in rows if r['participant']==p]
        old = []
        for path in (model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v5')).glob('*/evaluation.json'):
            data = read(path)
            if data['testParticipant']==p:
                old.append(data['testAccuracy'])
        if group:
            avg = lambda k:sum(r[k] for r in group)/len(group)
            previous = f'{np.mean(old):.2%}' if old else '—'
            lines.append(f'| {p} | {len(group)} | {avg("accuracy"):.2%} | {avg("macroF1"):.4f} | {previous} |')
    if rows:
        lines += ['',f'Overall completed-run mean accuracy: {np.mean([r["accuracy"] for r in rows]):.2%}.',
            '', '## Mean per-sign recall across completed runs','', '| Sign | Recall |','|---|---:|']
        labels = [x for x in rows[0]['classificationReport'] if x not in ('accuracy','macro avg','weighted avg')]
        for label in sorted(labels):
            recall = np.mean([r['classificationReport'][label]['recall'] for r in rows])
            lines.append(f'| {label} | {recall:.2%} |')
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root',type=Path,required=True)
    parser.add_argument('--prepare-only',action='store_true')
    args = parser.parse_args()
    root = args.dataset_root.resolve()
    output = model_artifact_folder(root / 'models', 'geometry_v3_recordings_v6_comparison')
    output.mkdir(parents=True, exist_ok=True)
    prepare(root,output)
    if args.prepare_only:
        return
    environment = dict(os.environ,MPLBACKEND='Agg',TF_NUM_INTRAOP_THREADS='4',
        TF_NUM_INTEROP_THREADS='1',TF_CPP_MIN_LOG_LEVEL='2',PYTHONUNBUFFERED='1')
    # Evaluate P4 before it enters any training fold.
    for participant in [PARTICIPANTS[3],*PARTICIPANTS[:3]]:
        name = experiment_name(participant)
        for seed in SEEDS:
            run = name if seed==42 else name+f'_seed{seed}'
            folder = model_artifact_folder(root / 'models', 'gru_model_train_test_geometry_v3_recordings_v6')/run
            evaluation = folder/'evaluation.json'
            if evaluation.exists() and all((folder/x).exists() for x in ('best_model.h5','history.json','predictions.npz','training_history.png','confusion_matrix.png')):
                print('Already completed',run,flush=True)
                continue
            if folder.exists():
                raise RuntimeError('Incomplete run preserved; inspect before retry: '+str(folder))
            command = [sys.executable,'-u',str(Path(__file__).with_name('train_gru.py')),
                '--experiment',name,'--dataset-root',str(root),'--seed',str(seed)]
            print('Training',run,flush=True)
            with (output/(run+'.log')).open('w',encoding='utf-8') as log:
                result = subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,env=environment)
            summarize(root,output)
            if result.returncode:
                raise RuntimeError('Training failed; inspect '+str(output/(run+'.log')))
            result = read(evaluation)
            print('Completed',run,f"accuracy={result['testAccuracy']:.2%}, macroF1={result['macroF1']:.4f}",flush=True)
    summarize(root,output)
    print('All 12 runs complete. Report:',output/'report.md',flush=True)


if __name__=='__main__':
    main()
