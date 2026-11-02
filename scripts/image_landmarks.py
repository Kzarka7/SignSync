"""Collector-compatible coordinates and an explicit MediaPipe Tasks adapter."""
import math
import numpy as np

POSE = dict(nose=0, leftShoulder=11, rightShoulder=12, leftElbow=13,
            rightElbow=14, leftWrist=15, rightWrist=16, leftHip=23, rightHip=24)
HAND = ['wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip'] + [
    f'{finger}_{joint}' for finger in ('index', 'middle', 'ring', 'pinky')
    for joint in ('mcp', 'pip', 'dip', 'tip')]
ORDER = [f'pose.{name}.{axis}' for name in POSE for axis in ('x', 'y', 'z', 'visibility')]
for side in ('leftHand', 'rightHand'):
    ORDER += [side + '.present'] + [f'{side}.{name}.{a}' for name in HAND for a in 'xyz']
SCHEMA = dict(length=164, order=ORDER, normalization={
    'method': 'shoulder-centered, shoulder-width-scaled',
    'origin': 'midpoint of pose.leftShoulder and pose.rightShoulder',
    'scale': 'euclidean distance between pose.leftShoulder and pose.rightShoulder, in normalized image coordinates'})


def features(raw):
    """Port of normalize.ts: z is scaled, never translated; shoulder scale is 3D."""
    pose = raw['pose']
    if not pose:
        return [0.] * 164, False
    l, r = pose['leftShoulder'], pose['rightShoulder']
    scale = math.sqrt(sum((l[a] - r[a]) ** 2 for a in 'xyz'))
    if not math.isfinite(scale) or scale < .02:
        return [0.] * 164, False
    ox, oy = (l['x'] + r['x']) / 2, (l['y'] + r['y']) / 2
    def xyz(p):
        return [(p['x'] - ox) / scale, (p['y'] - oy) / scale, p['z'] / scale]
    out = []
    for name in POSE:
        out += xyz(pose[name]) + [pose[name].get('visibility', 0)]
    for side in ('leftHand', 'rightHand'):
        hand = raw[side]
        out += [int(bool(hand))]
        out += [v for p in hand for v in xyz(p)] if hand else [0.] * 63
    return out, True


def static_features(raw):
    """128 channels: per-side presence + 21 wrist-relative, palm-scaled xyz points.

    Independent of pose detection; preserves orientation but loses body location.
    """
    out = []
    for side in ('leftHand', 'rightHand'):
        hand = raw[side]
        if hand:
            points = np.asarray([[p[a] for a in 'xyz'] for p in hand])
            scale = np.linalg.norm(points[9] - points[0])
        else:
            scale = 0
        out += [1., *((points - points[0]) / scale).ravel().tolist()] if scale > 1e-6 else [0.] * 64
    return out


class MediaPipeExtractor:
    def __init__(self, settings, video=False):
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        self.mp, self.video = mp, video
        mode = vision.RunningMode.VIDEO if video else vision.RunningMode.IMAGE
        self.hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=settings['hand_model']),
            running_mode=mode, num_hands=2, min_hand_detection_confidence=.5,
            min_hand_presence_confidence=.4, min_tracking_confidence=.4))
        try:
            self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
                base_options=python.BaseOptions(model_asset_path=settings['pose_model']),
                running_mode=mode, num_poses=1, min_pose_detection_confidence=.5,
                min_pose_presence_confidence=.5, min_tracking_confidence=.5))
        except Exception:
            self.hands.close()
            raise

    def detect(self, image, timestamp=None):
        img = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.asarray(image))
        if self.video:
            h = self.hands.detect_for_video(img, int(timestamp))
            p = self.pose.detect_for_video(img, int(timestamp))
        else:
            h, p = self.hands.detect(img), self.pose.detect(img)
        def point(p):
            d = dict(x=float(p.x), y=float(p.y), z=float(p.z))
            if getattr(p, 'visibility', None) is not None:
                d['visibility'] = float(p.visibility)
            return d
        raw = dict(timestamp=timestamp, leftHand=None, rightHand=None, pose=None)
        if p.pose_landmarks:
            raw['pose'] = {name: point(p.pose_landmarks[0][i]) for name, i in POSE.items()}
        scores, categories = {}, []
        for hand, cats in zip(h.hand_landmarks, h.handedness):
            if not cats:
                continue
            c = cats[0]
            categories.append(dict(label=c.category_name, score=float(c.score)))
            side = c.category_name.lower() + 'Hand'
            if side in raw and c.score > scores.get(side, -1):
                scores[side] = c.score
                raw[side] = [point(p) for p in hand]
        raw['handedness'] = categories
        return raw

    def close(self):
        self.hands.close()
        self.pose.close()
