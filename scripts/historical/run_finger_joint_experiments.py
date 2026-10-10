"""Test additional individual MCP and DIP projected cosines across all nine runs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import numpy as np
from prepare_finger_joint_experiments import prepare
from model_paths import find_model_folder, finger_joint_model_folder
from prepare_handshape_experiments import ROOT, BASELINES


def write_report(rows, output):
    (output/'comparison.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
    lines = ['# Full v3 versus added individual finger-joint descriptors', '',
             'Same participant splits, samples, seeds and training settings. Added 20 channels: individual MCP and DIP projected XY cosines and validity groups. Input width is 258 instead of 238; all original channels and normalization are identical. These are not calibrated anatomical angles. More inputs also increase parameter count. Exploratory development results, not a fresh-participant final test.', '',
             '| Held-out | Seed | Full accuracy | Finger-joints accuracy | Full loss | Finger-joints loss | Full macro F1 | Finger-joints macro F1 |',
             '|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        a,b = r['full'],r['finger_joints']
        lines.append(f"| {r['participant']} | {r['seed']} | {a['testAccuracy']:.2%} | {b['testAccuracy']:.2%} | {a['testLoss']:.4f} | {b['testLoss']:.4f} | {a['macroF1']:.4f} | {b['macroF1']:.4f} |")
    lines += ['', '## Means across completed seeds', '', '| Held-out | Runs | Full accuracy | Finger-joints accuracy | Full loss | Finger-joints loss | Full macro F1 | Finger-joints macro F1 |', '|---|---:|---:|---:|---:|---:|---:|---:|']
    for participant in sorted({r['participant'] for r in rows}):
        subset = [r for r in rows if r['participant']==participant]
        avg = lambda v,k: sum(r[v][k] for r in subset)/len(subset)
        values = [f'{avg(v,k):.2%}' if k=='testAccuracy' else f'{avg(v,k):.4f}' for k in ('testAccuracy','testLoss','macroF1') for v in ('full','finger_joints')]
        lines.append(f"| {participant} | {len(subset)} | {' | '.join(values)} |")
    lines += ['', '## Every sign (correct out of 20; F1)', '', '| Held-out | Seed | Sign | Full correct | Finger-joints correct | Change | Full F1 | Finger-joints F1 |', '|---|---:|---|---:|---:|---:|---:|---:|']
    for r in rows:
        for label, scores in sorted(r['classes'].items()):
            a,b = scores['full'],scores['finger_joints']
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
    reference_hashes={}
    for experiment in experiments:
        full=experiment.removesuffix('_finger_joints')
        meta=json.loads((ROOT/'processed'/full/'metadata.json').read_text(encoding='utf-8'))
        for seed in (42,43,44):
            suffix='' if seed==42 else f'_seed{seed}'
            folder=find_model_folder(ROOT/'models',full+suffix)
            old=json.loads((folder/'evaluation.json').read_text(encoding='utf-8'))
            if old['preprocessingMetadata'] != meta or old['randomSeed'] != seed:
                raise ValueError('Reference metadata or seed mismatch')
            references[experiment,seed]=old
            checkpoint=folder/'best_model.keras'
            reference_hashes[str(checkpoint)]=hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    output=ROOT/'models'/'geometry_v3_finger_joints_comparison'
    output.mkdir(exist_ok=True)
    hash_path=output/'reference_model_checksums.json'
    if hash_path.exists() and json.loads(hash_path.read_text()) != reference_hashes:
        raise ValueError('Reference checkpoints changed since experiment started')
    hash_path.write_text(json.dumps(reference_hashes,indent=2),encoding='utf-8')
    rows=[]
    for experiment in experiments:
        for seed in (42,43,44):
            run=experiment+('' if seed==42 else f'_seed{seed}')
            result=finger_joint_model_folder(ROOT/'models',run)/'evaluation.json'
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
            expected=json.loads((ROOT/'processed'/experiment/'metadata.json').read_text(encoding='utf-8'))
            if new['preprocessingMetadata'] != expected or new['randomSeed'] != seed or new['experiment'] != experiment:
                raise ValueError('Saved finger-joint model metadata mismatch')
            for key in ('sequenceIds','participantIds','labelToIndex'):
                if expected[key] != old['preprocessingMetadata'][key]:
                    raise ValueError('Comparison identities differ: '+key)
            row=dict(participant=new['testParticipant'],seed=seed)
            for version,e in [('full',old),('finger_joints',new)]:
                row[version]={k:e[k] for k in ('testAccuracy','testLoss','macroF1')}
            row['classes']={label:{v:dict(e['classificationReport'][label],correct=round(e['classificationReport'][label]['recall']*e['classificationReport'][label]['support'])) for v,e in [('full',old),('finger_joints',new)]} for label in expected['labelToIndex']}
            rows.append(row)
            write_report(rows,output)
            print(run,row['finger_joints'],flush=True)
    if any(hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h for p,h in reference_hashes.items()):
        raise ValueError('Reference checkpoint changed during experiment')
    print('Completed:',output/'report.md',flush=True)


if __name__=='__main__': main()
