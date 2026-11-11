import sys
import json
from pathlib import Path
from threading import Lock
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recognition import FEATURE_ORDER, Frame, SignRequest
from app.alphabet_recognition import AlphabetDiagnosticRecognizer, hand_features, select_alphabet_input, j_handshape_supported
from image_landmarks import static_features


def frames(moving=False):
    result = []
    for i in range(16):
        values = [0.] * 164
        values[7] = values[11] = values[36] = 1
        for joint in range(21):
            values[37 + joint * 3] = joint * .02 + (i * .02 if moving else 0)
            values[38 + joint * 3] = joint * .01
        result.append(Frame(timestamp=i * 50, features=values, valid=True))
    return result


class AlphabetRecognitionTests(unittest.TestCase):
    def test_extended_pinky_routes_learned_j_over_static_t_but_does_not_force_j(self):
        observations = frames(True)
        for f in observations:
            points = np.asarray(f.features[37:100]).reshape((21, 3))
            wrist = points[0].copy()
            for pip, tip in ((6, 8), (10, 12), (14, 16)):
                points[tip] = wrist + (points[pip] - wrist) * .7
            points[20] = wrist + (points[18] - wrist) * 1.4
            f.features[37:100] = points.ravel().tolist()
        self.assertTrue(j_handshape_supported(observations))
        recognizer = AlphabetDiagnosticRecognizer.__new__(AlphabetDiagnosticRecognizer)
        recognizer.labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        recognizer.mean, recognizer.std = np.zeros(128), np.ones(128)
        recognizer.lock = Lock()
        def infer(x):
            p = np.full((1, 26), .001)
            p[0, recognizer.labels.index('T' if x.shape[1] == 1 else 'J')] = .975
            return p
        recognizer.infer = infer
        result = recognizer.predict(SignRequest(requestId='j',featureOrder=FEATURE_ORDER,frames=observations))
        self.assertEqual(result['label'], 'J')
        self.assertTrue(result['accepted'])
        json.dumps(result, allow_nan=False)
        still = [f.model_copy(deep=True) for f in observations]
        for f in still: f.features = observations[0].features.copy()
        result = recognizer.predict(SignRequest(requestId='still',featureOrder=FEATURE_ORDER,frames=still))
        self.assertFalse(result['accepted'])
        self.assertEqual(result['label'], 'T')
        self.assertEqual(result['rejectionReason'], 'alphabet_input_mismatch')

    def test_hand_conversion_matches_training_and_is_scale_invariant(self):
        sample = frames()[0]
        points = np.asarray(sample.features[37:100]).reshape((21, 3))
        raw = dict(leftHand=[dict(zip('xyz', point)) for point in points], rightHand=None)
        np.testing.assert_allclose(hand_features([sample])[0], static_features(raw), atol=1e-12)
        scaled = sample.model_copy(deep=True)
        scaled.features[37:100] = (points * 3 + np.array([2, 4, 1])).ravel().tolist()
        np.testing.assert_allclose(hand_features([scaled]), hand_features([sample]), atol=1e-12)

    def test_static_and_temporal_routing_and_tracking_failure(self):
        kind, values, _ = select_alphabet_input(frames())
        self.assertEqual(kind, 'static')
        self.assertEqual(values.shape, (1, 128))
        kind, values, _ = select_alphabet_input(frames(True))
        self.assertEqual(kind, 'temporal')
        self.assertEqual(values.shape, (40, 128))
        broken = frames()
        broken[-1].features[36] = 0
        self.assertEqual(select_alphabet_input(broken)[0], 'unusable')
        self.assertEqual(select_alphabet_input(frames()[:8])[0], 'unusable')

    def test_jitter_and_an_intermittent_other_hand_keep_static_inference(self):
        observations = frames()
        for i, frame in enumerate(observations):
            shift = .10 if i == 8 else np.sin(i) * .015
            for joint in range(21):
                frame.features[37 + joint * 3] += shift
            if i in (3, 10, 15):
                frame.features[100] = 1
                frame.features[101:164] = frame.features[37:100]
        kind, values, _ = select_alphabet_input(observations)
        self.assertEqual(kind, 'static')
        self.assertEqual(values[0, 64], 0)

    def test_a_brief_dropout_and_low_frame_rate_do_not_require_a_perfect_window(self):
        observations = frames()
        observations[8].features[36] = 0
        self.assertEqual(select_alphabet_input(observations)[0], 'static')
        observations = frames()[::2]
        self.assertEqual(select_alphabet_input(observations)[0], 'static')

    def test_static_letters_are_not_vetoed_by_motion_but_static_jz_cannot_emit(self):
        recognizer = AlphabetDiagnosticRecognizer.__new__(AlphabetDiagnosticRecognizer)
        recognizer.labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        recognizer.mean, recognizer.std = np.zeros(128), np.ones(128)
        recognizer.lock = Lock()
        for moving, label, accepted in [(False, 'A', True), (False, 'J', False),
                                         (True, 'A', True), (True, 'Z', True)]:
            probabilities = np.full((1, 26), .001)
            probabilities[0, recognizer.labels.index(label)] = .975
            recognizer.infer = lambda features: probabilities
            request = SignRequest(requestId='alphabet', featureOrder=FEATURE_ORDER, frames=frames(moving))
            result = recognizer.predict(request)
            self.assertEqual(result['label'], label)
            self.assertEqual(result['accepted'], accepted)
            if not accepted:
                self.assertEqual(result['rejectionReason'], 'alphabet_input_mismatch')

    def test_confidence_rejections_explain_the_actual_gate(self):
        recognizer = AlphabetDiagnosticRecognizer.__new__(AlphabetDiagnosticRecognizer)
        recognizer.labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        recognizer.mean, recognizer.std = np.zeros(128), np.ones(128)
        recognizer.lock = Lock()
        probabilities = np.zeros((1, 26))
        probabilities[0, :2] = [.7, .3]
        recognizer.infer = lambda features: probabilities
        request = SignRequest(requestId='low-score', featureOrder=FEATURE_ORDER, frames=frames())
        result = recognizer.predict(request)
        self.assertEqual(result['rejectionReason'], 'alphabet_low_confidence')
        self.assertEqual(result['staticCandidate']['label'], 'A')

    def test_confident_static_letter_skips_temporal_inference(self):
        recognizer = AlphabetDiagnosticRecognizer.__new__(AlphabetDiagnosticRecognizer)
        recognizer.labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
        recognizer.mean, recognizer.std = np.zeros(128), np.ones(128)
        recognizer.lock = Lock()
        probabilities = np.full((1, 26), .001)
        probabilities[0, 0] = .975
        recognizer.infer = lambda features: probabilities
        result = recognizer.predict(SignRequest(requestId='other', featureOrder=FEATURE_ORDER, frames=frames(True)))
        self.assertEqual(result['label'], 'A')
        self.assertTrue(result['accepted'])
        self.assertEqual(result['inputKind'], 'static')


if __name__ == '__main__':
    unittest.main()
