"""Development v5 ensemble using the training feature code and saved scalers."""
from __future__ import annotations
import json
from pathlib import Path
import sys
from threading import Lock
from time import perf_counter
import numpy as np
from pydantic import BaseModel, ConfigDict, Field

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
from processed_paths import p4_prepared_folder, processed_artifact_path, resolve_experiment_path
from model_paths import model_artifact_folder
from run_recordings_v5_experiments import raw_geometry_features, standardize_for_model
from shape_motion_sequence import SHAPE_MOTION_V1, raw_shape_motion_features

POSE_NAMES = ("nose", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist", "leftHip", "rightHip")
HAND_NAMES = ("wrist", "thumb_cmc", "thumb_mcp", "thumb_ip", "thumb_tip", "index_mcp", "index_pip", "index_dip", "index_tip", "middle_mcp", "middle_pip", "middle_dip", "middle_tip", "ring_mcp", "ring_pip", "ring_dip", "ring_tip", "pinky_mcp", "pinky_pip", "pinky_dip", "pinky_tip")
FEATURE_ORDER = [f"pose.{name}.{axis}" for name in POSE_NAMES for axis in ("x", "y", "z", "visibility")]
for hand in ("leftHand", "rightHand"):
    FEATURE_ORDER += [f"{hand}.present"] + [f"{hand}.{name}.{axis}" for name in HAND_NAMES for axis in "xyz"]
EXPERIMENTS = tuple(f"gru_{pair}_geometry_v3_recordings_v5" for pair in ("p01_p02_train_p03_test", "p01_p03_train_p02_test", "p02_p03_train_p01_test"))


class Frame(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    timestamp: float
    features: list[float] = Field(min_length=164, max_length=164)
    valid: bool


class SignRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=100)
    featureOrder: list[str] = Field(min_length=164, max_length=164)
    frames: list[Frame] = Field(min_length=8, max_length=240)
    preview: bool = False


def validate_capture(request: SignRequest, *, allow_no_hands: bool = False, supports_short_preview: bool = False) -> None:
    if request.featureOrder != FEATURE_ORDER:
        raise ValueError("Feature schema differs from the v5 collector. Reload the application.")
    frames = request.frames
    timestamps = np.asarray([f.timestamp for f in frames])
    short_preview = request.preview and supports_short_preview
    min_duration = 350 if short_preview else 400
    if np.any(np.diff(timestamps) <= 0) or not min_duration <= timestamps[-1] - timestamps[0] <= 10000:
        if short_preview:
            raise ValueError("A preview needs at least 350 ms of ordered observations.")
        raise ValueError("Record one complete sign lasting 0.4–10 seconds.")
    values = np.asarray([f.features for f in frames])
    present = values[:, [36, 100]]
    if not np.isin(present, [0, 1]).all():
        raise ValueError("Invalid hand presence flags.")
    if np.mean([f.valid for f in frames]) < .8 or (not allow_no_hands and np.mean(present.max(axis=1)) < .5):
        raise ValueError("Keep your shoulders and signing hands visible, then record again.")


class V5Recognizer:
    @staticmethod
    def raw_features(sequence, order, length):
        return raw_geometry_features(sequence, order, length)
    model_id = "v5-nine-run-ensemble"
    allow_no_hands = False
    supports_short_preview = False
    confidence_threshold = .63
    margin_threshold = .15
    def __init__(self, dataset_root: Path):
        import tensorflow as tf
        self.members = []
        self.lock = Lock()
        self.labels = None
        for experiment in EXPERIMENTS:
            processed = processed_artifact_path(dataset_root / "processed", experiment)
            metadata = json.loads((processed / "metadata.json").read_text(encoding="utf-8"))
            mapping = metadata["labelToIndex"]
            labels = [label for label, _ in sorted(mapping.items(), key=lambda item: item[1])]
            if sorted(mapping.values()) != list(range(20)) or metadata["featureCount"] != 238 or metadata["sequenceLength"] != 40:
                raise ValueError("Expected v5 40-frame, 238-channel, 20-sign artifacts.")
            if self.labels is not None and labels != self.labels:
                raise ValueError("Ensemble label maps differ.")
            self.labels = labels
            with np.load(processed / "gru_data.npz", allow_pickle=False) as arrays:
                mean, std = arrays["feature_mean"].copy(), arrays["feature_std"].copy()
            standardize_for_model(np.zeros((1, 40, 238)), mean, std)
            for seed in (42, 43, 44):
                run = experiment + (f"_seed{seed}" if seed != 42 else "")
                folder = model_artifact_folder(dataset_root / 'models', 'gru_model_train_test_geometry_v3_recordings_v5') / run
                evaluation = json.loads((folder / "evaluation.json").read_text(encoding="utf-8"))
                if evaluation["preprocessingMetadata"] != metadata or evaluation["randomSeed"] != seed or evaluation["experiment"] != experiment:
                    raise ValueError(f"Checkpoint metadata mismatch: {run}")
                model = tf.keras.models.load_model(folder / "best_model.h5", compile=False)
                if tuple(model.input_shape[1:]) != (40, 238) or model.output_shape[-1] != 20:
                    raise ValueError(f"Checkpoint shape mismatch: {run}")
                model(np.zeros((1, 40, 238), dtype=np.float32), training=False)
                self.members.append((run, model, mean, std))

    def predict(self, request: SignRequest) -> dict:
        validate_capture(request, allow_no_hands=self.allow_no_hands, supports_short_preview=self.supports_short_preview)
        started = perf_counter()
        sequence = {"id": request.requestId, "frames": [f.model_dump() for f in request.frames]}
        raw = self.raw_features(sequence, FEATURE_ORDER, 40)[None, ...]
        with self.lock:
            probabilities = np.mean([np.asarray(model(standardize_for_model(raw, mean, std), training=False))[0]
                                     for _, model, mean, std in self.members], axis=0)
        if probabilities.shape != (len(self.labels),) or not np.isfinite(probabilities).all() or not np.isclose(probabilities.sum(), 1, atol=1e-5):
            raise ValueError("Model returned invalid probabilities.")
        ranked = np.argsort(probabilities)[::-1]
        score = float(probabilities[ranked[0]])
        margin = score - float(probabilities[ranked[1]])
        return {"requestId": request.requestId, "label": self.labels[ranked[0]], "score": score,
                "accepted": score >= self.confidence_threshold and margin >= self.margin_threshold and self.labels[ranked[0]] not in ("REST", "IDLE", "IDLE_MOVEMENT"),
                "inferenceMs": round((perf_counter() - started) * 1000), "frameCount": len(request.frames),
                "top3": [{"label": self.labels[i], "score": float(probabilities[i])} for i in ranked[:3]],
                "model": self.model_id}


class P4CandidateRecognizer(V5Recognizer):
    """Opt-in experiment; reads its own checkpoints and training-only scalers."""
    model_id = "p4-sign-rest-idle-nine-run-ensemble"
    allow_no_hands = True

    def predict(self, request: SignRequest) -> dict:
        result = super().predict(request)
        if result["label"] not in ("REST", "IDLE", "IDLE_MOVEMENT"):
            # Count only valid frames with at least one detected hand. Keep
            # non-sign inference available when hands are below the camera.
            visible = sum(frame.valid and (frame.features[36] == 1 or frame.features[100] == 1)
                          for frame in request.frames) / len(request.frames)
            if visible < .5:
                result["accepted"] = False
                result["rejectionReason"] = "insufficient_hand_visibility"
        return result

    def __init__(self, dataset_root: Path):
        import tensorflow as tf
        root = resolve_experiment_path(dataset_root / "experiments" / "sign_rest_idle_p4_signs_v1_2026_10_18")
        prepared = p4_prepared_folder(root)
        self.members = []
        self.lock = Lock()
        self.labels = None
        for original in EXPERIMENTS:
            experiment = original.replace("recordings_v5", "sign_rest_idle_p4_signs_v1")
            folder = prepared / "folds" / experiment
            metadata = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
            mapping = metadata["labelToIndex"]
            labels = sorted(mapping, key=mapping.get)
            if (sorted(mapping.values()) != list(range(22)) or not {"REST", "IDLE_MOVEMENT"}.issubset(labels)
                    or metadata["featureCount"] != 238 or metadata["sequenceLength"] != 40):
                raise ValueError("Expected P4 candidate 40-frame, 238-channel, 22-class artifacts.")
            if self.labels is not None and labels != self.labels:
                raise ValueError("Candidate label maps differ.")
            self.labels = labels
            with np.load(folder / "gru_data.npz", allow_pickle=False) as arrays:
                mean, std = arrays["feature_mean"].copy(), arrays["feature_std"].copy()
            if not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std <= 0):
                raise ValueError("Invalid candidate scalers.")
            standardize_for_model(np.zeros((1, 40, 238)), mean, std)
            for seed in (42, 43, 44):
                run = experiment + f"_seed{seed}"
                model_folder = root / "models" / run
                evaluation = json.loads((model_folder / "evaluation.json").read_text(encoding="utf-8"))
                if evaluation["preprocessingMetadata"] != metadata or evaluation["seed"] != seed or evaluation["fold"] != experiment:
                    raise ValueError(f"Candidate checkpoint metadata mismatch: {run}")
                model = tf.keras.models.load_model(model_folder / "best_model.h5", compile=False)
                if tuple(model.input_shape[1:]) != (40, 238) or model.output_shape[-1] != 22:
                    raise ValueError(f"Candidate checkpoint shape mismatch: {run}")
                model(np.zeros((1, 40, 238), dtype=np.float32), training=False)
                self.members.append((run, model, mean, std))


