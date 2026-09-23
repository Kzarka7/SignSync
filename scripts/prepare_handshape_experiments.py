"""Create handshape-v2 tensors using the exact baseline IDs and original channels.
Run python scripts/prepare_handshape_experiments.py. Never overwrites outputs.
"""
import hashlib
import json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent / 'SignSync Dataset'
BASELINES = ('gru_p01_p02_train_p03_test_v1', 'gru_p01_p03_train_p02_test_v1', 'gru_p02_p03_train_p01_test_v1')
FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')

def handshape(vectors, order):
    """XY hand-size-normalized shape: validity, five extensions, four curls, three spreads per hand."""
    groups = []
    for hand in ('leftHand', 'rightHand'):
        def xy(name):
            return vectors[:, [order.index(f'{hand}.{name}.{a}') for a in 'xy']]
        wrist = xy('wrist')
        scale = np.linalg.norm(xy('middle_mcp') - wrist, axis=1)
        valid = (vectors[:, order.index(hand+'.present')] > .999) & (scale > 1e-6)
        values = [np.linalg.norm(xy(f+'_tip')-wrist, axis=1)/np.maximum(scale,1e-6) for f in FINGERS]
        for f in FINGERS[1:]:
            u, v = xy(f+'_mcp')-xy(f+'_pip'), xy(f+'_dip')-xy(f+'_pip')
            denom = np.linalg.norm(u,axis=1)*np.linalg.norm(v,axis=1)
            valid &= denom > 1e-10
            # Zero for straight fingers, one for fully folded projected fingers.
            values.append(1-np.arccos(np.clip((u*v).sum(axis=1)/np.maximum(denom,1e-10),-1,1))/np.pi)
        for a,b in zip(FINGERS[1:-1],FINGERS[2:]):
            values.append(np.linalg.norm(xy(a+'_tip')-xy(b+'_tip'),axis=1)/np.maximum(scale,1e-6))
        group = np.column_stack([valid.astype(float), *values])
        group[~valid] = 0
        groups.append(group)
    return np.concatenate(groups,axis=1)

def resample_shape(values, length):
    positions=np.linspace(0,len(values)-1,length)
    out=np.stack([np.interp(positions,np.arange(len(values)),values[:,j]) for j in range(values.shape[1])],axis=1)
    # Do not invent hand geometry across missing-detection boundaries.
    for start in (0,13):
        valid=out[:,start] > .999999
        out[~valid,start:start+13]=0
        out[valid,start]=1
    return out

def prepare(base):
    source=ROOT/'processed'/base
    target=ROOT/'processed'/base.replace('_v1','_handshape_v2')
    if target.exists():
        raise FileExistsError(target)
    meta=json.loads((source/'metadata.json').read_text())
    sequences={}
    for path in meta['trainSources']+[meta['testSource']]:
        payload=Path(path).read_bytes()
        if hashlib.sha256(payload).hexdigest()!=meta['sourceSha256'][path]:
            raise ValueError('Source hash changed: '+path)
        data=json.loads(payload)
        for s in data['sequences']:
            if s['id'] in sequences: raise ValueError('Duplicate ID')
            values=np.asarray([f['features'] for f in s['frames']],dtype=float)
            sequences[s['id']]=resample_shape(handshape(values,data['featureSchema']['order']),meta['sequenceLength'])
    extra={split:np.stack([sequences[sid] for sid in ids]) for split,ids in meta['sequenceIds'].items()}
    mean=extra['training'].mean(axis=(0,1),keepdims=True)
    std=extra['training'].std(axis=(0,1),keepdims=True)
    std[std<1e-6]=1
    with np.load(source/'gru_data.npz',allow_pickle=False) as old:
        arrays={key:old[key].copy() for key in old.files}
    for split,suffix in [('training','train'),('validation','validation'),('test','test')]:
        key='X_'+suffix
        original=arrays[key]
        arrays[key]=np.concatenate([original,((extra[split]-mean)/std).astype(np.float32)],axis=2)
        assert np.array_equal(arrays[key][:,:,:164],original)
        assert np.isfinite(arrays[key]).all()
    arrays['feature_mean']=np.concatenate([arrays['feature_mean'],mean.astype(np.float32)],axis=2)
    arrays['feature_std']=np.concatenate([arrays['feature_std'],std.astype(np.float32)],axis=2)
    names=[]
    for hand in ('leftHand','rightHand'):
        names.extend([hand+'.shape_valid']+[hand+'.extension_'+f for f in FINGERS]+[hand+'.curl_'+f for f in FINGERS[1:]]+[hand+'.spread_'+a+'_'+b for a,b in zip(FINGERS[1:-1],FINGERS[2:])])
    meta.update(featureCount=190,baselineExperiment=base,addedFeatureNames=names,
        handshapeVersion=2,handshapeDefinition='XY projected, wrist-middle MCP scale; computed before resampling; missing/degenerate geometry zeroed with validity flags; full-valid interpolation only; appended channels standardized on training subset only',
        baselineTensorSha256=hashlib.sha256((source/'gru_data.npz').read_bytes()).hexdigest())
    target.mkdir()
    np.savez_compressed(target/'gru_data.npz',**arrays)
    (target/'metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print('Prepared',target.name,arrays['X_train'].shape,flush=True)

if __name__=='__main__':
    for base in BASELINES: prepare(base)
