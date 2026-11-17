import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recognition import FEATURE_ORDER, SignRequest
from app.stage2_recognition import Stage2DiagnosticRecognizer


def capture(hold=True, timestamps=range(0, 825, 33)):
    frames = []
    for i, timestamp in enumerate(timestamps):
        x = np.zeros(164)
        x[[7, 11, 36]] = 1
        wrist = min(i, 10) if hold else i
        x[37:100:3] = wrist * .03 + np.arange(21) * .01
        frames.append(dict(timestamp=timestamp, features=x.tolist(), valid=True))
    return SignRequest(requestId='sample', featureOrder=FEATURE_ORDER, frames=frames)


class Stage2RoutingTests(unittest.TestCase):
    def recognizer(self, joint):
        lab = Stage2DiagnosticRecognizer.__new__(Stage2DiagnosticRecognizer)
        lab.labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN'.split()
        def probabilities(shape, motion=None):
            q = np.zeros(36)
            q[lab.labels.index(joint if motion is not None else 'E')] = .98
            q[0] = .02
            return q
        lab._probabilities = probabilities
        return lab

    def test_settled_handshape_wins_over_joint_static_number(self):
        result = self.recognizer('EIGHT').predict(capture())
        self.assertEqual(result['label'], 'E')
        self.assertTrue(result['accepted'])
        self.assertEqual(result['inputKind'], 'static')

    def test_static_hold_accepts_at_replay_and_camera_cadences(self):
        lab = self.recognizer('EIGHT')
        for timestamps in (range(0, 1501, 50), [*range(0, 1200, 90), 1200, 1310, 1395, 1510]):
            with self.subTest(timestamps=timestamps):
                result = lab.predict(capture(timestamps=timestamps))
                self.assertTrue(result['accepted'])
                self.assertEqual(result['inputReason'], 'recent_handshape_only')

    def test_static_prediction_rejects_when_only_the_old_window_has_a_hand(self):
        request = capture(timestamps=range(0, 1501, 50))
        for frame in request.frames[-6:]:
            frame.features[36] = 0
        result = self.recognizer('EIGHT').predict(request)
        self.assertFalse(result['accepted'])
        self.assertEqual(result['rejectionReason'], 'insufficient_hand_visibility')

    def test_motion_path_can_confirm_ten_and_moving_handshape_can_confirm_e(self):
        result = self.recognizer('TEN').predict(capture(False))
        self.assertEqual(result['label'], 'TEN')
        self.assertTrue(result['accepted'])
        self.assertEqual(result['inputKind'], 'joint')
        result = self.recognizer('EIGHT').predict(capture(False))
        self.assertTrue(result['accepted'])
        self.assertEqual(result['label'], 'E')
        self.assertEqual(result['inputKind'], 'static')
