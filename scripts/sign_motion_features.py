"""sign-motion-v1: two-hand motion features (extends ix-poss-motion-v1 to two-handed signs).

64 channels per resampled frame:
- Folding: the dominant hand is the slot that moves most among slots tracked in
  at least half as many frames as the best-tracked slot. If it is the left slot,
  all x coordinates are mirrored, so left- and right-handed takes share one pattern.
- Per hand (dominant, then other), 27 channels: handshape (13: presence, 5
  extensions, 4 curls, 3 spreads), index pointing unit vector (3), palm normal (3),
  wrist x/y (2, shoulder-centred, shoulder-width units), wrist displacement from
  that hand's first tracked frame (2), wrist velocity x/y (2) and speed (1), tracked flag (1).
- Between hands (5): other-minus-dominant wrist dx/dy, wrist distance, closest
  fingertip distance between the hands, and a both-tracked flag.
- Clip-level, repeated on every row (4): dominant lateral and vertical range and
  path length, and other-hand path length. Clip duration is excluded.
- Normalized time (1).
Time is resampled over the span in which any hand is tracked, with no
interpolation across gaps longer than 0.2 s. Augmentation reuses
ix_poss_motion.augment_frames.
"""
import numpy as np

from prepare_handshape_experiments import handshape

VARIANT = 'sign-motion-v1'
MAX_GAP_SECONDS = .2
HAND_OFFSET = {'left': 36, 'right': 100}
SHAPE = ['valid', 'ext_thumb', 'ext_index', 'ext_middle', 'ext_ring', 'ext_pinky', 'curl_index', 'curl_middle',
         'curl_ring', 'curl_pinky', 'spread_im', 'spread_mr', 'spread_rp']
PER_HAND = (['shape.' + n for n in SHAPE] + ['point.x', 'point.y', 'point.z', 'palm.x', 'palm.y', 'palm.z',
            'wrist.x', 'wrist.y', 'disp.x', 'disp.y', 'vel.x', 'vel.y', 'speed', 'tracked'])
CHANNELS = (['dom.' + c for c in PER_HAND] + ['other.' + c for c in PER_HAND]
            + ['pair.dx', 'pair.dy', 'pair.distance', 'pair.tip_distance', 'pair.both_tracked',
               'clip.dom_range_x', 'clip.dom_range_y', 'clip.dom_path', 'clip.other_path', 'time'])
TIPS = [4, 8, 12, 16, 20]


def _unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def _path(points):
    return float(np.linalg.norm(np.diff(points, axis=0), axis=1).sum()) if len(points) > 1 else 0.


def dominant_slot(raw, valid):
    tracked = {h: valid & (raw[:, o] > .5) for h, o in HAND_OFFSET.items()}
    best = max(int(t.sum()) for t in tracked.values())
    candidates = [h for h, t in tracked.items() if t.sum() >= max(2, .5 * best)]
    if not candidates:
        raise ValueError('no hand tracked in at least two frames')
    return max(candidates, key=lambda h: (_path(raw[tracked[h]][:, HAND_OFFSET[h] + 1:HAND_OFFSET[h] + 3]),
                                          int(tracked[h].sum())))


def sign_motion_features(frames, order, length=40):
    raw = np.asarray([f['features'] for f in frames], dtype=float)
    time = np.asarray([f['timestamp'] for f in frames], dtype=float) / 1000
    valid = np.asarray([f['valid'] for f in frames], dtype=bool)
    if len(time) < 2 or np.any(np.diff(time) <= 0):
        raise ValueError('ordered frames required')
    dom = dominant_slot(raw, valid)
    slots = [dom, 'right' if dom == 'left' else 'left']
    sign = -1. if dom == 'left' else 1.
    shapes = handshape(raw, order)
    tracked_any = np.zeros(len(raw), bool)
    hands = []
    for slot in slots:
        o = HAND_OFFSET[slot]
        tracked = valid & (raw[:, o] > .5)
        joints = raw[:, o + 1:o + 64].reshape(-1, 21, 3).copy()
        joints[:, :, 0] *= sign
        shape = shapes[:, (0 if slot == 'left' else 13):(13 if slot == 'left' else 26)]
        hands.append(dict(tracked=tracked, joints=joints, shape=shape))
        tracked_any |= tracked
    if hands[0]['tracked'].sum() < 2:
        raise ValueError('dominant hand tracked in fewer than two frames')

    first, last = np.flatnonzero(tracked_any)[[0, -1]]
    span = slice(first, last + 1)
    t = time[span] - time[first]
    grid = np.linspace(0, t[-1], length)
    right = np.searchsorted(t, grid).clip(0, len(t) - 1)
    left = np.where(t[right] == grid, right, np.maximum(right - 1, 0))
    close = (t[right] - t[left]) <= MAX_GAP_SECONDS
    dt = max(t[-1] / (length - 1), 1e-3)

    blocks, resampled_wrists, supports, paths, ranges = [], [], [], [], None
    for hand in hands:
        ok = hand['tracked'][span]
        supported = close & ok[left] & ok[right]
        width = len(PER_HAND)
        if ok.sum() < 2:
            blocks.append(np.zeros((length, width)))
            resampled_wrists.append(np.zeros((length, 2))); supports.append(np.zeros(length, bool))
            paths.append(0.); continue
        joints = hand['joints'][span]
        wrist = joints[:, 0]
        point = _unit(joints[:, 8] - joints[:, 5])
        palm = _unit(np.cross(joints[:, 5] - wrist, joints[:, 17] - wrist))

        def resample(values):
            out = np.column_stack([np.interp(grid, t[ok], values[ok, j]) for j in range(values.shape[1])])
            out[~supported] = 0
            return out

        wrist_r = resample(wrist[:, :2])
        disp = np.where(supported[:, None], wrist_r - wrist[ok][0, :2], 0)
        vel = np.zeros((length, 2))
        both = supported[1:] & supported[:-1]
        vel[1:][both] = np.clip(np.diff(wrist_r, axis=0)[both] / dt, -8, 8)
        blocks.append(np.column_stack([resample(hand['shape'][span]), resample(point), resample(palm), wrist_r, disp,
                                       vel, np.linalg.norm(vel, axis=1, keepdims=True), supported[:, None].astype(float)]))
        resampled_wrists.append(wrist_r); supports.append(supported)
        tracked_wrist = wrist[ok][:, :2]
        paths.append(_path(tracked_wrist))
        if ranges is None:
            ranges = [float(np.ptp(tracked_wrist[:, 0])), float(np.ptp(tracked_wrist[:, 1]))]

    both = supports[0] & supports[1]
    pair = np.zeros((length, 5))
    if both.any():
        d = resampled_wrists[1] - resampled_wrists[0]
        tips = []
        for hand in hands:
            ok = hand['tracked'][span]
            tip = hand['joints'][span][:, TIPS, :2]
            tips.append(np.stack([np.column_stack([np.interp(grid, t[ok], tip[ok, k, a]) for a in range(2)])
                                  for k in range(len(TIPS))], axis=1) if ok.sum() >= 2 else np.zeros((length, 5, 2)))
        closest = np.linalg.norm(tips[0][:, :, None] - tips[1][:, None], axis=-1).min(axis=(1, 2))
        pair = np.column_stack([d, np.linalg.norm(d, axis=1), closest, np.ones(length)])
        pair[~both] = 0
    clip = np.array([*(ranges or [0., 0.]), paths[0], paths[1]])
    features = np.column_stack([*blocks, pair, np.repeat(clip[None], length, axis=0), grid[:, None] / max(t[-1], 1e-3)])
    assert features.shape == (length, len(CHANNELS))
    return features
