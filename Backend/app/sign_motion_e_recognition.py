"""Recognition Lab: 43 Similar Signs, recipe E candidate (sign-motion-cues-v1 + bidirectional GRU).

Same 43 labels and 3,816 approved clips as the v1 baseline (all splits pooled), trained on
sign-motion-cues-v1 features: sign-motion-v1 two-hand motion, hand-relative finger joints and
tilt/height/aperture cues (205 channels). Features come from scripts/sign_motion_cues_features.py,
a byte-identical copy of the training module; the model refuses to load if it differs (SHA-256 in
metadata.json). The 43-sign clips use the live hand-slot order, so frames are not swapped.

The acceptance threshold is the saved one (0.57, macro-F1 calibration on held-out-participant/batch
predictions). Expected accuracy on unseen participants/batches: 91.3%, macro F1 0.908 (seed 42).
See SignSync Dataset/experiments/samples_43_signs_motion_v1/REPORT.md.
"""
import hashlib
import json
from pathlib import Path
from threading import Lock

import numpy as np

import sign_motion_cues_features
from sign_motion_cues_features import CUES_CHANNELS, CUES_VARIANT, sign_motion_cues_features as cues_features
from app.recognition import FEATURE_ORDER
from app.sign_motion_recognition import SignMotionV5Recognizer

MODEL_GROUP = 'samples_43_signs_motion_e_v1'
MODEL_NAME = 'sign_motion_cues_v1_aug_all_clips_seed42'
LABELS = ['EIGHT', 'FAMILY', 'FIVE', 'FOUR', 'FRIDAY', 'FRIEND', 'GOOD_AFTERNOON', 'GOOD_EVENING', 'GOOD_MORNING',
          'HELLO', 'HELP', 'HOW', 'MONDAY', 'NINE', 'NO', 'ONE', 'PLEASE', 'SATURDAY', 'SEVEN', 'SIX', 'SORRY',
          'STAY', 'SUNDAY', 'TEN', 'THANK_YOU', 'THREE', 'THURSDAY', 'TODAY', 'TOMORROW', 'TUESDAY', 'TWO',
          'WAIT', 'WAVE_GREETING', 'WEDNESDAY', 'WELCOME', 'WHAT', 'WHEN', 'WHERE', 'WHICH', 'WHO', 'WHY',
          'YES', 'YESTERDAY']


class SignMotionERecognizer(SignMotionV5Recognizer):
    """Reuses the v5-motion prediction rules (IDLE without hands, visibility, probability checks)."""
    model_id = 'lab-signs43-motion-e-seed42-graph-diagnostics'
    supports_short_preview = True
    swap_hand_slots = False
    idle_without_hands = True
    margin_threshold = 0.

    def __init__(self, dataset_root: Path):
        import tensorflow as tf
        folder = dataset_root / 'models' / 'candidates' / MODEL_GROUP / MODEL_NAME
        checksums = json.loads((folder / 'artifact_checksums.json').read_text(encoding='utf-8'))
        for filename in ('best_model.keras', 'scalers.npz', 'metadata.json', 'labels.json'):
            if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != checksums[filename]:
                raise ValueError('43-sign motion E artifact checksum mismatch: ' + filename)
        metadata = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
        module_sha = hashlib.sha256(Path(sign_motion_cues_features.__file__).read_bytes()).hexdigest()
        if (metadata['featureVariant'] != CUES_VARIANT or metadata['featureChannels'] != CUES_CHANNELS
                or metadata['sequenceLength'] != 40 or metadata['labels'] != LABELS
                or metadata['labelToIndex'] != {label: i for i, label in enumerate(LABELS)}
                or json.loads((folder / 'labels.json').read_bytes()) != metadata['labelToIndex']
                or metadata['featureModuleSha256'] != module_sha):
            raise ValueError('43-sign motion E metadata or feature code mismatch.')
        threshold = float(metadata['acceptanceThreshold'])
        if not 0 < threshold < 1:
            raise ValueError('Invalid 43-sign motion E acceptance threshold.')
        with np.load(folder / 'scalers.npz', allow_pickle=False) as arrays:
            self.mean, self.std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
        width = len(CUES_CHANNELS)
        if (self.mean.shape != (width,) or self.std.shape != (width,) or not np.isfinite(self.mean).all()
                or not np.isfinite(self.std).all() or np.any(self.std <= 0)):
            raise ValueError('Invalid 43-sign motion E scalers.')
        model = tf.keras.models.load_model(folder / 'best_model.keras', compile=False)
        if tuple(model.input_shape[1:]) != (40, width) or model.output_shape[-1] != len(LABELS):
            raise ValueError('43-sign motion E checkpoint shape mismatch.')
        self.infer = tf.function(lambda features: model(features, training=False),
                                 input_signature=[tf.TensorSpec((1, 40, width), tf.float32)], autograph=False)
        probe = np.zeros((1, 40, width), dtype=np.float32)
        np.testing.assert_allclose(np.asarray(self.infer(probe)), np.asarray(model(probe, training=False)),
                                   rtol=1e-4, atol=1e-5)
        self.labels = LABELS
        self.confidence_threshold = threshold
        self.lock = Lock()
        self.members = [(MODEL_NAME, model, self.mean, self.std)]

    def featurize(self, frames: list) -> np.ndarray:
        return cues_features(frames, FEATURE_ORDER)
