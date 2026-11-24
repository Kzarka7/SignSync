"""Recognition Lab: indexing + possessives model on ix-poss-motion-v1 features.

Twelve labels (IX-1 .. IX-3pl, POSS-1 .. POSS-3pl). Features come from
scripts/ix_poss_motion.py, the same module used for training; the model
refuses to load if that module changed since training. Training clips use the
Collector video-import hand-slot order, so live frames are swapped first.
"""
import hashlib
import json
from pathlib import Path
from threading import Lock
from time import perf_counter

import numpy as np

import ix_poss_motion
from ix_poss_motion import CHANNELS, VARIANT, motion_features
from app.recognition import FEATURE_ORDER, SignRequest, swap_hand_slots, validate_capture

MODEL_GROUP = 'samples_12_signs_ix_poss_motion_v1'
MODEL_NAME = 'ix_poss_motion_v1_all_rounds_seed42'
LABELS = ['IX-1', 'IX-1pl', 'IX-2', 'IX-2pl', 'IX-3', 'IX-3pl',
          'POSS-1', 'POSS-1pl', 'POSS-2', 'POSS-2pl', 'POSS-3', 'POSS-3pl']


def hands_visible(frames) -> float:
    return sum(frame.valid and (frame.features[36] == 1 or frame.features[100] == 1) for frame in frames) / len(frames)


class IxPossMotionRecognizer:
    model_id = 'lab-ix-poss-motion-seed42-graph-diagnostics'
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
                raise ValueError('IX/POSS artifact checksum mismatch: ' + filename)
        metadata = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
        module_sha = hashlib.sha256(Path(ix_poss_motion.__file__).read_bytes()).hexdigest()
        if (metadata['featureVariant'] != VARIANT or metadata['featureChannels'] != CHANNELS
                or metadata['sequenceLength'] != 40 or metadata['labels'] != LABELS
                or metadata['labelToIndex'] != {label: i for i, label in enumerate(LABELS)}
                or json.loads((folder / 'labels.json').read_bytes()) != metadata['labelToIndex']
                or metadata['featureModuleSha256'] != module_sha):
            raise ValueError('IX/POSS metadata or feature code mismatch.')
        with np.load(folder / 'scalers.npz', allow_pickle=False) as arrays:
            self.mean, self.std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
        width = len(CHANNELS)
        if (self.mean.shape != (width,) or self.std.shape != (width,) or not np.isfinite(self.mean).all()
                or not np.isfinite(self.std).all() or np.any(self.std <= 0)):
            raise ValueError('Invalid IX/POSS scalers.')
        model = tf.keras.models.load_model(folder / 'best_model.keras', compile=False)
        if tuple(model.input_shape[1:]) != (40, width) or model.output_shape[-1] != len(LABELS):
            raise ValueError('IX/POSS checkpoint shape mismatch.')
        self.infer = tf.function(lambda features: model(features, training=False),
                                 input_signature=[tf.TensorSpec((1, 40, width), tf.float32)], autograph=False)
        probe = np.zeros((1, 40, width), dtype=np.float32)
        np.testing.assert_allclose(np.asarray(self.infer(probe)), np.asarray(model(probe, training=False)),
                                   rtol=1e-4, atol=1e-5)
        self.labels = LABELS
        self.confidence_threshold = float(metadata['acceptanceThreshold'])
        if not 0 <= self.confidence_threshold <= 1:
            raise ValueError('Invalid IX/POSS acceptance threshold.')
        self.lock = Lock()
        self.members = [(MODEL_NAME, model, self.mean, self.std)]

    def _base(self, request: SignRequest) -> dict:
        return {'requestId': request.requestId, 'frameCount': len(request.frames), 'model': self.model_id}

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
            features = motion_features(frames, FEATURE_ORDER)
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
