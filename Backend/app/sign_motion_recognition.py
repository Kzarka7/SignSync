"""Recognition Lab: 32 Signs standalone v5 retrained on sign-motion-v1 features with augmentation.

Same 32 labels and 2,142 clips as standalone v5. Features come from
scripts/sign_motion_features.py, a byte-identical copy of the module used for
training; the model refuses to load if it differs (SHA-256 in metadata.json).
Training clips are mostly swapped Collector video imports (68%, as for plain
v5), so live frames are swapped first.

The saved validation threshold is 0.00 (validation was nearly perfect, so the
tie-break chose the lowest value), which is not usable live. The Lab uses 0.52,
plain v5's threshold; on the 321 v5 test clips it rejects one correct
prediction and no mistakes. See SignSync Dataset/experiments/
samples_32_signs_standalone_v5_motion/REPORT.md.
"""
import hashlib
import json
from pathlib import Path
from threading import Lock
from time import perf_counter

import numpy as np

import sign_motion_features
from sign_motion_features import CHANNELS, VARIANT, sign_motion_features as motion_features
from app.ix_poss_recognition import hands_visible
from app.recognition import FEATURE_ORDER, SignRequest, swap_hand_slots, validate_capture

MODEL_GROUP = 'samples_32_signs_standalone_v5_motion'
MODEL_NAME = 'samples_32_signs_standalone_v5_motion_seed42'
LABELS = ['AGAIN', 'BAD', 'CORRECT', 'DAY', 'DEAF', 'DONT_UNDERSTAND', 'DRINK', 'EAT', 'FAST', 'FATHER', 'FINE',
          'GOOD', 'GRANDFATHER', 'GRANDMOTHER', 'HAPPY', 'MAYBE', 'MONEY', 'MOTHER', 'PARENTS', 'PERSON', 'ROOM',
          'SAD', 'SCHOOL', 'SICK', 'SLOW', 'STUDENT', 'TEACHER', 'TIRED', 'UNDERSTAND', 'WATER', 'WEEK', 'WRONG']
LAB_ACCEPTANCE_THRESHOLD = .52


class SignMotionV5Recognizer:
    model_id = 'lab-signs32-standalone-v5-motion-seed42-graph-diagnostics'
    supports_short_preview = True
    swap_hand_slots = True
    idle_without_hands = True
    margin_threshold = 0.

    def __init__(self, dataset_root: Path):
        import tensorflow as tf
        folder = dataset_root / 'models' / 'candidates' / MODEL_GROUP / MODEL_NAME
        checksums = json.loads((folder / 'artifact_checksums.json').read_text(encoding='utf-8'))
        for filename in ('best_model.keras', 'scalers.npz', 'metadata.json', 'labels.json'):
            if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != checksums[filename]:
                raise ValueError('v5 motion artifact checksum mismatch: ' + filename)
        metadata = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
        module_sha = hashlib.sha256(Path(sign_motion_features.__file__).read_bytes()).hexdigest()
        if (metadata['featureVariant'] != VARIANT or metadata['featureChannels'] != CHANNELS
                or metadata['sequenceLength'] != 40 or metadata['labels'] != LABELS
                or metadata['labelToIndex'] != {label: i for i, label in enumerate(LABELS)}
                or json.loads((folder / 'labels.json').read_bytes()) != metadata['labelToIndex']
                or metadata['featureModuleSha256'] != module_sha):
            raise ValueError('v5 motion metadata or feature code mismatch.')
        with np.load(folder / 'scalers.npz', allow_pickle=False) as arrays:
            self.mean, self.std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
        width = len(CHANNELS)
        if (self.mean.shape != (width,) or self.std.shape != (width,) or not np.isfinite(self.mean).all()
                or not np.isfinite(self.std).all() or np.any(self.std <= 0)):
            raise ValueError('Invalid v5 motion scalers.')
        model = tf.keras.models.load_model(folder / 'best_model.keras', compile=False)
        if tuple(model.input_shape[1:]) != (40, width) or model.output_shape[-1] != len(LABELS):
            raise ValueError('v5 motion checkpoint shape mismatch.')
        self.infer = tf.function(lambda features: model(features, training=False),
                                 input_signature=[tf.TensorSpec((1, 40, width), tf.float32)], autograph=False)
        probe = np.zeros((1, 40, width), dtype=np.float32)
        np.testing.assert_allclose(np.asarray(self.infer(probe)), np.asarray(model(probe, training=False)),
                                   rtol=1e-4, atol=1e-5)
        self.labels = LABELS
        self.confidence_threshold = LAB_ACCEPTANCE_THRESHOLD
        self.lock = Lock()
        self.members = [(MODEL_NAME, model, self.mean, self.std)]

    def _base(self, request: SignRequest) -> dict:
        return {'requestId': request.requestId, 'frameCount': len(request.frames), 'model': self.model_id}

    def featurize(self, frames: list) -> np.ndarray:
        """Training feature transform; subclasses with another feature module override this."""
        return motion_features(frames, FEATURE_ORDER)

    def predict(self, request: SignRequest) -> dict:
        validate_capture(request, allow_no_hands=True, supports_short_preview=self.supports_short_preview)
        started = perf_counter()
        visible = hands_visible(request.frames)
        if visible == 0:
            return {**self._base(request), 'label': 'IDLE', 'score': 1.0, 'accepted': False, 'inferenceMs': 0,
                    'top3': [], 'rejectionReason': 'no_hands_idle_rule'}
        frames = [frame.model_dump() for frame in request.frames]
        if self.swap_hand_slots:
            frames = [swap_hand_slots(frame) for frame in frames]
        try:
            features = self.featurize(frames)
        except ValueError:
            return {**self._base(request), 'label': 'UNKNOWN', 'score': 0., 'accepted': False, 'inferenceMs': 0,
                    'top3': [], 'rejectionReason': 'insufficient_hand_visibility'}
        standardized = ((features - self.mean) / self.std).astype(np.float32)[None]
        with self.lock:
            probabilities = np.asarray(self.infer(standardized))[0]
        if (probabilities.shape != (len(self.labels),) or not np.isfinite(probabilities).all()
                or not np.isclose(probabilities.sum(), 1, atol=1e-5)):
            raise ValueError('Model returned invalid probabilities.')
        ranked = np.argsort(probabilities)[::-1]
        score = float(probabilities[ranked[0]])
        result = {**self._base(request), 'label': self.labels[ranked[0]], 'score': score,
                  'accepted': score >= self.confidence_threshold,
                  'inferenceMs': round((perf_counter() - started) * 1000),
                  'top3': [{'label': self.labels[i], 'score': float(probabilities[i])} for i in ranked[:3]]}
        if visible < .5:
            result['accepted'] = False
            result['rejectionReason'] = 'insufficient_hand_visibility'
        return result
