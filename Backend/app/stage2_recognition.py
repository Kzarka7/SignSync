"""Recognition Lab adapter for the three frozen Stage 2 joint checkpoints."""

import hashlib
import json
from pathlib import Path
from threading import Lock
from time import perf_counter

import numpy as np

from app.recognition import LAB_EXPERIMENTS, SignRequest, validate_capture
from stage2_features import motion_frames, shape_frame


MOTION_LABELS = {'J', 'Z', 'TEN'}
HANDSHAPE_LOOKBACK_MS = 250


def observed_motion(x, valid):
    for offset in (36, 100):
        points = x[valid & (x[:, offset] == 1), offset + 1:offset + 64].reshape(-1, 21, 3)
        if len(points) >= 8 and np.linalg.norm(points[:, :, :2] - points[0, :, :2], axis=2).mean(axis=1).max() >= .08:
            return True
    return False


class Stage2DiagnosticRecognizer:
    model_id = 'lab-stage2-rerun-20261109-seeds42-43-44-no-hold-graph-diagnostics'
    # Frozen validation: .75 keeps eight more correct predictions than .80
    # without adding a wrong acceptance on the isolated-clip cohort.
    confidence_threshold = .75
    margin_threshold = .15

    def __init__(self, dataset_root: Path):
        parent = dataset_root / 'models' / 'candidates' / LAB_EXPERIMENTS['lab-stage2']
        self.labels = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN'.split()
        self.lock = Lock()
        self.members = []
        shared = None
        for seed in (42, 43, 44):
            name, infer, provenance = self._load_member(parent, seed)
            if shared is not None and provenance != shared:
                raise ValueError('Stage 2 checkpoints must share prepared inputs and scalers.')
            shared = provenance
            self.members.append((name, infer))

    def _load_member(self, parent, seed):
        import tensorflow as tf

        name = f'alphabet_numbers_36_joint_v1_seed{seed}'
        folder = parent / name
        if not folder.exists():
            folder = parent / f'seed{seed}'
        checksums = json.loads((folder / 'artifact_checksums.json').read_bytes())
        for filename in ('joint.keras', 'labels.json', 'scalers.npz', 'run.json'):
            with (folder / filename).open('rb') as handle:
                if hashlib.file_digest(handle, 'sha256').hexdigest() != checksums[filename]:
                    raise ValueError(f'Stage 2 seed {seed} artifact checksum mismatch: {filename}')
        run = json.loads((folder / 'run.json').read_bytes())
        if (run['seed'] != seed or
                json.loads((folder / 'labels.json').read_bytes()) != dict(zip(self.labels, range(36)))):
            raise ValueError('Stage 2 seed or label map mismatch.')
        if not self.members:
            self.scalers = {}
            with np.load(folder / 'scalers.npz', allow_pickle=False) as arrays:
                for key, size in (('shape', 128), ('motion', 171)):
                    mean, std = arrays[key + '_mean'], arrays[key + '_std']
                    if (mean.shape != (size,) or std.shape != (size,) or not np.isfinite(mean).all()
                            or not np.isfinite(std).all() or np.any(std <= 0)):
                        raise ValueError('Invalid Stage 2 scalers.')
                    self.scalers[key] = mean, std
        model = tf.keras.models.load_model(folder / 'joint.keras', compile=False)
        if model.input_shape != [(None, 128), (None, 40, 171), (None, 1)] or model.output_shape != (None, 36):
            raise ValueError('Stage 2 checkpoint shape mismatch.')
        infer = tf.function(lambda shape, motion, present: model([shape, motion, present], training=False),
            input_signature=[tf.TensorSpec(shape, tf.float32) for shape in ((1, 128), (1, 40, 171), (1, 1))],
            autograph=False)
        probe = [np.ones(shape, dtype=np.float32) for shape in ((1, 128), (1, 40, 171), (1, 1))]
        np.testing.assert_allclose(infer(*probe), model(probe, training=False), rtol=1e-4, atol=1e-5)
        return name, infer, (run['prepared_checksums'], checksums['scalers.npz'])

    def _probabilities(self, shape, motion=None):
        shape_mean, shape_std = self.scalers['shape']
        motion_mean, motion_std = self.scalers['motion']
        inputs = (((shape - shape_mean) / shape_std).astype(np.float32)[None],
                  np.zeros((1, 40, 171), dtype=np.float32) if motion is None
                  else ((motion - motion_mean) / motion_std).astype(np.float32)[None],
                  np.full((1, 1), motion is not None, dtype=np.float32))
        with self.lock:
            probabilities = np.stack([np.asarray(infer(*inputs))[0] for _, infer in self.members])
        if (probabilities.shape != (len(self.members), 36) or not np.isfinite(probabilities).all()
                or not np.allclose(probabilities.sum(axis=1), 1, atol=1e-5)):
            raise ValueError('Invalid Stage 2 probabilities.')
        return probabilities.mean(axis=0)

    def predict(self, request: SignRequest):
        validate_capture(request, allow_no_hands=True)
        started = perf_counter()
        frames = request.frames
        x = np.asarray([frame.features for frame in frames])
        time = np.asarray([frame.timestamp for frame in frames])
        valid = np.asarray([frame.valid for frame in frames])
        shape = shape_frame(x, time, valid)
        result = dict(requestId=request.requestId, model=self.model_id, frameCount=len(frames))
        unusable = dict(result, label='UNKNOWN', score=0., accepted=False, top3=[], inferenceMs=0,
                        inputKind='unusable', rejectionReason='insufficient_hand_visibility')
        if not shape.any() or np.mean(valid & np.any(x[:, [36, 100]] == 1, axis=1)) < .5:
            return unusable
        probabilities = None
        if observed_motion(x, valid):
            joint = self._probabilities(shape, motion_frames(x, time, valid))
            strongest = int(joint.argmax())
            if (self.labels[strongest] in MOTION_LABELS and joint[strongest] >= self.confidence_threshold
                    and joint[strongest] - np.partition(joint, -2)[-2] >= self.margin_threshold):
                probabilities = joint
        input_kind, input_reason = 'joint', 'handshape_and_motion'
        if probabilities is None:
            start = np.searchsorted(time, time[-1] - HANDSHAPE_LOOKBACK_MS)
            recent_shape = shape_frame(x[start:], time[start:], valid[start:])
            if not recent_shape.any():
                return unusable
            probabilities = self._probabilities(recent_shape)
            # A single handshape cannot confirm a moving sign.
            probabilities = probabilities.copy()
            probabilities[[self.labels.index(label) for label in MOTION_LABELS]] = 0
            input_kind = 'static'
            input_reason = 'recent_handshape_only'
        ranked = np.argsort(probabilities)[::-1]
        score = float(probabilities[ranked[0]])
        margin = score - float(probabilities[ranked[1]])
        rejection = ('stage2_low_confidence' if score < self.confidence_threshold else
                     'stage2_low_margin' if margin < self.margin_threshold else None)
        result.update(label=self.labels[ranked[0]], score=score, accepted=rejection is None,
                      inputKind=input_kind, inputReason=input_reason,
                      confidenceThreshold=self.confidence_threshold, marginThreshold=self.margin_threshold,
                      top3=[dict(label=self.labels[i], score=float(probabilities[i])) for i in ranked[:3]],
                      inferenceMs=round((perf_counter() - started) * 1000))
        if rejection:
            result['rejectionReason'] = rejection
        return result
