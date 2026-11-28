"""ix-poss-motion-v1 features and raw-landmark augmentation (IX/POSS 12-sign model).

Feature design (one row per resampled frame, 32 channels):
- Folded to one canonical signing hand: the dominant hand slot (most frames
  present) is used, and x is mirrored when it is the left slot, so left- and
  right-handed takes share one pattern.
- Handshape: 13 hand-size-normalized values (presence, 5 extensions, 4 curls,
  3 spreads) from prepare_handshape_experiments.handshape.
- Orientation: index pointing unit vector (tip - MCP) and palm normal, 3D each.
- Position: wrist x/y (shoulder-centred, shoulder-width units) and wrist
  displacement from the first tracked frame of the sign.
- Motion: wrist velocity x/y and speed (shoulder widths per second).
- Clip-level shape of the movement, repeated on every row: lateral range,
  vertical range and path length of the wrist. Clip duration is deliberately
  excluded because it differs between recording setups.
- Flags: normalized time, dominant-hand tracked, other hand visible.

Time is resampled over the tracked span of the dominant hand only (leading and
trailing frames without the hand are dropped), with no interpolation across
gaps longer than 0.2 s.
"""
import numpy as np

from prepare_handshape_experiments import handshape

VARIANT = 'ix-poss-motion-v1'
MAX_GAP_SECONDS = .2
CHANNELS = (['shape.' + n for n in ('valid', 'ext_thumb', 'ext_index', 'ext_middle', 'ext_ring', 'ext_pinky',
                                    'curl_index', 'curl_middle', 'curl_ring', 'curl_pinky',
                                    'spread_im', 'spread_mr', 'spread_rp')]
            + ['point.x', 'point.y', 'point.z', 'palm.x', 'palm.y', 'palm.z',
               'wrist.x', 'wrist.y', 'disp.x', 'disp.y', 'vel.x', 'vel.y', 'speed',
               'clip.range_x', 'clip.range_y', 'clip.path', 'time', 'tracked', 'other_hand'])
HAND_OFFSET = {'left': 36, 'right': 100}


def _unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def dominant_slot(raw):
    present = {h: raw[:, o] > .5 for h, o in HAND_OFFSET.items()}
    def travel(h):
        o = HAND_OFFSET[h]; w = raw[present[h]][:, o + 1:o + 3]
        return float(np.linalg.norm(np.diff(w, axis=0), axis=1).sum()) if len(w) > 1 else 0.
    return max(HAND_OFFSET, key=lambda h: (int(present[h].sum()), travel(h)))


def motion_features(frames, order, length=40):
    raw = np.asarray([f['features'] for f in frames], dtype=float)
    time = np.asarray([f['timestamp'] for f in frames], dtype=float) / 1000
    valid = np.asarray([f['valid'] for f in frames], dtype=bool)
    if len(time) < 2 or np.any(np.diff(time) <= 0):
        raise ValueError('ordered frames required')
    slot = dominant_slot(raw)
    other = 'right' if slot == 'left' else 'left'
    offset = HAND_OFFSET[slot]
    tracked = valid & (raw[:, offset] > .5)
    if tracked.sum() < 2:
        raise ValueError('dominant hand tracked in fewer than two frames')
    sign = -1. if slot == 'left' else 1.
    joints = raw[:, offset + 1:offset + 64].reshape(-1, 21, 3).copy()
    joints[:, :, 0] *= sign
    shape = handshape(raw, order)[:, (0 if slot == 'left' else 13):(13 if slot == 'left' else 26)]
    wrist = joints[:, 0]
    point = _unit(joints[:, 8] - joints[:, 5])
    palm = _unit(np.cross(joints[:, 5] - wrist, joints[:, 17] - wrist))
    other_visible = (valid & (raw[:, HAND_OFFSET[other]] > .5)).astype(float)

    first, last = np.flatnonzero(tracked)[[0, -1]]
    span = slice(first, last + 1)
    t = time[span] - time[first]
    ok = tracked[span]
    grid = np.linspace(0, t[-1], length)
    right = np.searchsorted(t, grid).clip(0, len(t) - 1)
    left = np.where(t[right] == grid, right, np.maximum(right - 1, 0))
    supported = ((t[right] - t[left]) <= MAX_GAP_SECONDS) & ok[left] & ok[right]

    def resample(values):
        values = values[span]
        keep = ok
        out = np.column_stack([np.interp(grid, t[keep], values[keep, j]) for j in range(values.shape[1])])
        out[~supported] = 0
        return out

    shape_r = resample(shape)
    point_r = resample(point)
    palm_r = resample(palm)
    wrist_r = resample(wrist[:, :2])
    start = wrist[span][ok][0, :2]
    disp_r = np.where(supported[:, None], wrist_r - start, 0)
    dt = max(t[-1] / (length - 1), 1e-3)
    vel = np.zeros((length, 2))
    both = supported[1:] & supported[:-1]
    vel[1:][both] = np.clip(np.diff(wrist_r, axis=0)[both] / dt, -8, 8)
    speed = np.linalg.norm(vel, axis=1, keepdims=True)
    tracked_w = wrist[span][ok][:, :2]
    clip = np.array([np.ptp(tracked_w[:, 0]), np.ptp(tracked_w[:, 1]),
                     float(np.linalg.norm(np.diff(tracked_w, axis=0), axis=1).sum())])
    other_r = np.interp(grid, t, other_visible[span])[:, None]
    features = np.column_stack([shape_r, point_r, palm_r, wrist_r, disp_r, vel, speed,
                                np.repeat(clip[None], length, axis=0), grid[:, None] / max(t[-1], 1e-3),
                                supported[:, None].astype(float), other_r])
    assert features.shape == (length, len(CHANNELS))
    return features


