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

sign-motion-joints-v1 (recipe D, sign_motion_joints_features at the end of this file) appends
126 hand-relative finger-joint channels to these 64, for 190 in total.
sign-motion-cues-v1 (recipe E, sign_motion_cues_features) appends 15 tilt/height/aperture cue
channels to those 190, for 205; augment_frames_mild_vertical is its augmentation.
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


# --- sign-motion-joints-v1 (recipe D) -------------------------------------------------
# The 64 sign-motion-v1 channels plus full hand-relative finger joints for the dominant
# and the other hand (63 each): every joint minus the wrist, divided by the wrist->middle_mcp
# distance, as in stage2_features.palm_relative_frames (the wrist row is therefore 0).
# Same dominant-hand choice and x-mirroring (applied before computing), same time grid,
# per-hand tracked mask and 0.2 s gap rule as sign_motion_features; unsupported rows are 0.
JOINTS_VARIANT = 'sign-motion-joints-v1'
JOINT_CHANNELS = [f'{side}.joint{j:02d}.{a}' for side in ('dom', 'other') for j in range(21) for a in 'xyz']
JOINTS_CHANNELS = CHANNELS + JOINT_CHANNELS


def hand_joint_features(frames, length=40):
    raw = np.asarray([f['features'] for f in frames], dtype=float)
    time = np.asarray([f['timestamp'] for f in frames], dtype=float) / 1000
    valid = np.asarray([f['valid'] for f in frames], dtype=bool)
    if len(time) < 2 or np.any(np.diff(time) <= 0):
        raise ValueError('ordered frames required')
    dom = dominant_slot(raw, valid)
    sign = -1. if dom == 'left' else 1.
    tracked = {s: valid & (raw[:, o] > .5) for s, o in HAND_OFFSET.items()}
    tracked_any = tracked['left'] | tracked['right']
    first, last = np.flatnonzero(tracked_any)[[0, -1]]
    span = slice(first, last + 1)
    t = time[span] - time[first]
    grid = np.linspace(0, t[-1], length)
    right = np.searchsorted(t, grid).clip(0, len(t) - 1)
    left = np.where(t[right] == grid, right, np.maximum(right - 1, 0))
    close = (t[right] - t[left]) <= MAX_GAP_SECONDS
    blocks = []
    for slot in (dom, 'right' if dom == 'left' else 'left'):
        o = HAND_OFFSET[slot]
        ok = tracked[slot][span]
        if ok.sum() < 2:
            blocks.append(np.zeros((length, 63))); continue
        joints = raw[span, o + 1:o + 64].reshape(-1, 21, 3).copy()
        joints[:, :, 0] *= sign
        centered = joints - joints[:, :1]
        scale = np.maximum(np.linalg.norm(centered[:, 9], axis=1), 1e-6)
        rel = (centered / scale[:, None, None]).reshape(-1, 63)
        supported = close & ok[left] & ok[right]
        out = np.column_stack([np.interp(grid, t[ok], rel[ok, j]) for j in range(63)])
        out[~supported] = 0
        blocks.append(out)
    return np.column_stack(blocks)


def sign_motion_joints_features(frames, order, length=40):
    features = np.column_stack([sign_motion_features(frames, order, length), hand_joint_features(frames, length)])
    assert features.shape == (length, len(JOINTS_CHANNELS)) == (length, 190)
    return features


