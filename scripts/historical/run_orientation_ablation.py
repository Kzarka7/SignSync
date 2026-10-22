"""Remove only explicit orientation descriptors from full geometry v3.

Run with --prepare-only to verify inputs, or without flags for all nine runs.
Raw landmark coordinates still contain implicit orientation information.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
from processed_paths import processed_artifact_path
from model_paths import model_artifact_folder

import numpy as np
from gesture_geometry import feature_names
from model_paths import find_model_folder, orientation_ablation_folder
from prepare_handshape_experiments import ROOT, BASELINES


def retained_indices(meta):
    names = meta['geometryFeatureNames']
    if meta['featureCount'] != 238 or names != feature_names():
        raise ValueError('Expected the exact full geometry-v3 feature schema')
    removed = [190+i for i, name in enumerate(names)
               if name.split('.')[-1].removeprefix('first_observed_').startswith('normal_')]
    if len(removed) != 16:
        raise ValueError('Expected 16 orientation channels, including validity flags')
    return [i for i in range(238) if i not in removed], removed


def prepare(base):
    previous = base.replace('_v1', '_geometry_v3')
    experiment = previous + '_no_orientation'
    source = processed_artifact_path(ROOT/'processed', previous)
    target = processed_artifact_path(ROOT/'processed', experiment)
    meta = json.loads((source/'metadata.json').read_text(encoding='utf-8'))
    keep, removed = retained_indices(meta)
    names = meta['geometryFeatureNames']
    with np.load(source/'gru_data.npz', allow_pickle=False) as original:
        arrays = {k: original[k].copy() for k in original.files}
    for key in ('X_train', 'X_validation', 'X_test', 'feature_mean', 'feature_std'):
        arrays[key] = arrays[key][..., keep]
        if not np.isfinite(arrays[key]).all():
            raise ValueError('Nonfinite input: '+key)
    meta.update(featureCount=len(keep), previousExperiment=previous,
                previousTensorSha256=hashlib.sha256((source/'gru_data.npz').read_bytes()).hexdigest(),
                geometryFeatureNames=[n for i,n in enumerate(names) if 190+i in keep],
                removedGeometryFeatureNames=[names[i-190] for i in removed],
                removedFeatureIndices=removed, retainedFeatureIndices=keep,
                geometryDefinition='Full geometry-v3 minus explicit per-frame and first-observed palm-normal descriptors and their validity flags. Raw landmarks, starting handshape, wrist/position features, labels, splits and retained training-fitted normalization are unchanged.',
                ablation='remove_explicit_palm_orientation')
    if target.exists():
        if json.loads((target/'metadata.json').read_text(encoding='utf-8')) != meta:
            raise ValueError('Existing ablation metadata differs: '+str(target))
        with np.load(target/'gru_data.npz', allow_pickle=False) as saved:
            if set(saved.files) != set(arrays) or any(not np.array_equal(saved[k],v) for k,v in arrays.items()):
                raise ValueError('Existing ablation arrays differ: '+str(target))
    else:
        target.mkdir(parents=True)
        np.savez_compressed(target/'gru_data.npz', **arrays)
        (target/'metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print('Verified',experiment,arrays['X_train'].shape,flush=True)
    return experiment


def write_report(rows, output):
    (output/'comparison.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
    lines = ['# Full v3 versus removal of explicit palm orientation', '',
             'Same participant splits, samples, seeds and training settings. Removed 16 channels: per-frame and repeated first-observed palm-normal x/y/z and validity, for both hands. Input width is 222 instead of 238; all retained values and normalization are identical. Starting handshape and wrist/position features remain. Raw landmarks still contain implicit orientation information. Fewer inputs also reduce parameter count. These are exploratory development results, not a fresh-participant final test.', '',
             '| Held-out | Seed | Full accuracy | No-orientation accuracy | Full loss | No-orientation loss | Full macro F1 | No-orientation macro F1 |',
             '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        a,b = r['full'],r['no_orientation']
        lines.append(f"| {r['participant']} | {r['seed']} | {a['testAccuracy']:.2%} | {b['testAccuracy']:.2%} | {a['testLoss']:.4f} | {b['testLoss']:.4f} | {a['macroF1']:.4f} | {b['macroF1']:.4f} |")
    lines += ['', '## Means across completed seeds', '', '| Held-out | Runs | Full accuracy | No-orientation accuracy | Full loss | No-orientation loss | Full macro F1 | No-orientation macro F1 |', '|---|---:|---:|---:|---:|---:|---:|---:|']
    for participant in sorted({r['participant'] for r in rows}):
        subset = [r for r in rows if r['participant']==participant]
        avg = lambda v,k: sum(r[v][k] for r in subset)/len(subset)
        values = [f'{avg(v,k):.2%}' if k=='testAccuracy' else f'{avg(v,k):.4f}' for k in ('testAccuracy','testLoss','macroF1') for v in ('full','no_orientation')]
        lines.append(f"| {participant} | {len(subset)} | {' | '.join(values)} |")
    lines += ['', '## Every sign (correct out of 20; F1)', '', '| Held-out | Seed | Sign | Full correct | No-orientation correct | Change | Full F1 | No-orientation F1 |', '|---|---:|---|---:|---:|---:|---:|---:|']
    for r in rows:
        for label, scores in sorted(r['classes'].items()):
            a,b = scores['full'],scores['no_orientation']
            lines.append(f"| {r['participant']} | {r['seed']} | {label} | {a['correct']} | {b['correct']} | {b['correct']-a['correct']:+d} | {a['f1-score']:.4f} | {b['f1-score']:.4f} |")
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only',action='store_true')
    args=parser.parse_args()
    experiments=[prepare(base) for base in BASELINES]
    if args.prepare_only:
        return
    references={}
    for experiment in experiments:
        full=experiment.removesuffix('_no_orientation')
        meta=json.loads((processed_artifact_path(ROOT/'processed', full)/'metadata.json').read_text(encoding='utf-8'))
        for seed in (42,43,44):
            suffix='' if seed==42 else f'_seed{seed}'
            folder=find_model_folder(ROOT/'models',full+suffix)
            old=json.loads((folder/'evaluation.json').read_text(encoding='utf-8'))
            if old['preprocessingMetadata'] != meta or old['randomSeed'] != seed:
                raise ValueError('Reference metadata or seed mismatch')
            references[experiment,seed]=old
    output=model_artifact_folder(ROOT / 'models', 'geometry_v3_no_orientation_comparison')
    output.mkdir(parents=True, exist_ok=True)
    rows=[]
    for experiment in experiments:
        for seed in (42,43,44):
            run=experiment+('' if seed==42 else f'_seed{seed}')
            result=orientation_ablation_folder(ROOT/'models',run)/'evaluation.json'
            if not result.exists():
                print('Training',run,flush=True)
                code='import sys,runpy; sys.path[:0]='+repr(sys.path)+'; sys.argv='+repr(['train_gru.py','--experiment',experiment,'--seed',str(seed)])+'; runpy.run_path('+repr(str(SCRIPT_DIR / 'train_gru.py'))+',run_name="__main__")'
                log_path=output/(run+'.log')
                with log_path.open('w',encoding='utf-8') as log:
                    completed=subprocess.run([sys.executable,'-u','-c',code],stdout=log,stderr=subprocess.STDOUT,env=dict(os.environ,MPLBACKEND='Agg'))
                if completed.returncode:
                    raise RuntimeError('Training failed; inspect '+str(log_path))
            new=json.loads(result.read_text(encoding='utf-8'))
            old=references[experiment,seed]
            expected=json.loads((processed_artifact_path(ROOT/'processed', experiment)/'metadata.json').read_text(encoding='utf-8'))
            if new['preprocessingMetadata'] != expected or new['randomSeed'] != seed or new['experiment'] != experiment:
                raise ValueError('Saved ablation model metadata mismatch')
            for key in ('sequenceIds','participantIds','labelToIndex'):
                if expected[key] != old['preprocessingMetadata'][key]:
                    raise ValueError('Comparison identities differ: '+key)
            row=dict(participant=new['testParticipant'],seed=seed)
            for version,e in [('full',old),('no_orientation',new)]:
                row[version]={k:e[k] for k in ('testAccuracy','testLoss','macroF1')}
            row['classes']={label:{v:dict(e['classificationReport'][label],correct=round(e['classificationReport'][label]['recall']*e['classificationReport'][label]['support'])) for v,e in [('full',old),('no_orientation',new)]} for label in expected['labelToIndex']}
            rows.append(row)
            write_report(rows,output)
            print(run,row['no_orientation'],flush=True)
    print('Completed:',output/'report.md',flush=True)


if __name__=='__main__': main()