# ---------------------------------------------------------------------------
# Raw-landmark augmentation (training only). Operates on the collector's 164
# channels so every feature variant sees physically consistent changes.
# ---------------------------------------------------------------------------
POSE_ARM_XY = [(12, 13), (16, 17), (20, 21), (24, 25)]  # elbows and wrists (x, y)


def augment_frames(frames, rng):
    """Speed change, monotone time warp, start/end trim, hand shift/scale and in-plane hand rotation."""
    n = len(frames)
    raw = np.asarray([f['features'] for f in frames], dtype=float)
    time = np.asarray([f['timestamp'] for f in frames], dtype=float)
    valid = [bool(f['valid']) for f in frames]
    # Trim up to 12% from each end, keeping at least 8 frames.
    cut = int(n * .12)
    a = rng.integers(0, cut + 1) if cut else 0
    b = n - (rng.integers(0, cut + 1) if cut else 0)
    if b - a < 8:
        a, b = 0, n
    raw, time, valid = raw[a:b].copy(), time[a:b] - time[a], valid[a:b]
    # Speed (0.7-1.4x duration) and a monotone power warp.
    span = max(time[-1], 1.)
    gamma = rng.uniform(.8, 1.25)
    time = (time / span) ** gamma * span * rng.uniform(.7, 1.4)
    time = np.maximum.accumulate(time + np.arange(len(time)) * 1e-6)
    # Spatial: shift and scale the arms/hands about the shoulder origin; rotate each hand about its wrist.
    shift = rng.uniform(-.15, .15, size=2)
    scale = rng.uniform(.85, 1.15)
    for xi, yi in POSE_ARM_XY:
        raw[:, xi] = raw[:, xi] * scale + shift[0]
        raw[:, yi] = raw[:, yi] * scale + shift[1]
    for offset in HAND_OFFSET.values():
        present = raw[:, offset] > .5
        if not present.any():
            continue
        joints = raw[present, offset + 1:offset + 64].reshape(-1, 21, 3)
        angle = np.deg2rad(rng.uniform(-10, 10))
        c, s = np.cos(angle), np.sin(angle)
        rel = joints[:, :, :2] - joints[:, :1, :2]
        rotated = np.stack([rel[..., 0] * c - rel[..., 1] * s, rel[..., 0] * s + rel[..., 1] * c], axis=-1)
        joints[:, :, :2] = (joints[:, :1, :2] * scale + shift) + rotated * scale
        raw[present, offset + 1:offset + 64] = joints.reshape(len(joints), 63)
    return [{'timestamp': float(t), 'features': row.tolist(), 'valid': v} for t, row, v in zip(time, raw, valid)]
