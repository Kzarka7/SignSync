"""Run nine geometry-v3 experiments and compare every class against v2."""
import json
import os
from pathlib import Path
import subprocess
import sys
from prepare_handshape_experiments import ROOT, BASELINES
from model_paths import find_model_folder, geometry_model_folder


def report_results(rows, output):
    (output/'comparison.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
    lines=['# Geometry v3 versus handshape v2','','Exploratory development results: these participants have informed feature design. A fresh participant is needed for final evaluation. Same IDs, splits, seeds, GRU layers and training settings; 48 added channels increase input size from 190 to 238 and increase parameter count. This bundled experiment cannot attribute changes to one feature alone.','','| Held-out | Seed | v2 accuracy | v3 accuracy | v2 loss | v3 loss | v2 macro F1 | v3 macro F1 |','|---|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        a,b=r['v2'],r['v3']
        lines.append(f"| {r['participant']} | {r['seed']} | {a['testAccuracy']:.2%} | {b['testAccuracy']:.2%} | {a['testLoss']:.4f} | {b['testLoss']:.4f} | {a['macroF1']:.4f} | {b['macroF1']:.4f} |")
    lines+=['','## Mean across completed seeds','','| Held-out | Runs | v2 accuracy | v3 accuracy | v2 F1 | v3 F1 |','|---|---:|---:|---:|---:|---:|']
    for p in sorted({r['participant'] for r in rows}):
        subset=[r for r in rows if r['participant']==p]
        avg=lambda version,key:sum(r[version][key] for r in subset)/len(subset)
        lines.append(f"| {p} | {len(subset)} | {avg('v2','testAccuracy'):.2%} | {avg('v3','testAccuracy'):.2%} | {avg('v2','macroF1'):.4f} | {avg('v3','macroF1'):.4f} |")
    lines+=['','## All signs: correct counts by seed (42 / 43 / 44 when complete)','','| Held-out | Sign | v2 | v3 | Total correct change |','|---|---|---|---|---:|']
    for p in sorted({r['participant'] for r in rows}):
        subset=sorted([r for r in rows if r['participant']==p],key=lambda r:r['seed'])
        for label in sorted(subset[0]['classes']):
            counts={v:[r['classes'][label][v] for r in subset] for v in ('v2','v3')}
            lines.append(f"| {p} | {label} | {' / '.join(map(str,counts['v2']))} | {' / '.join(map(str,counts['v3']))} | {sum(counts['v3'])-sum(counts['v2']):+d} |")
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')


def main():
    output=ROOT/'models'/'geometry_v3_comparison'
    output.mkdir(exist_ok=True)
    rows=[]
    for base in BASELINES:
        experiment=base.replace('_v1','_geometry_v3')
        for seed in (42,43,44):
            suffix='' if seed==42 else f'_seed{seed}'
            run=experiment+suffix
            result=geometry_model_folder(ROOT/'models',run)/'evaluation.json'
            if not result.exists():
                print('Training',run,flush=True)
                code='import sys,runpy; sys.path[:0]='+repr(sys.path)+'; sys.argv='+repr(['train_gru.py','--experiment',experiment,'--seed',str(seed)])+'; runpy.run_path('+repr(str(Path(__file__).with_name('train_gru.py')))+',run_name="__main__")'
                with (output/(run+'.log')).open('w',encoding='utf-8') as log:
                    subprocess.run([sys.executable,'-u','-c',code],stdout=log,stderr=subprocess.STDOUT,check=True,env=dict(os.environ,MPLBACKEND='Agg'))
            new=json.loads(result.read_text())
            old=json.loads((find_model_folder(ROOT/'models',base.replace('_v1','_handshape_v2')+suffix)/'evaluation.json').read_text())
            for key in ('sequenceIds','participantIds','labelToIndex'):
                assert new['preprocessingMetadata'][key]==old['preprocessingMetadata'][key]
            assert old['randomSeed']==new['randomSeed']==seed
            row=dict(participant=new['testParticipant'],seed=seed)
            for version,evaluation in [('v2',old),('v3',new)]:
                row[version]={k:evaluation[k] for k in ('testLoss','testAccuracy','macroF1')}
            row['classes']={label:{v:round(e['classificationReport'][label]['recall']*e['classificationReport'][label]['support']) for v,e in [('v2',old),('v3',new)]} for label in new['preprocessingMetadata']['labelToIndex']}
            rows.append(row)
            report_results(rows,output)
            print(run, row['v3'],flush=True)
    print('Completed:',output/'report.md',flush=True)


if __name__=='__main__': main()