# --- sign-motion-cues-v1 (recipe E) ---------------------------------------------------
# sign-motion-joints-v1 (190) + 15 dominant-hand cue channels (205 in total), from the cue
# measurements in analysis/measure_cues.py:
#   per frame (7, same time grid / tracked mask / 0.2 s gap rule as above, unsupported rows 0):
#     height above the nose (nose y - wrist y), detrended roll angle and its velocity, detrended
#     twist angle and its velocity, aperture and its velocity.
#     roll = in-image angle of wrist->middle_mcp (hand rocking), twist = palm-normal angle in x/z
#     (forearm rotation), aperture = mean thumb/index/middle tip-to-wrist distance / hand size.
#   per clip (8, repeated on every row): log1p swing (p90-p10 after a linear detrend) of roll, twist
#     and aperture, their reversals per second (hysteresis 8 deg / 8 deg / 0.08), measured at 10 Hz in
#     the central 70% of the dominant hand's tracked span; start height (first 20%) and height drop.
# Same dominant-hand choice and x-mirroring as sign_motion_features, applied before computing.
CUES_VARIANT = 'sign-motion-cues-v1'
CUE_FRAME_CHANNELS = ['cue.height', 'cue.roll', 'cue.roll_vel', 'cue.twist', 'cue.twist_vel', 'cue.aperture',
                      'cue.aperture_vel']
CUE_CLIP_CHANNELS = ['cue.roll_swing', 'cue.twist_swing', 'cue.aperture_swing', 'cue.roll_rev', 'cue.twist_rev',
                     'cue.aperture_rev', 'cue.height_start', 'cue.height_drop']
CUES_CHANNELS = JOINTS_CHANNELS + CUE_FRAME_CHANNELS + CUE_CLIP_CHANNELS
CUE_BANDS = {'roll': 8., 'twist': 8., 'aperture': .08}
CUE_VEL_CLIP = {'roll': 600., 'twist': 600., 'aperture': 8.}


def _swing(v):
    if len(v) < 3:
        return 0.
    x = np.arange(len(v))
    r = v - np.polyval(np.polyfit(x, v, 1), x)
    return float(np.percentile(r, 90) - np.percentile(r, 10))


def _reversals(v, band):
    count, direction, extreme = 0, 0, v[0] if len(v) else 0
    for x in v[1:]:
        if direction >= 0 and x > extreme or direction <= 0 and x < extreme:
            extreme = x
            if direction == 0 and abs(x - v[0]) >= band:
                direction = 1 if x > v[0] else -1
        elif direction != 0 and abs(x - extreme) >= band:
            count += 1
            direction = -direction
            extreme = x
        elif direction == 0 and abs(x - extreme) >= band:
            direction = 1 if x > extreme else -1
            extreme = x
    return count


def _detrend(t, v):
    return v - np.polyval(np.polyfit(t, v, 1), t) if len(v) >= 3 else v - v.mean()


