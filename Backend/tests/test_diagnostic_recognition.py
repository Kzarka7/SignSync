import sys
import unittest
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app
from app.recognition import (FEATURE_ORDER, HAND_SWAPPED_TRAINING, GraphP4DiagnosticRecognizer, SignRequest,
                             V5Recognizer, swap_hand_slots)
from app.alphabet_recognition import AlphabetDiagnosticRecognizer
from app.stage2_recognition import Stage2DiagnosticRecognizer
from shape_motion_sequence import raw_shape_motion_features


class DiagnosticRecognitionTests(unittest.TestCase):
    def test_standalone_no_hands_returns_idle_without_inference(self):
        graph = GraphP4DiagnosticRecognizer.__new__(GraphP4DiagnosticRecognizer)
        graph.idle_without_hands = True
        request = SignRequest.model_validate({
            "requestId": "empty-hands", "featureOrder": FEATURE_ORDER,
            "frames": [{"timestamp": 50 * i, "features": [0.0] * 164, "valid": True}
                       for i in range(12)],
        })
        with patch.object(V5Recognizer, 'predict') as classify:
            result = graph.predict(request)
        classify.assert_not_called()
        self.assertEqual(result['label'], 'IDLE')
        self.assertEqual(result['rejectionReason'], 'no_hands_idle_rule')
        self.assertFalse(result['accepted'])
        self.assertEqual(result['top3'], [])

    def test_uniform_live_grid_keeps_real_pose_samples_beside_invalid_steps(self):
        valid = np.arange(40) % 3 != 0
        frames = [
            {"timestamp": 2501 - (39 - i) * 1000 / 30,
             "features": [0.1 + i / 40] + [0.] * 163, "valid": bool(valid[i])}
            for i in range(40)
        ]
        raw = raw_shape_motion_features({"frames": frames}, FEATURE_ORDER, 40)
        self.assertEqual(raw.shape, (40, 238))
        np.testing.assert_allclose(raw[:, 0], np.where(valid, .1 + np.arange(40) / 40, 0))

    def test_lab_models_route_to_the_selected_diagnostic_checkpoint(self):
        for mode in ('lab-grouped', 'lab-clip', 'lab-alphabet', 'lab-stage2', 'lab-signs38',
                     'lab-signs38-clip', 'lab-signs33', 'lab-signs43-numbers', 'lab-signs43-shape-motion',
                     'lab-signs43-similarity', 'lab-signs43-similarity-v2', 'lab-signs32-similarity'):
            recognizer_id = {'lab-alphabet': AlphabetDiagnosticRecognizer.model_id,
                             'lab-stage2': Stage2DiagnosticRecognizer.model_id}.get(mode, mode + '-seed42-graph-diagnostics')
            members = [(f'seed{s}',) for s in (42, 43, 44)] if mode == 'lab-stage2' else [('seed42',)]
            supports_short_preview = mode in ('lab-signs43-shape-motion', 'lab-signs43-similarity',
                                              'lab-signs43-similarity-v2', 'lab-signs32-similarity')
            recognizer = SimpleNamespace(members=members, model_id=recognizer_id, supports_short_preview=supports_short_preview)
            with patch('app.ws.translate.get_diagnostic_recognizer', return_value=recognizer) as load, TestClient(app) as client:
                with client.websocket_connect('/ws/translate?model=' + mode + '&diagnostics=1') as socket:
                    self.assertEqual(socket.receive_json()['payload']['state'], 'loading')
                    ready = socket.receive_json()['payload']
                    self.assertEqual(ready['model'], mode)
                    self.assertEqual(ready['recognizerId'], recognizer.model_id)
                    self.assertEqual(ready['execution'], 'graph')
                    self.assertEqual(ready['runs'], [member[0] for member in members])
                    self.assertEqual(ready.get('supportsShortPreview', False), supports_short_preview)
                load.assert_called_once_with(mode)
                with client.websocket_connect('/ws/translate?model=' + mode) as socket:
                    self.assertEqual(socket.receive_json()['type'], 'error')
                load.assert_called_once_with(mode)

    def test_graph_wrapper_shares_weights_scalers_and_lock(self):
        calls = []
        def model(features, training=False):
            calls.append(training)
            return np.array([[.2, .8]], dtype=np.float32)
        candidate = SimpleNamespace(labels=['REST', 'YES'], lock=Lock(),
                                    members=[('same-checkpoint', model, 'same-mean', 'same-std')])
        fake_tf = SimpleNamespace(function=lambda fn, **kwargs: fn,
                                  TensorSpec=lambda *args: None, float32=np.float32,
                                  convert_to_tensor=lambda x, dtype: np.asarray(x, dtype=dtype))
        with patch.dict(sys.modules, {'tensorflow': fake_tf}):
            graph = GraphP4DiagnosticRecognizer(candidate)
            output = graph.members[0][1](np.zeros((1, 40, 238)))
        self.assertIs(graph.lock, candidate.lock)
        self.assertIs(graph.labels, candidate.labels)
        self.assertEqual(graph.members[0][0], 'same-checkpoint')
        self.assertEqual(graph.members[0][2:], ('same-mean', 'same-std'))
        self.assertTrue(all(call is False for call in calls))
        np.testing.assert_allclose(output, [[.2, .8]])

    def test_graph_mismatch_fails_loading(self):
        candidate = SimpleNamespace(labels=['REST', 'YES'], lock=Lock(),
                                    members=[('checkpoint', lambda x, training=False: np.array([[.2, .8]]), None, None)])
        fake_tf = SimpleNamespace(function=lambda fn, **kwargs: lambda x: np.array([[.8, .2]]),
                                  TensorSpec=lambda *args: None, float32=np.float32,
                                  convert_to_tensor=lambda x, dtype: x)
        with patch.dict(sys.modules, {'tensorflow': fake_tf}), self.assertRaises(AssertionError):
            GraphP4DiagnosticRecognizer(candidate)

    def test_socket_diagnostics_are_explicit_and_do_not_route_v5(self):
        recognizer = SimpleNamespace(members=[('same-checkpoint',)], model_id=GraphP4DiagnosticRecognizer.model_id)
        with patch('app.ws.translate.get_diagnostic_recognizer', return_value=recognizer) as graph, \
             patch('app.ws.translate.get_recognizer', return_value=recognizer) as default, TestClient(app) as client:
            with client.websocket_connect('/ws/translate?model=p4-candidate&diagnostics=1') as socket:
                self.assertEqual(socket.receive_json()['payload']['state'], 'loading')
                ready = socket.receive_json()['payload']
                self.assertEqual(ready['state'], 'ready')
                self.assertEqual(ready['diagnosticsProtocol'], 1)
                self.assertEqual(ready['execution'], 'graph')
                self.assertEqual(ready['recognizerId'], GraphP4DiagnosticRecognizer.model_id)
            graph.assert_called_once()
            default.assert_not_called()
            with client.websocket_connect('/ws/translate?model=v5&diagnostics=1') as socket:
                self.assertEqual(socket.receive_json()['type'], 'error')
            graph.assert_called_once()
            default.assert_not_called()


