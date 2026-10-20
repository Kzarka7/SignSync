import json
import os
from pathlib import Path
from threading import Lock
import sys
import unittest
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.recognition import (FEATURE_ORDER, EXPERIMENTS, REPO, SignRequest, V5Recognizer,
                             P4CandidateRecognizer, get_recognizer, raw_geometry_features,
                             standardize_for_model, validate_capture)
from app.main import app


def capture():
    vector = [0.] * 164
    vector[36] = 1
    return {"requestId": "test-sign", "featureOrder": FEATURE_ORDER,
            "frames": [{"timestamp": i * 100, "features": vector.copy(), "valid": True} for i in range(12)]}


class CaptureTests(unittest.TestCase):
    def test_accepts_complete_capture(self):
        validate_capture(SignRequest.model_validate(capture()))

    def test_rejects_idle_and_missing_pose(self):
        for field in ("hands", "pose"):
            data = capture()
            for frame in data["frames"]:
                if field == "hands":
                    frame["features"][36] = 0
                else:
                    frame["valid"] = False
            with self.assertRaisesRegex(ValueError, "visible"):
                validate_capture(SignRequest.model_validate(data))

    def test_rejects_schema_and_timestamps(self):
        data = capture()
        data["featureOrder"] = list(reversed(FEATURE_ORDER))
        with self.assertRaisesRegex(ValueError, "schema"):
            validate_capture(SignRequest.model_validate(data))
        data = capture()
        data["frames"][4]["timestamp"] = 0
        with self.assertRaisesRegex(ValueError, "complete sign"):
            validate_capture(SignRequest.model_validate(data))

    def test_rejects_nonfinite_and_oversized_input(self):
        data = capture()
        data["frames"][0]["features"][0] = float("nan")
        with self.assertRaises(ValidationError):
            SignRequest.model_validate(data)
        data = capture()
        data["frames"] *= 21
        with self.assertRaises(ValidationError):
            SignRequest.model_validate(data)


class AcceptanceTests(unittest.TestCase):
    def test_live_acceptance_confidence_boundary(self):
        recognizer = V5Recognizer.__new__(V5Recognizer)
        recognizer.lock = Lock()
        recognizer.labels = [f"SIGN_{i}" for i in range(20)]
        request = SignRequest.model_validate(capture())
        for score, accepted in ((.6299, False), (.63, True), (.65, True), (.8, True)):
            with self.subTest(score=score):
                probabilities = np.array([[score, 1 - score] + [0.] * 18])
                recognizer.members = [("test", lambda x, training: probabilities, None, None)]
                with patch("app.recognition.raw_geometry_features", return_value=np.zeros((40, 238))), \
                     patch("app.recognition.standardize_for_model", side_effect=lambda raw, mean, std: raw):
                    result = recognizer.predict(request)
                self.assertEqual(result["accepted"], accepted)
                self.assertEqual(result["label"], "SIGN_0")