_recognizer = None
_candidate_recognizer = None
_load_lock = Lock()
_diagnostic_recognizer = None
_diagnostic_load_lock = Lock()
LIVE_DIAGNOSTIC_MODELS = {
    'lab-signs43-similarity': 'samples_43_signs_similarity_v1',
    'lab-alphabet': 'alphabet_26_j460_v2',
}
_live_diagnostic_models = {}


class SampleDiagnosticRecognizer(P4CandidateRecognizer):
    """Load a seed-42 sequence checkpoint and its frozen preprocessing."""
    margin_threshold = 0

    def __init__(self, dataset_root: Path, mode: str):
        import tensorflow as tf
        from sample_pipeline import digest
        from sample_training import validate_candidate
        experiment = LIVE_DIAGNOSTIC_MODELS[mode]
        processed = dataset_root / 'processed'
        prepared = processed_artifact_path(processed, experiment)
        metadata_bytes = (prepared / 'metadata.json').read_bytes()
        metadata = json.loads(metadata_bytes)
        config = validate_candidate(prepared, metadata)
        if metadata.get('featureVariant') != SHAPE_MOTION_V1:
            raise ValueError('Similar Signs feature variant mismatch.')
        self.raw_features = raw_shape_motion_features
        mapping = metadata['labelToIndex']
        self.labels = sorted(mapping, key=mapping.get)
        class_count = 43
        labels_ok = set(mapping) == set(config['labels']) and not {'REST', 'IDLE_MOVEMENT'}.intersection(mapping)
        if (sorted(mapping.values()) != list(range(class_count)) or not labels_ok or
                metadata['featureCount'] != 238 or metadata['sequenceLength'] != 40 or
                json.loads((prepared / 'feature_schema.json').read_text(encoding='utf-8'))['order'] != FEATURE_ORDER):
            raise ValueError(f'Expected {class_count}-class {SHAPE_MOTION_V1} pilot artifacts.')
        models = dataset_root / 'models'
        folder = model_artifact_folder(models, experiment) / experiment
        evaluation = json.loads((folder / 'evaluation.json').read_text(encoding='utf-8'))
        selection = json.loads((folder / 'threshold_selection.json').read_text(encoding='utf-8'))
        if (evaluation['preprocessingMetadata'] != metadata or evaluation['randomSeed'] != 42 or
                evaluation['experiment'] != experiment or selection['selectedOn'] != 'validation only' or
                evaluation['acceptance']['threshold'] != selection['selected']['threshold']):
            raise ValueError('Pilot checkpoint metadata mismatch.')
        self.confidence_threshold = float(selection['selected']['threshold'])
        if not np.isfinite(self.confidence_threshold) or not 0 <= self.confidence_threshold <= 1:
            raise ValueError('Invalid pilot acceptance threshold.')
        with np.load(prepared / 'gru_data.npz', allow_pickle=False) as arrays:
            mean, std = arrays['feature_mean'].copy(), arrays['feature_std'].copy()
        checkpoint = folder / 'best_model.h5'
        verified = json.loads((folder / 'checkpoint_verification.json').read_text(encoding='utf-8'))
        if (verified['experiment'] != experiment or verified['seed'] != 42 or verified['labels'] != self.labels or
                verified['checkpoint'] != checkpoint.name or evaluation['checkpoint'] != checkpoint.name or
                verified['metadataSha256'] != digest(metadata_bytes) or
                verified['checkpointSha256'] != digest(checkpoint.read_bytes())):
            raise ValueError('Similar Signs checkpoint verification mismatch.')
        model = tf.keras.models.load_model(checkpoint, compile=False)
        if tuple(model.input_shape[1:]) != (40, 238) or model.output_shape[-1] != class_count:
            raise ValueError('Pilot checkpoint shape mismatch.')
        standardize_for_model(np.zeros((1, 40, 238)), mean, std)
        self.model_id = mode + '-seed42-graph-diagnostics'
        self.lock = Lock()
        self.members = [(experiment, model, mean, std)]


