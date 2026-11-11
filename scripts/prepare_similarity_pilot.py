"""Prepare the frozen 43-sign comparison with training-only landmark augmentation."""
import argparse
from pathlib import Path
import shutil

import numpy as np

from sample_pipeline import digest, load_sample, read_csv, read_json, write_json
from sample_training import validate_candidate
from shape_motion_sequence import raw_shape_motion_features


BASELINE = 'samples_43_signs_shape_motion_v1'
CANDIDATE = 'samples_43_signs_similarity_v1'
STATIC = frozenset('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE'.split())
PAIRS = frozenset(('ONE', 'WHAT', 'SIX', 'WEDNESDAY'))


def shifted(sequence, dx=0., dy=0., time_scale=1., drift=0.):
    frames = sequence['frames']
    times = np.array([f['timestamp'] for f in frames])
    elapsed = times-times[0]
    x = dx + drift * elapsed/elapsed[-1]
    values = np.array([f['features'] for f in frames], dtype=float)
    for hand, elbow, wrist in ((36, 12, 20), (100, 16, 24)):
        tracked = values[:, hand] == 1
        values[tracked, hand+1:hand+64:3] += x[tracked, None]
        values[tracked, hand+2:hand+64:3] += dy
        for joint, fraction in ((elbow, .5), (wrist, 1.)):
            visible = tracked & (values[:, joint+3] >= .5)
            values[visible, joint] += fraction*x[visible]
            values[visible, joint+1] += fraction*dy
    return dict(sequence, frames=[dict(frame, timestamp=t, features=v)
                                  for frame, t, v in zip(frames, elapsed*time_scale, values)])


def held_pose(sequence):
    frames = sequence['frames']
    center = frames[len(frames)//4:len(frames)*3//4]
    visible = [f for f in center if f['valid'] and f['features'][7] >= .5 and f['features'][11] >= .5
               and (f['features'][36] == 1 or f['features'][100] == 1)]
    if not visible:
        return None
    # Choose the visible center pose of an approved static sign. The repeated
    # frames are synthetic, with optional mild wrist drift applied separately.
    pose = visible[len(visible)//2]
    return dict(sequence, frames=[dict(pose, timestamp=t) for t in range(0, 401, 25)])


def prepare(root):
    prepared = root / 'processed' / 'candidates'
    baseline = prepared / BASELINE
    target = prepared / CANDIDATE
    if target.exists():
        raise FileExistsError(f'Preserving existing candidate: {target}')
    meta = read_json(baseline / 'metadata.json')
    config = validate_candidate(baseline, meta)
    if len(meta['labelToIndex']) != 43 or not PAIRS | STATIC <= meta['labelToIndex'].keys():
        raise ValueError('Unexpected baseline vocabulary')
    run = root / 'models' / 'candidates' / BASELINE / BASELINE
    verification = read_json(run / 'checkpoint_verification.json')
    if (verification['experiment'] != BASELINE or verification['seed'] != 42
            or verification['metadataSha256'] != digest((baseline / 'metadata.json').read_bytes())
            or verification['checkpointSha256'] != digest((run / 'best_model.h5').read_bytes())):
        raise ValueError('Baseline checkpoint verification failed')
    rows = read_csv(baseline / 'samples.csv')
    order = read_json(baseline / 'feature_schema.json')['order']
    rng = np.random.default_rng(42)
    x, y, ids, kinds = [], [], [], []

    def add(seq, label, kind):
        x.append(raw_shape_motion_features(seq, order).astype(np.float32))
        y.append(meta['labelToIndex'][label]); ids.append(seq['id']); kinds.append(kind)

    for sid in meta['sequenceIds']['training']:
        row = rows[sid]
        label = row['label']
        varied = label in PAIRS or rng.random() < .25
        if not varied and label not in STATIC:
            continue
        export, seq, checksum, _ = load_sample(root / row['sample_path'], label)
        if checksum != row['sha256'] or seq['id'] != sid or export['featureSchema']['order'] != order:
            raise ValueError(f'Approved source changed: {sid}')
        if varied:
            add(shifted(seq, dx=rng.uniform(-.10,.10), dy=rng.uniform(-.24,.24),
                        time_scale=rng.uniform(.8,1.25)), label, 'height-and-speed')
        hold = held_pose(seq) if label in STATIC else None
        if hold is not None:
            add(shifted(hold, dy=rng.uniform(-.18,.18), drift=rng.uniform(-.05,.05)), label, 'steady-hold')

    with np.load(baseline / 'gru_data.npz', allow_pickle=False) as data:
        x = (np.stack(x)-data['feature_mean'])/data['feature_std']
    target.mkdir(parents=True, exist_ok=False)
    for name in meta['artifactSha256']:
        dest = target / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(baseline / name, dest)
    shutil.copy2(__file__, target / 'source' / Path(__file__).name)
    np.savez_compressed(target / 'similarity_training.npz', X=x, y=y, source_ids=ids, kinds=kinds)
    config.update(name=CANDIDATE, similarityTraining={
        'baseline': BASELINE, 'checkpointSha256': verification['checkpointSha256'],
        'augmentationSeed': 42, 'augmentedRows': len(y), 'epochs': 12, 'learningRate': .0003,
        'batchSize': 32, 'pairTrainingWeight': 1.35, 'pairLabels': sorted(PAIRS),
    })
    write_json(target / 'config.json', config)
    meta['experiment'] = CANDIDATE
    meta['artifactSha256'] = {p.relative_to(target).as_posix(): digest(p.read_bytes())
                              for p in sorted(target.rglob('*')) if p.is_file()}
    write_json(target / 'metadata.json', meta)
    validate_candidate(target, meta)
    print(f'{target}\n{len(y)} training augmentations from {len(set(ids))} original clips', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, default=Path(__file__).resolve().parents[2] / 'SignSync Dataset')
    prepare(parser.parse_args().dataset_root)