class CandidateTests(unittest.TestCase):
    def test_candidate_allows_no_hands_but_requires_pose(self):
        data = capture()
        for frame in data['frames']:
            frame['features'][36] = 0
        validate_capture(SignRequest.model_validate(data), allow_no_hands=True)
        for frame in data['frames']:
            frame['valid'] = False
        with self.assertRaises(ValueError):
            validate_capture(SignRequest.model_validate(data), allow_no_hands=True)

    def test_rest_and_idle_are_never_accepted_as_signs(self):
        recognizer = P4CandidateRecognizer.__new__(P4CandidateRecognizer)
        recognizer.lock = Lock()
        recognizer.labels = ['REST', 'IDLE_MOVEMENT'] + [f'SIGN_{i}' for i in range(20)]
        for top in (0, 1, 2):
            prob = np.zeros((1, 22)); prob[0, top] = 1
            recognizer.members = [('test', lambda x, training: prob, None, None)]
            with patch('app.recognition.raw_geometry_features', return_value=np.zeros((40, 238))), patch('app.recognition.standardize_for_model', side_effect=lambda raw, mean, std: raw):
                result = recognizer.predict(SignRequest.model_validate(capture()))
            self.assertEqual(result['accepted'], top == 2)
            self.assertEqual(result['model'], P4CandidateRecognizer.model_id)

    def test_candidate_visibility_gate_preserves_non_sign_results(self):
        recognizer = P4CandidateRecognizer.__new__(P4CandidateRecognizer)
        recognizer.lock = Lock()
        recognizer.labels = ['REST', 'IDLE_MOVEMENT', 'WHAT']
        for label_index in (0, 1, 2):
            for hand_index in (36, 100):
                for visible_frames in (0, 5, 6, 12):
                    with self.subTest(label=label_index, hand=hand_index, visible=visible_frames):
                        data = capture()
                        for i, frame in enumerate(data['frames']):
                            frame['features'][36] = 0
                            frame['features'][hand_index] = int(i < visible_frames)
                        prob = np.zeros((1, 3)); prob[0, label_index] = 1
                        recognizer.members = [('test', lambda x, training: prob, None, None)]
                        with patch('app.recognition.raw_geometry_features', return_value=np.zeros((40, 238))), patch('app.recognition.standardize_for_model', side_effect=lambda raw, mean, std: raw):
                            result = recognizer.predict(SignRequest.model_validate(data))
                        self.assertEqual(result['label'], recognizer.labels[label_index])
                        self.assertEqual(result['accepted'], label_index == 2 and visible_frames >= 6)
                        self.assertEqual(result.get('rejectionReason'), 'insufficient_hand_visibility' if label_index == 2 and visible_frames < 6 else None)

    def test_invalid_frames_do_not_count_as_visible_hands(self):
        data = capture()
        for i, frame in enumerate(data['frames']):
            frame['features'][36] = int(i < 6)
        data['frames'][0]['valid'] = False
        recognizer = P4CandidateRecognizer.__new__(P4CandidateRecognizer)
        with patch.object(V5Recognizer, 'predict', return_value={'label': 'WHAT', 'accepted': True}):
            result = recognizer.predict(SignRequest.model_validate(data))
        self.assertFalse(result['accepted'])
        self.assertEqual(result['rejectionReason'], 'insufficient_hand_visibility')

    def test_socket_routes_candidate_and_rejects_unknown_mode(self):
        class Recognizer:
            members = [('candidate',)]
        with patch('app.ws.translate.get_recognizer', return_value=Recognizer()) as loader, TestClient(app) as client:
            for query, expected in (('', 'v5'), ('?model=p4-candidate', 'p4-candidate')):
                with client.websocket_connect('/ws/translate' + query) as socket:
                    socket.receive_json()
                    self.assertEqual(socket.receive_json()['payload']['model'], expected)
                    loader.assert_called_with(expected)
            loader.reset_mock()
            with client.websocket_connect('/ws/translate?model=unknown') as socket:
                self.assertEqual(socket.receive_json()['type'], 'error')
            loader.assert_not_called()


class SocketTests(unittest.TestCase):
    def test_prediction_duplicate_and_bad_input(self):
        class Recognizer:
            members = [("test",)]
            calls = 0

            def predict(self, request):
                validate_capture(request)
                self.calls += 1
                return {"requestId": request.requestId, "label": "HELLO"}

        recognizer = Recognizer()
        with patch("app.ws.translate.get_recognizer", return_value=recognizer), TestClient(app) as client:
            with client.websocket_connect("/ws/translate") as socket:
                self.assertEqual(socket.receive_json()["payload"]["state"], "loading")
                self.assertEqual(socket.receive_json()["payload"]["state"], "ready")
                socket.send_text("[]")
                self.assertEqual(socket.receive_json()["type"], "error")
                socket.send_json({"type": "sign", "payload": capture()})
                self.assertEqual(socket.receive_json()["type"], "prediction")
                socket.send_json({"type": "sign", "payload": capture()})
                self.assertIn("already", socket.receive_json()["payload"]["message"])
                self.assertEqual(recognizer.calls, 1)

    def test_missing_artifacts_reports_error(self):
        with patch("app.ws.translate.get_recognizer", side_effect=FileNotFoundError("missing")), TestClient(app) as client:
            with client.websocket_connect("/ws/translate") as socket:
                socket.receive_json()
                self.assertIn("unavailable", socket.receive_json()["payload"]["message"])


