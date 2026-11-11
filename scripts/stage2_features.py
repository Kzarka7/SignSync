"""Palm-relative hand landmarks for model preparation and inference."""

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