def hand_cue_features(frames, length=40):
    raw = np.asarray([f['features'] for f in frames], dtype=float)
    time = np.asarray([f['timestamp'] for f in frames], dtype=float) / 1000
    valid = np.asarray([f['valid'] for f in frames], dtype=bool)
    if len(time) < 2 or np.any(np.diff(time) <= 0):
        raise ValueError('ordered frames required')
    dom = dominant_slot(raw, valid)
    sign = -1. if dom == 'left' else 1.
    tracked = {s: valid & (raw[:, o] > .5) for s, o in HAND_OFFSET.items()}
    first, last = np.flatnonzero(tracked['left'] | tracked['right'])[[0, -1]]
    span = slice(first, last + 1)
    t = time[span] - time[first]
    grid = np.linspace(0, t[-1], length)
    right = np.searchsorted(t, grid).clip(0, len(t) - 1)
    left = np.where(t[right] == grid, right, np.maximum(right - 1, 0))
    close = (t[right] - t[left]) <= MAX_GAP_SECONDS
    dt = max(t[-1] / (length - 1), 1e-3)
    frame_block = np.zeros((length, len(CUE_FRAME_CHANNELS)))
    clip = np.zeros(len(CUE_CLIP_CHANNELS))
    o = HAND_OFFSET[dom]
    ok = tracked[dom][span]
    if ok.sum() < 2:
        return np.column_stack([frame_block, np.repeat(clip[None], length, axis=0)])
    j = raw[span, o + 1:o + 64].reshape(-1, 21, 3)[ok].copy()
    j[:, :, 0] *= sign
    tk = t[ok]
    axis = j[:, 9] - j[:, 0]
    size = np.maximum(np.linalg.norm(axis[:, :2], axis=1), 1e-6)
    normal = np.cross(j[:, 5] - j[:, 0], j[:, 17] - j[:, 0])
    signals = {'height': raw[span, 1][ok] - j[:, 0, 1],
               'roll': np.degrees(np.unwrap(np.arctan2(axis[:, 0], -axis[:, 1]))),
               'twist': np.degrees(np.unwrap(np.arctan2(normal[:, 0], -normal[:, 2]))),
               'aperture': np.mean([np.linalg.norm(j[:, f, :2] - j[:, 0, :2], axis=1) / size for f in (4, 8, 12)], axis=0)}
    supported = close & ok[left] & ok[right]
    both = supported[1:] & supported[:-1]

    def resample(v):
        out = np.interp(grid, tk, v)
        out[~supported] = 0
        return out

    columns = [resample(signals['height'])]
    for name in ('roll', 'twist', 'aperture'):
        v = resample(signals[name] if name == 'aperture' else _detrend(tk, signals[name]))
        vel = np.zeros(length)
        vel[1:][both] = np.clip(np.diff(v)[both] / dt, -CUE_VEL_CLIP[name], CUE_VEL_CLIP[name])
        columns += [v, vel]
    frame_block = np.column_stack(columns)
    # clip-level cues at 10 Hz over the dominant hand's tracked span (as in analysis/measure_cues.py)
    t0 = tk - tk[0]
    dur = t0[-1]
    if dur >= .3:
        g10 = np.arange(0, dur, .1)
        hold = (g10 >= .15 * dur) & (g10 <= .85 * dur)
        hold_s = max(hold.sum() * .1, .1)
        s10 = {n: np.interp(g10, t0, v) for n, v in signals.items()}
        swings = [np.log1p(_swing(s10[n][hold])) for n in ('roll', 'twist', 'aperture')]
        revs = [_reversals(s10[n][hold], CUE_BANDS[n]) / hold_s for n in ('roll', 'twist', 'aperture')]
        first_part, last_part = g10 <= .2 * dur, g10 >= .8 * dur
        last_part[-1] = True  # short clips: the 10 Hz grid may have no point in the last 20%
        start = float(np.median(s10['height'][first_part]))
        end = float(np.median(s10['height'][last_part]))
        clip = np.array([*swings, *revs, start, start - end])
    return np.column_stack([frame_block, np.repeat(clip[None], length, axis=0)])


def sign_motion_cues_features(frames, order, length=40):
    features = np.column_stack([sign_motion_joints_features(frames, order, length), hand_cue_features(frames, length)])
    assert features.shape == (length, len(CUES_CHANNELS)) == (length, 205)
    return features


# Experiment-local copy of SignSync/scripts/ix_poss_motion.augment_frames (that file is shared by
# other experiments and is not changed). Identical, including the random draws, except that the
# vertical arm/hand shift is 3x smaller (+-0.05 instead of +-0.15): the nose is not shifted, so the
# full shift blurred hand height above the nose, the main TOMORROW/TEN cue.
POSE_ARM_XY = [(12, 13), (16, 17), (20, 21), (24, 25)]  # elbows and wrists (x, y)


def augment_frames_mild_vertical(frames, rng):
    n = len(frames)
    raw = np.asarray([f['features'] for f in frames], dtype=float)
    time = np.asarray([f['timestamp'] for f in frames], dtype=float)
    valid = [bool(f['valid']) for f in frames]
    cut = int(n * .12)
    a = rng.integers(0, cut + 1) if cut else 0
    b = n - (rng.integers(0, cut + 1) if cut else 0)
    if b - a < 8:
        a, b = 0, n
    raw, time, valid = raw[a:b].copy(), time[a:b] - time[a], valid[a:b]
    span = max(time[-1], 1.)
    gamma = rng.uniform(.8, 1.25)
    time = (time / span) ** gamma * span * rng.uniform(.7, 1.4)
    time = np.maximum.accumulate(time + np.arange(len(time)) * 1e-6)
    shift = rng.uniform(-.15, .15, size=2)
    shift[1] /= 3
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