@unittest.skipUnless(os.environ.get("SIGNSYNC_TEST_ARTIFACTS") == "1", "Requires local v5 dataset and models")
class ArtifactTests(unittest.TestCase):
    def test_p4_candidate_scalers_and_real_predictions(self):
        root = REPO.parent / 'SignSync Dataset'
        release = root / 'experiments' / 'sign_rest_idle_p4_signs_v1_2026_10_18'
        recognizer = get_recognizer('p4-candidate')
        self.assertEqual(len(recognizer.members), 9)
        requests = []
        for folder in sorted((release / 'folds').iterdir()):
            meta = json.loads((folder / 'metadata.json').read_text())
            source = json.loads((release / 'datasets' / (meta['testParticipant'] + '-sign-rest-idle-v1.json')).read_text())
            seqs = {seq['id']: seq for seq in source['sequences']}
            labels = sorted(meta['labelToIndex'], key=meta['labelToIndex'].get)
            with np.load(folder / 'gru_data.npz', allow_pickle=False) as data:
                for label in ('HELLO', 'REST', 'IDLE_MOVEMENT'):
                    i = int(np.flatnonzero(data['y_test'] == labels.index(label))[0])
                    seq = seqs[meta['sequenceIds']['test'][i]]
                    raw = raw_geometry_features(seq, FEATURE_ORDER, 40)[None, ...]
                    rebuilt = standardize_for_model(raw, data['feature_mean'], data['feature_std'])
                    np.testing.assert_allclose(rebuilt[0], data['X_test'][i], atol=2e-4, rtol=2e-5)
                    if len(requests) < 3:
                        requests.append(SignRequest.model_validate(dict(requestId=seq['id'], featureOrder=FEATURE_ORDER, frames=seq['frames'])))
        with TestClient(app) as client, client.websocket_connect('/ws/translate?model=p4-candidate') as socket:
            socket.receive_json()
            self.assertEqual(socket.receive_json()['payload']['model'], 'p4-candidate')
            for request in requests:
                socket.send_json({'type': 'sign', 'payload': request.model_dump()})
                event = socket.receive_json()
                self.assertEqual(event['type'], 'prediction', event)
                self.assertEqual(event['payload']['model'], recognizer.model_id)
                if event['payload']['label'] in ('REST', 'IDLE_MOVEMENT'):
                    self.assertFalse(event['payload']['accepted'])
                print('Real candidate socket result:', event['payload'], flush=True)

    def test_saved_tensor_parity_and_real_socket(self):
        root = REPO.parent / "SignSync Dataset"
        valid_sequence = None
        for experiment in EXPERIMENTS:
            folder = root / "processed" / experiment
            meta = json.loads((folder / "metadata.json").read_text())
            source = json.loads((root / "processed" / f"{meta['testParticipant']}-dataset-v5.json").read_text())
            self.assertEqual(source["featureSchema"]["order"], FEATURE_ORDER)
            sequences = {s["id"]: s for s in source["sequences"]}
            with np.load(folder / "gru_data.npz", allow_pickle=False) as arrays:
                expected = arrays["X_test"]
                mean, std = arrays["feature_mean"], arrays["feature_std"]
                for i, sid in enumerate(meta["sequenceIds"]["test"]):
                    seq = sequences[sid]
                    raw = raw_geometry_features(seq, FEATURE_ORDER, 40)[None, ...]
                    rebuilt = standardize_for_model(raw, mean, std)
                    # Training standardized with float64 statistics, then saved
                    # those statistics as float32. Visibility's tiny std amplifies
                    # that rounding. Measured worst case over all 1,200: 7.44e-5.
                    np.testing.assert_allclose(rebuilt[0], expected[i], atol=8e-5, rtol=1e-6)
                    if valid_sequence is None:
                        try:
                            req = SignRequest.model_validate({"requestId": sid, "featureOrder": FEATURE_ORDER, "frames": seq["frames"]})
                            validate_capture(req)
                            valid_sequence = req
                        except ValueError:
                            pass
        self.assertIsNotNone(valid_sequence)
        recognizer = get_recognizer()
        self.assertEqual(len(recognizer.members), 9)
        with TestClient(app) as client, client.websocket_connect("/ws/translate") as socket:
            socket.receive_json()
            self.assertEqual(socket.receive_json()["payload"]["state"], "ready")
            socket.send_json({"type": "sign", "payload": valid_sequence.model_dump()})
            event = socket.receive_json()
            self.assertEqual(event["type"], "prediction")
            self.assertIn(event["payload"]["label"], recognizer.labels)
            self.assertGreater(event["payload"]["score"], 0)
            print("Real v5 socket result:", event["payload"], flush=True)


if __name__ == "__main__":
    unittest.main()
