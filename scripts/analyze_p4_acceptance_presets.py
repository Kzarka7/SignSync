"""Fixed acceptance sensitivity checks, declared before reading pooled test results.

Descriptive comparison only. These presets do not replace validation-selected rules.
"""
import argparse
from pathlib import Path
import shutil
import numpy as np
from run_p4_idle_rejection_experiment import read,write,rejection_metrics,BASE_RULE,sha

PRESETS={f'score{int(c*100)}':dict(confidence=c,margin=.25,maxNonSignMass=.10,minAgreement=2/3) for c in (.80,.90,.95)}

def run(output):
    plan=read(output/'acceptance_presets_protocol.json')
    if plan['rules']!=PRESETS: raise ValueError('Declared presets differ')
    protocol=read(output/'protocol.json'); baseline=Path(protocol['baseline'])
    results={};pooled={}
    for fold in protocol['folds']:
        meta=read(baseline/'folds'/fold/'metadata.json');labels=np.asarray(sorted(meta['labelToIndex'],key=meta['labelToIndex'].get))
        val={'current':[],'idleWeighted':[]};test={'current':[],'idleWeighted':[]}
        for seed in protocol['seeds']:
            name=fold+f'_seed{seed}'
            with np.load(output/'baseline_predictions'/(name+'.npz'),allow_pickle=False) as d:
                val['current'].append(d['validation']);truth_val=labels[d['y_validation']]
            with np.load(baseline/'models'/name/'predictions.npz',allow_pickle=False) as d:
                test['current'].append(d['probabilities']);truth_test=labels[d['y_true']]
            with np.load(output/'models'/name/'predictions.npz',allow_pickle=False) as d:
                val['idleWeighted'].append(d['validation']);test['idleWeighted'].append(d['test'])
        per_fold={}
        for model in val:
            vm,tm=np.stack(val[model]),np.stack(test[model])
            base=rejection_metrics(vm,labels,truth_val,BASE_RULE)
            for preset,rule in PRESETS.items():
                key=model+'_'+preset
                v=rejection_metrics(vm,labels,truth_val,rule)
                t=rejection_metrics(tm,labels,truth_test,rule)
                feasible=v['signCorrectAccepted']>=base['signCorrectAccepted']-int(.02*base['signSamples'])
                per_fold[key]=dict(validation=v,test=t,passesValidationRetention=feasible)
                pooled.setdefault(key,[]).append(per_fold[key])
        results[meta['testParticipant']]=per_fold
    aggregate={}
    for key,parts in pooled.items():
        aggregate[key]={split:{field:sum(p[split][field] for p in parts) for field in ['signSamples','signCorrectAccepted','signWrongAccepted','nonSignSamples','nonSignFalseSignAccepted']} for split in ['validation','test']}
        aggregate[key]['passesRetentionEveryFold']=all(p['passesValidationRetention'] for p in parts)
    write(output/'acceptance_presets.json',dict(protocol=plan,aggregate=aggregate,byParticipant=results))
    lines=['','## Fixed stricter-rule sensitivity checks','',
        'Presets were declared before pooled test results were read: score 80%, 90%, or 95%; margin .25; non-sign probability mass <=.10; at least 2/3 member agreement. These are descriptive trade-offs, not rules selected by the test results. They do not replace validation-selected rules.','',
        '| Model + preset | Validation correct signs accepted / 720 | Validation non-sign false accepts / 48 | Meets 2pp validation retention in every fold | Test correct signs accepted / 1200 | Test wrong signs accepted | Test non-sign false accepts / 153 |',
        '|---|---:|---:|---|---:|---:|---:|']
    for key,v in aggregate.items():
        a,b=v['validation'],v['test'];lines.append(f'| {key} | {a["signCorrectAccepted"]} | {a["nonSignFalseSignAccepted"]} | {v["passesRetentionEveryFold"]} | {b["signCorrectAccepted"]} | {b["signWrongAccepted"]} | {b["nonSignFalseSignAccepted"]} |')
    report=output/'report.md';report.write_text(report.read_text(encoding='utf-8')+'\n'.join(lines)+'\n',encoding='utf-8')
    shutil.copy2(__file__,output/'source'/Path(__file__).name)
    print(aggregate)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);parser.add_argument('--declare',action='store_true');args=parser.parse_args()
    if args.declare:
        if (args.output/'acceptance_presets_protocol.json').exists():raise ValueError('Already declared')
        write(args.output/'acceptance_presets_protocol.json',dict(rules=PRESETS,purpose='Prespecified sensitivity analysis; no selection on test results'))
    else:run(args.output)
