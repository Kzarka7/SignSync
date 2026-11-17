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
from app.recognition import FEATURE_ORDER, GraphP4DiagnosticRecognizer
from app.alphabet_recognition import AlphabetDiagnosticRecognizer
from app.stage2_recognition import Stage2DiagnosticRecognizer
from shape_motion_sequence import raw_shape_motion_features


class DiagnosticRecognitionTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
