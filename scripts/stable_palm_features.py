"""Experimental clip-level palm-scale floor; never imported by live recognition."""
import numpy as np
from prepare_handshape_experiments import handshape, resample_shape
from gesture_geometry import geometry, resample as resample_geometry
from preprocess_dataset import resample_sequence


def scale_floor(vectors, order, hand):
    def xy(name):
        return vectors[:, [order.index(f'{hand}.{name}.{axis}') for axis in 'xy']]
    wrist = xy('wrist')
    original = np.linalg.norm(xy('middle_mcp') - wrist, axis=1)
    distances = np.stack([np.linalg.norm(xy(f'{finger}_mcp') - wrist, axis=1)
                          for finger in ('index', 'middle', 'ring', 'pinky')], axis=1)
    robust = np.median(distances, axis=1)
    valid = (vectors[:, order.index(hand + '.present')] > .999) & (robust > 1e-6)
    reference = np.percentile(robust[valid], 75) if valid.any() else 0.
    return original, np.maximum(original, reference)


CHANGED = sorted(
    [164 + off + j for off in (0, 13) for j in (1, 2, 3, 4, 5, 10, 11, 12)]
    + [190 + off + j for off in (0, 14, 28, 38) for j in (1, 5)]
)


def raw_features(sequence, order, length=40):
    vectors = np.asarray([frame['features'] for frame in sequence['frames']], dtype=float)
    shape, geo = handshape(vectors, order), geometry(vectors, order)
    for side, hand in enumerate(('leftHand', 'rightHand')):
        original, stable = scale_floor(vectors, order, hand)
        ratio = original / np.maximum(stable, 1e-6)
        # Preserve validity, angle, orientation and placement channels exactly.
        shape[:, [side * 13 + j for j in (1, 2, 3, 4, 5, 10, 11, 12)]] *= ratio[:, None]
        geo[:, [side * 14 + j for j in (1, 5)]] *= ratio[:, None]
    return np.concatenate([resample_sequence(sequence['frames'], length, sequence['id']),
                           resample_shape(shape, length), resample_geometry(geo, length)], axis=1)
