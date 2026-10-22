"""Append 20 individual finger-joint channels to full geometry v3."""
from processed_paths import processed_artifact_path, resolve_artifact_path
import hashlib
import json
from pathlib import Path
import numpy as np
from prepare_handshape_experiments import ROOT, BASELINES
from finger_joint_features import geometry, resample, feature_names


def prepare(base):
    previous=base.replace('_v1','_geometry_v3')
    source=processed_artifact_path(ROOT/'processed', previous)
    experiment=previous+'_finger_joints'
    target=processed_artifact_path(ROOT/'processed', experiment)
    meta=json.loads((source/'metadata.json').read_text())
    if meta['featureCount'] != 238:
        raise ValueError('Expected full geometry v3 with 238 channels')
    sequences={}
    for path in meta['trainSources']+[meta['testSource']]:
        payload=resolve_artifact_path(path).read_bytes()
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
                fingerJointFeatureNames=feature_names(), fingerJointVersion=1,
                previousTensorSha256=hashlib.sha256((source/'gru_data.npz').read_bytes()).hexdigest(),
                fingerJointDefinition='20 projected XY features: independent MCP and DIP cosine groups with validity, four fingers per hand. Computed before resampling, training-only standardization, no extra starting copies. Full v3 channels unchanged. Not anatomical angles.')
    if target.exists():
        if json.loads((target/'metadata.json').read_text(encoding='utf-8')) != meta:
            raise ValueError('Existing metadata differs')
        with np.load(target/'gru_data.npz', allow_pickle=False) as saved:
            if set(saved.files) != set(arrays) or any(not np.array_equal(saved[k],v) for k,v in arrays.items()):
                raise ValueError('Existing tensors differ')
    else:
        target.mkdir(parents=True)
        np.savez_compressed(target/'gru_data.npz',**arrays)
        (target/'metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print('Verified',target.name,arrays['X_train'].shape,flush=True)
    return experiment


if __name__=='__main__':
    for base in BASELINES: prepare(base)
