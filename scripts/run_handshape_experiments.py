"""Run the fixed nine-run handshape comparison; completed runs are preserved.
python scripts/run_handshape_experiments.py
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from prepare_handshape_experiments import ROOT, BASELINES

def main():
    report=ROOT/'models'/'handshape_v2_comparison'
    report.mkdir(exist_ok=True)
    rows=[]
    for base in BASELINES:
        experiment=base.replace('_v1','_handshape_v2')
        for seed in (42,43,44):
            suffix='' if seed==42 else f'_seed{seed}'
            run=experiment+suffix
            result=ROOT/'models'/run/'evaluation.json'
            if not result.exists():
                print('Training',run,flush=True)
                # Propagate the active interpreter's dependency paths to child runs.
                code='import sys,runpy; sys.path[:0]='+repr(sys.path)+'; sys.argv='+repr(['train_gru.py','--experiment',experiment,'--seed',str(seed)])+'; runpy.run_path('+repr(str(Path(__file__).with_name('train_gru.py')))+',run_name="__main__")'
                env=dict(os.environ,MPLBACKEND='Agg')
                with (report/(run+'.log')).open('w',encoding='utf-8') as log:
                    subprocess.run([sys.executable,'-u','-c',code],stdout=log,stderr=subprocess.STDOUT,check=True,env=env)
            new=json.loads(result.read_text())
            old=json.loads((ROOT/'models'/(base+suffix)/'evaluation.json').read_text())
            for key in ('sequenceIds','participantIds','labelToIndex'):
                assert new['preprocessingMetadata'][key]==old['preprocessingMetadata'][key]
            row=dict(test=new['testParticipant'],seed=seed,baselineAccuracy=old['testAccuracy'],handshapeAccuracy=new['testAccuracy'],baselineF1=old['macroF1'],handshapeF1=new['macroF1'])
            for label in ('SORRY','PLEASE','WAIT','WAVE_GREETING'):
                row[label]={variant:e['classificationReport'][label]['recall'] for variant,e in [('baseline',old),('handshape',new)]}
            rows.append(row)
            (report/'comparison.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
            print(json.dumps(row),flush=True)
    lines=['# Handshape v2 comparison','','Same sample IDs, training settings and seeds. Original 164 channels retained; 26 shape channels added. Input size increases model parameter count. Test participants have already informed development: these are exploratory results, not a fresh final test.','','| Test participant | Seed | Baseline accuracy | Handshape accuracy | Baseline macro F1 | Handshape macro F1 |','|---|---:|---:|---:|---:|---:|']
    for r in rows:
        lines.append(f"| {r['test']} | {r['seed']} | {r['baselineAccuracy']:.2%} | {r['handshapeAccuracy']:.2%} | {r['baselineF1']:.4f} | {r['handshapeF1']:.4f} |")
    lines += ['', '## Average across the three seeds', '', '| Test participant | Baseline accuracy | Handshape accuracy | Baseline macro F1 | Handshape macro F1 |', '|---|---:|---:|---:|---:|']
    for participant in sorted({r['test'] for r in rows}):
        subset=[r for r in rows if r['test']==participant]
        avg={k:sum(r[k] for r in subset)/len(subset) for k in ('baselineAccuracy','handshapeAccuracy','baselineF1','handshapeF1')}
        lines.append(f"| {participant} | {avg['baselineAccuracy']:.2%} | {avg['handshapeAccuracy']:.2%} | {avg['baselineF1']:.4f} | {avg['handshapeF1']:.4f} |")
    lines += ['', '## Correct samples out of 20 (seeds 42 / 43 / 44)', '', '| Participant | Sign | Baseline | Handshape |', '|---|---|---|---|']
    for participant in sorted({r['test'] for r in rows}):
        subset=sorted((r for r in rows if r['test']==participant),key=lambda r:r['seed'])
        for label in ('SORRY','PLEASE','WAIT','WAVE_GREETING'):
            counts={v:' / '.join(str(round(r[label][v]*20)) for r in subset) for v in ('baseline','handshape')}
            lines.append(f"| {participant} | {label} | {counts['baseline']} | {counts['handshape']} |")
    (report/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('Completed comparison:',report,flush=True)

if __name__=='__main__': main()
