"""Inspect all recordings by ID; no labels are used to calculate features."""
import csv
import json
import numpy as np
from prepare_handshape_experiments import ROOT
from gesture_geometry import geometry, NAMES, GROUPS


def main():
    output = ROOT/'models'/'geometry_v3_comparison'
    output.mkdir(exist_ok=True)
    rows = []
    for participant in ('participant_01','participant_02','participant_03'):
        data = json.loads((ROOT/'processed'/f'{participant}-dataset.json').read_text())
        for seq in data['sequences']:
            values = geometry(np.asarray([f['features'] for f in seq['frames']]), data['featureSchema']['order'])
            for side, offset in (('left',0),('right',14)):
                if not values[:,offset].any():
                    continue
                row = dict(sequence_id=seq['id'], participant=participant, label=seq['label'], hand=side)
                for start, end in GROUPS:
                    valid = values[:,offset+start] > .999
                    row[NAMES[start]] = float(valid.mean())
                    for j in range(start+1,end):
                        row[NAMES[j]] = float(np.median(values[valid,offset+j])) if valid.any() else None
                rows.append(row)
    with (output/'geometry_by_sample.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    summaries=[]
    for participant in ('participant_01','participant_02','participant_03'):
        for label in ('WAIT','WAVE_GREETING','THANK_YOU','HELLO','WHEN','WHO','SORRY','PLEASE'):
            subset=[r for r in rows if r['participant']==participant and r['label']==label]
            summary=dict(participant=participant,label=label,hand_observations=len(subset))
            for name in NAMES:
                valid=[r[name] for r in subset if r[name] is not None]
                summary[name]=round(float(np.median(valid)),4) if valid else None
            summaries.append(summary)
    (output/'geometry_summary.json').write_text(json.dumps(summaries,indent=2),encoding='utf-8')
    for row in summaries:
        if row['label'] in ('WAIT','WAVE_GREETING','THANK_YOU'):
            print(json.dumps(row))


if __name__=='__main__': main()
