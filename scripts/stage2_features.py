"""Stage 2 landmark transforms shared by preparation and the Recognition Lab."""

import numpy as np


def palm_relative_frames(x):
    result = np.zeros((len(x), 128), dtype=np.float32)
    for source, target in ((36, 0), (100, 64)):
        points = x[:, source + 1:source + 64].reshape(-1, 21, 3)
        centered = points - points[:, :1]
        scale = np.linalg.norm(centered[:, 9], axis=1)
        present = (x[:, source] == 1) & (scale > 1e-6)
        result[present, target] = 1
        result[present, target + 1:target + 64] = (
            centered[present] / scale[present, None, None]).reshape(-1, 63)
    return result


def shape_frame(x, time, valid):
    result = palm_relative_frames(x)
    candidates = np.flatnonzero(valid & ((result[:, 0] == 1) | (result[:, 64] == 1)))
    if not len(candidates):
        return np.zeros(128, dtype=np.float32)
    return result[candidates[np.argmin(abs(time[candidates] - (time[0] + time[-1]) / 2))]]


def motion_frames(x, time, valid):
    if len(x) < 2 or not np.all(np.diff(time) > 0):
        raise ValueError('Motion input requires real, ordered frames')
    target = np.linspace(time[0], time[-1], 40)
    out = np.stack([np.interp(target, time, col) for col in x.T], axis=1)
    supported = np.interp(target, time, valid.astype(float)) > .999999
    normals = []
    for offset in (36, 100):
        present = (out[:, offset] > .999999) & supported
        out[~present, offset:offset + 64] = 0
        points = out[:, offset + 1:offset + 64].reshape(-1, 21, 3)
        normal = np.cross(points[:, 5] - points[:, 0], points[:, 17] - points[:, 0])
        normals.append(normal / np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-6))
    out[~supported, :36] = 0
    return np.column_stack([out, *normals, supported]).astype(np.float32)
