"""Lab adapter for the alphabet candidate's static and temporal hand inputs."""
import hashlib
import json
from pathlib import Path
from threading import Lock
from time import perf_counter

import numpy as np

from app.recognition import SignRequest, validate_capture, FEATURE_ORDER, raw_geometry_features, standardize_for_model


def hand_features(frames):
    vectors = np.asarray([frame.features for frame in frames], dtype=np.float64)
    result = np.zeros((len(frames), 128), dtype=np.float64)
    for source, target in ((36, 0), (100, 64)):
        points = vectors[:, source + 1:source + 64].reshape((-1, 21, 3))
        scale = np.linalg.norm(points[:, 9] - points[:, 0], axis=1)
        present = (vectors[:, source] == 1) & (scale > 1e-6)
        result[present, target] = 1
        result[present, target + 1:target + 64] = (
            (points[present] - points[present, :1]) / scale[present, None, None]
        ).reshape((-1, 63))
    return result


def select_alphabet_input(frames):
    """Use static inference unless a reliably tracked hand shows deliberate travel."""
    end = frames[-1].timestamp
    recent = [frame for frame in frames if frame.timestamp >= end - 800]
    if not frames[-1].valid:
        return 'unusable', None, 0.
    # Select a nondegenerate visible hand. A smaller, intermittently detected
    # resting hand must not invalidate the consistently visible signing hand.
    candidates = []
    for offset in (36, 100):
        points = np.asarray(frames[-1].features[offset + 1:offset + 64]).reshape((21, 3))
        scale = np.linalg.norm(points[9] - points[0])
        if frames[-1].features[offset] == 1 and scale > 1e-6:
            observed = [f for f in recent if f.valid and f.features[offset] == 1]
            if (len(observed) >= 5 and len(observed) / len(recent) >= .8
                    and observed[-1].timestamp - observed[0].timestamp >= 500
                    and all(0 < b.timestamp - a.timestamp <= 250 for a, b in zip(observed, observed[1:]))):
                candidates.append((scale, offset, observed))
    if not candidates:
        return 'unusable', None, 0.
    _, primary, observed = max(candidates, key=lambda item: item[0])
    # Median time bins, followed by a three-bin median, suppress isolated
    # landmark jumps before measuring travel in shoulder-width units.
    bins = {}
    for frame in observed:
        key = int((frame.timestamp - observed[0].timestamp) // 100)
        bins.setdefault(key, []).append(np.asarray(frame.features[primary + 1:primary + 64]).reshape((21, 3))[:, :2])
    points = np.asarray([np.median(items, axis=0) for items in bins.values()])
    smoothed = np.asarray([np.median(points[i:i + 3], axis=0) for i in range(len(points) - 2)])
    displacement = 0.
    for anchor in smoothed:
        displacement = max(displacement, float(np.linalg.norm(smoothed - anchor, axis=2).mean(axis=1).max()))
    values = hand_features(frames)
    for offset, target in ((36, 0), (100, 64)):
        if offset == primary:
            continue
        if sum(f.valid and f.features[offset] == 1 for f in recent) / len(recent) < .8:
            values[:, target:target + 64] = 0
    if displacement < .18:
        return 'static', values[-1:], displacement
    positions = np.linspace(0, len(values) - 1, 40)
    resampled = np.stack([np.interp(positions, np.arange(len(values)), values[:, i]) for i in range(128)], axis=1)
    for offset in (0, 64):
        resampled[resampled[:, offset] < .999999, offset:offset + 64] = 0
    return 'temporal', resampled, displacement


def j_handshape_supported(frames):
    """Require a sustained extended pinky with the other three fingers folded.

    This supports routing to the learned temporal classifier; it cannot identify
    J on its own, since the same static posture is also used for I.
    """
    recent = [f for f in frames if f.timestamp >= frames[-1].timestamp - 800]
    supported = 0
    reliable = 0
    for frame in recent:
        if not frame.valid:
            continue
        for offset in (36, 100):
            if frame.features[offset] != 1:
                continue
            points = np.asarray(frame.features[offset + 1:offset + 64]).reshape((21, 3))
            scale = np.linalg.norm(points[9] - points[0])
            if scale <= 1e-6:
                continue
            ratios = [np.linalg.norm(points[tip] - points[0]) /
                      max(np.linalg.norm(points[pip] - points[0]), 1e-6)
                      for pip, tip in ((6, 8), (10, 12), (14, 16), (18, 20))]
            reliable += 1
            supported += ratios[3] >= 1.15 and max(ratios[:3]) <= 1.05
    return bool(reliable >= 5 and supported / reliable >= .6)


class AlphabetMotionHead:
    def __init__(self, dataset_root):
        import tensorflow as tf
        self.name = 'alphabet_motion_v1_seed42'
        folder = dataset_root / 'models/candidates/alphabet_motion_v1' / self.name
        checksums = json.loads((folder / 'artifact_checksums.json').read_bytes())
        for filename in ('best_model.keras', 'metadata.json', 'scalers.npz', 'acceptance.json'):
            with (folder / filename).open('rb') as handle:
                if hashlib.file_digest(handle, 'sha256').hexdigest() != checksums[filename]:
                    raise ValueError('Motion-head artifact mismatch: ' + filename)
        metadata = json.loads((folder / 'metadata.json').read_bytes())
        if (metadata['labels'] != ['OTHER', 'J', 'Z'] or metadata['sequenceLength'] != 40
                or metadata['featureCount'] != 238 or metadata['featureOrder'] != FEATURE_ORDER):
            raise ValueError('Motion-head schema mismatch.')
        acceptance = json.loads((folder / 'acceptance.json').read_bytes())
        self.thresholds = {l: float(acceptance['labels'][l]['threshold']) for l in ('J', 'Z')}
        if any(not .8 <= t <= 1 for t in self.thresholds.values()):
            raise ValueError('Invalid motion acceptance threshold.')
        self.margin = float(acceptance['margin'])
        with np.load(folder / 'scalers.npz', allow_pickle=False) as arrays:
            self.mean, self.std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
        standardize_for_model(np.zeros((1, 40, 238)), self.mean, self.std)
        self.model = tf.keras.models.load_model(folder / 'best_model.keras', compile=False)
        if tuple(self.model.input_shape[1:]) != (40, 238) or self.model.output_shape[-1] != 3:
            raise ValueError('Invalid motion-head checkpoint shape.')
        self.infer = tf.function(lambda x: self.model(x, training=False),
            input_signature=[tf.TensorSpec((1, 40, 238), tf.float32)], autograph=False)
        probe = np.zeros((1, 40, 238), dtype=np.float32)
        np.testing.assert_allclose(self.infer(probe), self.model(probe, training=False), rtol=1e-4, atol=1e-5)

    def predict(self, request):
        sequence = dict(id=request.requestId, frames=[f.model_dump() for f in request.frames])
        raw = raw_geometry_features(sequence, FEATURE_ORDER, 40).astype(np.float32)[None]
        return np.asarray(self.infer(standardize_for_model(raw, self.mean, self.std)))[0]


class AlphabetDiagnosticRecognizer:
    model_id = 'lab-alphabet-j460-v2-seed43-graph-diagnostics'
    confidence_threshold = .8
    margin_threshold = .15

    def __init__(self, dataset_root: Path):
        import tensorflow as tf
        name = 'alphabet_26_j460_v2_seed43'
        folder = dataset_root / 'models' / 'candidates' / 'alphabet_26_j460_v2' / name
        checksums = json.loads((folder / 'artifact_checksums.json').read_text(encoding='utf-8'))
        for filename in ('best_model.keras', 'metadata.json', 'scalers.npz', 'labels.json'):
            with (folder / filename).open('rb') as handle:
                if hashlib.file_digest(handle, 'sha256').hexdigest() != checksums[filename]:
                    raise ValueError('Alphabet artifact checksum mismatch: ' + filename)
        metadata = json.loads((folder / 'metadata.json').read_text(encoding='utf-8'))
        self.labels = metadata['labels']
        if (self.labels != list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') or metadata['seed'] != 43
                or metadata.get('sampleCount') != 10090
                or metadata['input']['features'] != 128
                or metadata['input']['static_frames'] != 1 or metadata['input']['temporal_frames'] != 40
                or json.loads((folder / 'labels.json').read_bytes()) != metadata['labelToIndex']
                or metadata['labelToIndex'] != {l: i for i, l in enumerate(self.labels)}):
            raise ValueError('Alphabet metadata mismatch.')
        with np.load(folder / 'scalers.npz', allow_pickle=False) as arrays:
            self.mean, self.std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
        if (self.mean.shape != (128,) or self.std.shape != (128,) or
                not np.isfinite(self.mean).all() or not np.isfinite(self.std).all() or np.any(self.std <= 0)):
            raise ValueError('Invalid alphabet scalers.')
        model = tf.keras.models.load_model(folder / 'best_model.keras', compile=False)
        if tuple(model.input_shape[1:]) != (None, 128) or model.output_shape[-1] != 26:
            raise ValueError('Alphabet checkpoint shape mismatch.')
        self.infer = tf.function(lambda features: model(features, training=False),
            input_signature=[tf.TensorSpec((1, None, 128), tf.float32)], autograph=False)
        self.lock = Lock()
        self.members = [(name, model, self.mean, self.std)]
        for length in (1,):
            probe = np.ones((1, length, 128), dtype=np.float32)
            np.testing.assert_allclose(self.infer(probe), model(probe, training=False), rtol=1e-4, atol=1e-5)

    def _probabilities(self, values):
        features = ((values.astype(np.float32) - self.mean) / self.std).astype(np.float32)[None]
        probabilities = np.asarray(self.infer(features))[0]
        if probabilities.shape != (26,) or not np.isfinite(probabilities).all() or not np.isclose(probabilities.sum(), 1, atol=1e-5):
            raise ValueError('Invalid alphabet probabilities.')
        return probabilities

    def predict(self, request: SignRequest):
        validate_capture(request, allow_no_hands=True)
        started = perf_counter()
        kind, values, displacement = select_alphabet_input(request.frames)
        result = dict(requestId=request.requestId, model=self.model_id, frameCount=len(request.frames),
                      inputKind=kind, motion=displacement,
                      inputReason='insufficient_reliable_hand_tracking' if kind == 'unusable'
                      else 'deliberate_hand_travel' if kind == 'temporal' else 'static_handshape')
        if values is None:
            return dict(result, label='UNKNOWN', score=0., accepted=False, top3=[], inferenceMs=0,
                        rejectionReason='insufficient_hand_visibility')
        # Always evaluate the one-frame handshape path. Movement alone must
        # never veto a confidently recognized static letter.
        with self.lock:
            probabilities = self._probabilities(values[-1:])
            static_ranked = np.argsort(probabilities)[::-1]
            static_label = self.labels[static_ranked[0]]
            static_score = float(probabilities[static_ranked[0]])
            static_margin = static_score - float(probabilities[static_ranked[1]])
            result.update(inputKind='static', inputReason='static_handshape',
                          staticCandidate=dict(label=static_label, score=static_score, margin=static_margin))
            static_confident = (static_label not in ('J', 'Z')
                                and static_score >= self.confidence_threshold
                                and static_margin >= self.margin_threshold)
            j_shape = j_handshape_supported(request.frames)
            result['jHandshapeSupported'] = j_shape
            if kind == 'temporal' and (not static_confident or j_shape):
                temporal_probabilities = self._probabilities(values)
                temporal_label = self.labels[int(np.argmax(temporal_probabilities))]
                temporal_score = float(temporal_probabilities.max())
                temporal_margin = temporal_score - float(np.partition(temporal_probabilities, -2)[-2])
                result['temporalCandidate'] = dict(label=temporal_label, score=temporal_score, margin=temporal_margin)
                strong_j = (j_shape and temporal_label == 'J' and temporal_score >= self.confidence_threshold
                            and temporal_margin >= self.margin_threshold)
                if temporal_label in ('J', 'Z') and (not static_confident or strong_j):
                    probabilities = temporal_probabilities
                    result.update(inputKind='temporal', inputReason='j_handshape_and_learned_motion' if strong_j else 'deliberate_hand_travel')
        ranked = np.argsort(probabilities)[::-1]
        label, score = self.labels[ranked[0]], float(probabilities[ranked[0]])
        margin = score - float(probabilities[ranked[1]])
        threshold = self.confidence_threshold
        margin_threshold = self.margin_threshold
        matching_kind = (label in ('J', 'Z')) == (result['inputKind'] == 'temporal')
        if label == 'T' and j_shape:
            matching_kind = False
            result['inputReason'] = 'static_t_conflicts_with_extended_pinky'
        rejection = ('alphabet_input_mismatch' if not matching_kind else
                     'alphabet_low_confidence' if score < threshold else
                     'alphabet_low_margin' if margin < margin_threshold else None)
        result = dict(result, label=label, score=score, accepted=rejection is None,
            confidenceThreshold=threshold, marginThreshold=margin_threshold,
            top3=[dict(label=self.labels[i], score=float(probabilities[i])) for i in ranked[:3]],
            inferenceMs=round((perf_counter() - started) * 1000))
        if rejection:
            result['rejectionReason'] = rejection
        return result
