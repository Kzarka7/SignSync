"""Handshape and motion features for the opt-in 43-sign GRU pilot."""
import numpy as np

from gesture_geometry import geometry
from prepare_handshape_experiments import handshape
from stage2_features import palm_relative_frames


GEOMETRY_V3 = 'geometry-v3'
SHAPE_MOTION_V1 = 'shape-motion-v1'
MAX_GAP_SECONDS = .2


def raw_shape_motion_features(sequence, order, length=40):
    frames = sequence['frames']
    raw = np.asarray([frame['features'] for frame in frames], dtype=float)
    time = np.asarray([frame['timestamp'] for frame in frames], dtype=float) / 1000
    time -= time[0]
    dt = np.diff(time)
    if not len(dt) or np.any(dt <= 0):
        raise ValueError('Shape and motion features require ordered frames')
    valid = np.asarray([frame['valid'] for frame in frames], dtype=bool)
    grid = np.linspace(0, time[-1], length)
    # Reject interpolation through a dropped observation or a long source gap.
    right = np.searchsorted(time, grid).clip(0, len(time) - 1)
    left = np.where(time[right] == grid, right, np.maximum(right - 1, 0))
    supported = (time[right] - time[left]) <= MAX_GAP_SECONDS

    def resample(values, mask):
        result = np.column_stack([np.interp(grid, time, channel) for channel in values.T])
        result[~(supported & mask[left] & mask[right])] = 0
        return result

    local_hands = palm_relative_frames(raw)
    bends = handshape(raw, order)
    orientation = geometry(raw, order)
    landmark_blocks, shape_blocks, geometry_blocks, motion_blocks = [], [], [], []
    for side, offset in enumerate((36, 100)):
        local = local_hands[:, side * 64:(side + 1) * 64]
        tracked = valid & (local[:, 0] == 1)
        landmark_blocks.append(resample(local, tracked))
        shape = bends[:, side * 13:(side + 1) * 13]
        shape_blocks.append(resample(shape, tracked & (shape[:, 0] == 1)))
        geo = orientation[:, side * 14:(side + 1) * 14]
        geometry_blocks.extend(resample(geo[:, start:end], tracked & (geo[:, start] == 1))
                               for start, end in ((0, 6), (6, 10), (10, 14)))

        joints = local[:, 1:].reshape(-1, 21, 3)
        thumb = joints[:, 4]
        tip_gaps = np.linalg.norm(joints[:, [8, 12, 16, 20]] - thumb[:, None], axis=2)
        pinky_distal = joints[:, 20] - joints[:, 19]
        relative_thumb = thumb - joints[:, 19]
        pinky_projection = (relative_thumb * pinky_distal).sum(axis=1) / np.maximum(
            (pinky_distal * pinky_distal).sum(axis=1), 1e-6)
        nearest = np.clip(pinky_projection, 0, 1)[:, None] * pinky_distal
        pinky_gap = np.linalg.norm(relative_thumb - nearest, axis=1)
        contact = np.column_stack([tip_gaps, np.clip(pinky_projection, -2, 3), pinky_gap])

        adjacent = tracked[1:] & tracked[:-1] & (dt <= MAX_GAP_SECONDS)
        wrist = raw[:, offset + 1:offset + 3]
        velocity = np.clip(np.diff(wrist, axis=0) / dt[:, None], -8, 8)
        normals = geo[:, 7:10]
        rotated = adjacent & (geo[1:, 6] == 1) & (geo[:-1, 6] == 1)
        cosine = np.clip((normals[1:] * normals[:-1]).sum(axis=1), -1, 1)
        rotation = np.where(rotated, np.minimum(np.arccos(cosine) / dt, 20), 0)
        motion = np.zeros((len(time), 4))
        motion[1:] = np.where(adjacent[:, None], np.column_stack([velocity, rotation, adjacent]), 0)
        motion_blocks.extend((resample(contact, tracked), resample(motion, motion[:, 3] == 1)))

    # 36 body context + 128 hand-relative joints + 26 handshape + 28 geometry + 20 contact/motion.
    return np.column_stack([resample(raw[:, :36], valid), *landmark_blocks, *shape_blocks,
                            *geometry_blocks, *motion_blocks])
