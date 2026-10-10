"""Projected XY joint cosines; not calibrated anatomical angles."""
import numpy as np

FINGERS = ('index', 'middle', 'ring', 'pinky')


def feature_names():
    return [f'{side}Hand.{joint}_{name}' for side in ('left', 'right')
            for joint in ('mcp', 'dip') for name in ('valid',) + FINGERS]


def geometry(values, order):
    columns = {name: i for i, name in enumerate(order)}
    result = []
    for side in ('left', 'right'):
        prefix = side + 'Hand.'
        def point(name):
            return values[:, [columns[prefix + name + '.' + axis] for axis in 'xy']]
        present = values[:, columns[prefix + 'present']] > .999
        for joint in ('mcp', 'dip'):
            valid = present.copy()
            angles = []
            for finger in FINGERS:
                center = point(finger + '_' + joint)
                a = point('wrist' if joint == 'mcp' else finger + '_pip') - center
                b = point(finger + ('_pip' if joint == 'mcp' else '_tip')) - center
                na, nb = np.linalg.norm(a, axis=1), np.linalg.norm(b, axis=1)
                valid &= (na > 1e-6) & (nb > 1e-6) & np.isfinite(a).all(axis=1) & np.isfinite(b).all(axis=1)
                angles.append(np.clip(np.sum(a*b, axis=1)/np.maximum(na*nb, 1e-12), -1, 1))
            block = np.column_stack([valid, *angles])
            block[~valid] = 0
            result.append(block)
    return np.concatenate(result, axis=1)


def resample(values, count):
    if len(values) == 0:
        raise ValueError('Empty sequence')
    source = np.linspace(0, 1, len(values))
    target = np.linspace(0, 1, count)
    out = np.column_stack([np.interp(target, source, col) for col in values.T])
    for start in (0, 5, 10, 15):
        out[out[:, start] < .999999, start:start+5] = 0
    return out
