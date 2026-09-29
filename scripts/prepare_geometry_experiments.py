"""Append 48 geometry channels to v2; preserve its splits and 190 channels."""
import hashlib
import json
from pathlib import Path
import numpy as np
from prepare_handshape_experiments import ROOT, BASELINES
from gesture_geometry import geometry, resample, feature_names


def prepare(base):
    previous=base.replace('_v1','_handshape_v2')
    source=ROOT/'processed'/previous
    target=ROOT/'processed'/base.replace('_v1','_geometry_v3')
    if target.exists():
        raise FileExistsError(target)
    meta=json.loads((source/'metadata.json').read_text())
    sequences={}
    for path in meta['trainSources']+[meta['testSource']]:
        payload=Path(path).read_bytes()
        if hashlib.sha256(payload).hexdigest()!=meta['sourceSha256'][path]:
            raise ValueError('Source changed: '+path)
        data=json.loads(payload)
        for seq in data['sequences']:
            if seq['id'] in sequences:
                raise ValueError('Duplicate sequence ID')
            values=np.asarray([f['features'] for f in seq['frames']],dtype=float)
            sequences[seq['id']]=resample(geometry(values,data['featureSchema']['order']),meta['sequenceLength'])
    extra={split:np.stack([sequences[sid] for sid in ids]) for split,ids in meta['sequenceIds'].items()}
    mean=extra['training'].mean(axis=(0,1),keepdims=True)
    std=extra['training'].std(axis=(0,1),keepdims=True)
    std[std<1e-6]=1
    with np.load(source/'gru_data.npz',allow_pickle=False) as old:
        arrays={key:old[key].copy() for key in old.files}
    original_count=meta['featureCount']
    for split,suffix in [('training','train'),('validation','validation'),('test','test')]:
        key='X_'+suffix
        original=arrays[key]
        arrays[key]=np.concatenate([original,((extra[split]-mean)/std).astype(np.float32)],axis=2)
        assert np.array_equal(arrays[key][:,:,:original_count],original)
        assert np.isfinite(arrays[key]).all()
    arrays['feature_mean']=np.concatenate([arrays['feature_mean'],mean.astype(np.float32)],axis=2)
    arrays['feature_std']=np.concatenate([arrays['feature_std'],std.astype(np.float32)],axis=2)
    meta.update(featureCount=original_count+len(feature_names()),previousExperiment=previous,
                geometryFeatureNames=feature_names(), geometryVersion=3,
                previousTensorSha256=hashlib.sha256((source/'gru_data.npz').read_bytes()).hexdigest(),
                geometryDefinition='Image-coordinate thumb separation, thumb/MCP bend, finger spread, side-adjusted palm normal proxy, projected wrist bend, thumb-shoulder XY distance; independent validity groups; first observed valid shape/orientation repeated; source-frame geometry before masked interpolation. Not anatomical angles, calibrated palm-facing labels or physical contact. Training-only standardization.')
    target.mkdir()
    np.savez_compressed(target/'gru_data.npz',**arrays)
    (target/'metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print('Prepared',target.name,arrays['X_train'].shape,flush=True)


if __name__=='__main__':
    for base in BASELINES: prepare(base)