class GraphP4DiagnosticRecognizer(P4CandidateRecognizer):
    """Opt-in execution wrapper: shares candidate weights, scalers and rules.

    GRU eager execution is too slow for short rolling windows on CPU. Tracing
    each existing member avoids Python timestep overhead without retraining or
    changing the default v5 / P4 capture paths.
    """
    model_id = "p4-sign-rest-idle-nine-run-ensemble-graph-diagnostics"

    def __init__(self, candidate: P4CandidateRecognizer):
        import tensorflow as tf
        self.labels = candidate.labels
        self.lock = candidate.lock
        self.confidence_threshold = getattr(candidate, 'confidence_threshold', .63)
        self.margin_threshold = getattr(candidate, 'margin_threshold', .15)
        self.supports_short_preview = getattr(candidate, 'supports_short_preview', False)
        self.raw_features = getattr(candidate, 'raw_features', self.raw_features)
        self.model_id = getattr(candidate, 'model_id', self.model_id)
        if self.model_id == P4CandidateRecognizer.model_id:
            self.model_id = type(self).model_id
        self.members = []

        class GraphMember:
            def __init__(self, model):
                self.infer = tf.function(lambda features: model(features, training=False),
                                         input_signature=[tf.TensorSpec((1, 40, 238), tf.float32)],
                                         autograph=False)

            def __call__(self, features, training=False):
                return self.infer(tf.convert_to_tensor(features, dtype=tf.float32))

        with self.lock:
            probe = np.zeros((1, 40, 238), dtype=np.float32)
            for run, model, mean, std in candidate.members:
                graph = GraphMember(model)
                # Fail visibly rather than silently accepting a different scorer.
                np.testing.assert_allclose(np.asarray(graph(probe)), np.asarray(model(probe, training=False)),
                                           rtol=1e-4, atol=1e-5)
                self.members.append((run, graph, mean, std))


