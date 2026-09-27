"""Continuous image-coordinate geometry, not anatomical angles or contact labels.

Hand depth is wrist-relative: never subtract hand z from pose z. Camera aspect
ratio is unavailable in these exports, so normal directions are proxies only.
"""
import numpy as np

NAMES = ('shape_valid', 'thumb_index_gap', 'thumb_spread_cos',
         'thumb_fold_cos', 'mcp_fold_cos', 'finger_spread',
         'normal_valid', 'normal_x', 'normal_y', 'normal_z',
         'wrist_valid', 'wrist_cos', 'wrist_sin', 'thumb_shoulder_distance')
GROUPS = ((0, 6), (6, 10), (10, 14))


def unit(v):
    length = np.linalg.norm(v, axis=-1)
    return v / np.maximum(length[..., None], 1e-8), length > 1e-6


def geometry(vectors, order):
    groups = []
    for side in ('left', 'right'):
        hand = side + 'Hand'
        def point(name, axes='xy'):
            return vectors[:, [order.index(f'{hand}.{name}.{a}') for a in axes]]
        def pose(name):
            return vectors[:, [order.index(f'pose.{side}{name}.{a}') for a in 'xy']]
        present = vectors[:, order.index(hand + '.present')] > .999
        wrist = point('wrist')
        scale = np.linalg.norm(point('middle_mcp') - wrist, axis=1)
        valid = present & (scale > 1e-6)
        def cosine(a, b):
            ua, va = unit(a)
            ub, vb = unit(b)
            return np.clip((ua * ub).sum(axis=1), -1, 1), va & vb
        spread, ok1 = cosine(point('thumb_tip') - wrist, point('index_mcp') - wrist)
        fold, ok2 = cosine(point('thumb_mcp') - point('thumb_ip'), point('thumb_tip') - point('thumb_ip'))
        bends = []
        for finger in ('index', 'middle', 'ring', 'pinky'):
            bend, ok = cosine(wrist - point(finger + '_mcp'), point(finger + '_pip') - point(finger + '_mcp'))
            valid &= ok
            bends.append(bend)
        valid &= ok1 & ok2
        gap = np.linalg.norm(point('thumb_tip') - point('index_tip'), axis=1) / np.maximum(scale, 1e-6)
        fingers = sum(np.linalg.norm(point(a+'_tip')-point(b+'_tip'), axis=1)
                      for a, b in (('index','middle'), ('middle','ring'), ('ring','pinky'))) / np.maximum(scale, 1e-6)
        shape = np.column_stack([valid, gap, spread, fold, np.mean(bends, axis=0), fingers])
        shape[~valid] = 0
        # Ordered palm triangle; side correction makes mirrored hands comparable.
        a = point('index_mcp', 'xyz') - point('wrist', 'xyz')
        b = point('pinky_mcp', 'xyz') - point('wrist', 'xyz')
        au, av = unit(a)
        bu, bv = unit(b)
        normal, nv = unit(np.cross(au, bu))
        nv &= present & av & bv
        normal *= 1 if side == 'left' else -1
        orientation = np.column_stack([nv, normal])
        orientation[~nv] = 0
        arm, av = unit(wrist - pose('Elbow'))
        palm, pv = unit(point('middle_mcp') - wrist)
        visible = np.minimum(vectors[:, order.index(f'pose.{side}Elbow.visibility')],
                             vectors[:, order.index(f'pose.{side}Shoulder.visibility')]) > .5
        wv = present & av & pv & visible
        wrist_cos = (arm * palm).sum(axis=1)
        wrist_sin = (arm[:, 0]*palm[:, 1]-arm[:, 1]*palm[:, 0]) * (1 if side == 'left' else -1)
        distance = np.linalg.norm(point('thumb_tip')-pose('Shoulder'), axis=1)
        placement = np.column_stack([wv, wrist_cos, wrist_sin, distance])
        placement[~wv] = 0
        groups.append(np.concatenate([shape, orientation, placement], axis=1))
    return np.concatenate(groups, axis=1)


def resample(values, length):
    positions = np.linspace(0, len(values)-1, length)
    out = np.stack([np.interp(positions, np.arange(len(values)), values[:, j])
                    for j in range(values.shape[1])], axis=1)
    for offset in (0, 14):
        for start, end in GROUPS:
            valid = out[:, offset+start] > .999999
            out[~valid, offset+start:offset+end] = 0
            out[valid, offset+start] = 1
    # Retain the earliest observed shape/orientation throughout the sequence.
    # This is NOT a reconstruction of any unobserved start of the sign.
    initial = []
    for offset in (0, 14):
        for start, end in GROUPS[:2]:
            ids = np.flatnonzero(values[:, offset+start] > .999)
            first = values[ids[0], offset+start:offset+end] if len(ids) else np.zeros(end-start)
            initial.append(np.tile(first, (length, 1)))
    return np.concatenate([out, *initial], axis=1)


def feature_names():
    names = [side+'.'+name for side in ('leftHand','rightHand') for name in NAMES]
    return names + [side+'.first_observed_'+name for side in ('leftHand','rightHand') for name in NAMES[:10]]