class HandSlotConventionTests(unittest.TestCase):
    """Models trained on Collector video imports (swapHandSides) need swapped inference input."""

    @staticmethod
    def frame(i):
        features = [0.0] * 164
        features[36], features[37] = 1.0, 0.25    # leftHand.present, leftHand.wrist.x
        features[100], features[101] = 0.0, 0.0   # rightHand absent
        return {"timestamp": 50 * i, "features": features, "valid": True}

    def run_predict(self, swap):
        seen = {}
        recognizer = V5Recognizer.__new__(V5Recognizer)
        recognizer.swap_hand_slots = swap
        recognizer.lock = Lock()
        recognizer.labels = ['A', 'B']
        recognizer.members = [('m', lambda x, training=False: np.array([[.9, .1]], dtype=np.float32),
                               np.zeros((1, 1, 238)), np.ones((1, 1, 238)))]
        def raw(sequence, order, length):
            seen['frames'] = sequence['frames']
            return np.zeros((40, 238))
        recognizer.raw_features = raw
        request = SignRequest.model_validate({"requestId": "r", "featureOrder": FEATURE_ORDER,
                                              "frames": [self.frame(i) for i in range(12)]})
        recognizer.predict(request)
        return seen['frames'][0]['features']

    def test_swap_moves_whole_hand_blocks(self):
        frame = self.frame(0)
        swapped = swap_hand_slots(frame)['features']
        self.assertEqual(swapped[:36], frame['features'][:36])
        self.assertEqual(swapped[100:164], frame['features'][36:100])
        self.assertEqual(swapped[36:100], frame['features'][100:164])
        self.assertEqual(swap_hand_slots(swap_hand_slots(frame))['features'], frame['features'])

    def test_predict_swaps_only_when_flagged(self):
        unswapped, swapped = self.run_predict(False), self.run_predict(True)
        self.assertEqual((unswapped[36], unswapped[100]), (1.0, 0.0))
        self.assertEqual((swapped[36], swapped[100], swapped[101]), (0.0, 1.0, .25))

    def test_only_mostly_swapped_training_sets_are_flagged(self):
        self.assertEqual(HAND_SWAPPED_TRAINING, {'lab-signs32-standalone', 'lab-signs32-similarity'})

    def test_combined_model_uses_live_hand_order(self):
        # Its training clips were rebuilt in the live order, so no inference swap.
        from app.recognition import LAB_EXPERIMENTS
        self.assertEqual(LAB_EXPERIMENTS['lab-signs74-combined'], 'samples_74_signs_combined_v3')
        self.assertNotIn('lab-signs74-combined', HAND_SWAPPED_TRAINING)


if __name__ == '__main__':
    unittest.main()