def get_diagnostic_recognizer(mode: str = 'p4-candidate'):
    global _diagnostic_recognizer
    if mode in LIVE_DIAGNOSTIC_MODELS:
        from app.core.config import settings
        with _diagnostic_load_lock:
            if mode not in _live_diagnostic_models:
                root = Path(settings.dataset_root) if settings.dataset_root else REPO.parent / 'SignSync Dataset'
                if mode == 'lab-alphabet':
                    from app.alphabet_recognition import AlphabetDiagnosticRecognizer
                    _live_diagnostic_models[mode] = AlphabetDiagnosticRecognizer(root)
                else:
                    _live_diagnostic_models[mode] = GraphP4DiagnosticRecognizer(SampleDiagnosticRecognizer(root, mode))
            return _live_diagnostic_models[mode]
    if mode != 'p4-candidate':
        raise ValueError('Unknown diagnostic model.')
    candidate = get_recognizer('p4-candidate')
    with _diagnostic_load_lock:
        if _diagnostic_recognizer is None:
            _diagnostic_recognizer = GraphP4DiagnosticRecognizer(candidate)
    return _diagnostic_recognizer


def get_recognizer(mode: str = "v5") -> V5Recognizer:
    global _recognizer, _candidate_recognizer
    if mode not in ("v5", "p4-candidate"):
        raise ValueError("Unknown recognition model.")
    from app.core.config import settings
    with _load_lock:
        if mode == "p4-candidate":
            if _candidate_recognizer is None:
                root = Path(settings.dataset_root) if settings.dataset_root else REPO.parent / "SignSync Dataset"
                _candidate_recognizer = P4CandidateRecognizer(root)
            return _candidate_recognizer
        if _recognizer is None:
            root = Path(settings.dataset_root) if settings.dataset_root else REPO.parent / "SignSync Dataset"
            _recognizer = V5Recognizer(root)
    return _recognizer
