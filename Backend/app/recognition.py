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
from processed_paths import SIMILAR_SIGNS, p4_prepared_folder, processed_artifact_path, resolve_experiment_path
from model_paths import find_model_folder, model_artifact_folder
from run_recordings_v5_experiments import raw_geometry_features, standardize_for_model
from shape_motion_sequence import GEOMETRY_V3, SHAPE_MOTION_V1, raw_shape_motion_features

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
    swap_hand_slots = False
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
        frames = [f.model_dump() for f in request.frames]
        if self.swap_hand_slots:
            frames = [swap_hand_slots(frame) for frame in frames]
        sequence = {"id": request.requestId, "frames": frames}
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
    idle_without_hands = False

    def predict(self, request: SignRequest) -> dict:
        if self.idle_without_hands and not any(
            frame.valid and (frame.features[36] == 1 or frame.features[100] == 1)
            for frame in request.frames
        ):
            validate_capture(request, allow_no_hands=True, supports_short_preview=self.supports_short_preview)
            return {
                "requestId": request.requestId, "label": "IDLE", "score": 1.0, "accepted": False,
                "inferenceMs": 0, "frameCount": len(request.frames), "top3": [],
                "model": self.model_id, "rejectionReason": "no_hands_idle_rule",
            }
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
LAB_EXPERIMENTS = {
    'lab-grouped': 'samples_55_signs_rest_idle_geometry_v1',
    'lab-clip': 'samples_55_signs_rest_idle_clip_60_15_25_v1',
    'lab-signs38': 'samples_38_signs_grouped_v1',
    'lab-signs38-clip': 'samples_38_signs_clip_70_15_15_v1',
    'lab-signs33': 'samples_33_signs_weekdays_clip_70_15_15_v1',
    'lab-signs43-numbers': 'samples_43_signs_days_numbers_clip_70_15_15_v1',
    'lab-signs43-shape-motion': 'samples_43_signs_shape_motion_v1',
    'lab-signs43-similarity': SIMILAR_SIGNS,
    # Same 43 signs and clips as v1, recipe E: sign-motion-cues-v1 features + BiGRU
    # (see app/sign_motion_e_recognition.py). Live hand-slot order, no swap.
    'lab-signs43-motion-e': 'samples_43_signs_motion_e_v1',
    'lab-signs43-similarity-v2': 'samples_43_signs_similarity_v2',
    'lab-signs75-candidate': 'samples_75_signs_batch_expansion_v1',
    'lab-signs75-multi-batch': 'samples_75_signs_multi_batch_dev_v1',
    'lab-signs32-standalone': 'samples_32_signs_standalone_v3',
    # Same 32 signs and features, all 60 clips per sign (adds a 1280x720 recording
    # setup), trained by train_gru.py without augmentation.
    'lab-signs32-standalone-v4': 'samples_32_signs_standalone_v4',
    # v4 plus participant P4's .MOV batches for 12 signs (2,142 clips), same recipe.
    'lab-signs32-standalone-v5': 'samples_32_signs_standalone_v5',
    # Same v5 clips and split on sign-motion-v1 features + augmentation (see app/sign_motion_recognition.py).
    'lab-signs32-standalone-v5-motion': 'samples_32_signs_standalone_v5_motion',
    # 43 Similar Signs v1 + standalone v3 signs (PARENTS composed in the Lab from
    # FATHER + MOTHER). Training clips were rebuilt in the live hand-slot order.
    'lab-signs74-combined': 'samples_74_signs_combined_v3',
    'lab-signs32-similarity': 'samples_32_signs_similarity_v1',
    # Indexing + possessives pilot (IX-1..IX-3pl, POSS-1..POSS-3pl); no REST/IDLE.
    'lab-ix-poss-pilot': 'samples_12_signs_ix_poss_batch_holdout_v1',
    # Same 12 labels on ix-poss-motion-v1 features (see app/ix_poss_recognition.py).
    'lab-ix-poss-motion': 'samples_12_signs_ix_poss_motion_v1',
    'lab-alphabet': 'alphabet_26_j460_v2',
    'lab-stage2': 'alphabet_numbers_36_joint_v1_rerun_20261109',
}
_lab_recognizers = {}

# Collector video import saves samples with swapHandSides: true (swapVideoHands),
# so these models learned the opposite hand-slot order from what Lab replay and
# the live camera send. Measured share of swapped training samples: standalone
# v3 ~90%, standalone v4 ~81%, standalone v5 ~68%, 32-sign similarity ~79%,
# IX/POSS pilot 100%. The 75-sign sets are mixed (~26%) and stay unswapped.
# Swapping at inference restores the training convention.
HAND_SWAPPED_TRAINING = frozenset({'lab-signs32-standalone', 'lab-signs32-standalone-v4', 'lab-signs32-standalone-v5',
                                   'lab-signs32-similarity', 'lab-ix-poss-pilot'})
STANDALONE_MODES = frozenset({'lab-signs32-standalone', 'lab-signs32-standalone-v4', 'lab-signs32-standalone-v5'})
HAND_BLOCK = slice(36, 100), slice(100, 164)


def swap_hand_slots(frame: dict) -> dict:
    """Exchange the leftHand and rightHand feature blocks (present flag + 21 xyz)."""
    features = list(frame['features'])
    left, right = HAND_BLOCK
    features[left], features[right] = features[right], features[left]
    return {**frame, 'features': features}


class SampleDiagnosticRecognizer(P4CandidateRecognizer):
    """Load a seed-42 sequence checkpoint and its frozen preprocessing."""
    margin_threshold = 0

    def __init__(self, dataset_root: Path, mode: str):
        import tensorflow as tf
        from sample_pipeline import digest
        from sample_training import validate_candidate
        experiment = LAB_EXPERIMENTS[mode]
        similar_signs_v2 = mode == 'lab-signs43-similarity-v2'
        preparation = SIMILAR_SIGNS if similar_signs_v2 else experiment
        processed = dataset_root / 'processed'
        prepared = (processed_artifact_path(processed, preparation) if preparation == SIMILAR_SIGNS
                    else processed / 'candidates' / preparation)
        metadata_bytes = (prepared / 'metadata.json').read_bytes()
        metadata = json.loads(metadata_bytes)
        config = validate_candidate(prepared, metadata)
        standalone = mode in STANDALONE_MODES
        combined = mode == 'lab-signs74-combined'
        # Trained by train_gru.py, which leaves evaluation.json's checkpoint
        # unset; checkpoint_verification.json pins the reproduced checkpoint.
        ix_poss = mode == 'lab-ix-poss-pilot'
        train_gru_run = ix_poss or mode in ('lab-signs32-standalone-v4', 'lab-signs32-standalone-v5')
        self.idle_without_hands = standalone or combined or ix_poss
        self.swap_hand_slots = mode in HAND_SWAPPED_TRAINING
        shape_motion_background_classes = {
            'lab-signs75-candidate': 77, 'lab-signs75-multi-batch': 77,
            'lab-signs74-combined': 76,
        }
        shape_motion_background = mode in shape_motion_background_classes
        shape_motion = (preparation == SIMILAR_SIGNS or mode in ('lab-signs43-shape-motion', 'lab-signs32-similarity')
                        or shape_motion_background or standalone or ix_poss)
        self.supports_short_preview = shape_motion
        expected_variant = SHAPE_MOTION_V1 if shape_motion else GEOMETRY_V3
        if metadata.get('featureVariant', GEOMETRY_V3) != expected_variant:
            raise ValueError('Pilot feature variant mismatch.')
        if shape_motion:
            self.raw_features = raw_shape_motion_features
        mapping = metadata['labelToIndex']
        self.labels = sorted(mapping, key=mapping.get)
        sign_only_classes = {'lab-signs38': 38, 'lab-signs38-clip': 38, 'lab-signs33': 33,
                             'lab-signs43-numbers': 43, 'lab-signs43-shape-motion': 43,
                             'lab-signs43-similarity': 43, 'lab-signs43-similarity-v2': 43,
                             'lab-signs32-similarity': 32, 'lab-signs32-standalone': 32,
                             'lab-signs32-standalone-v4': 32, 'lab-signs32-standalone-v5': 32,
                             'lab-ix-poss-pilot': 12}
        sign_only = mode in sign_only_classes
        class_count = shape_motion_background_classes.get(mode, sign_only_classes.get(mode, 57))
        background = {'REST', 'IDLE_MOVEMENT'}
        labels_ok = (set(mapping) == set(config['labels']) and not background.intersection(mapping)
                     if sign_only else background.issubset(mapping))
        if shape_motion_background:
            labels_ok = labels_ok and set(mapping) == set(config['labels'])
        if (sorted(mapping.values()) != list(range(class_count)) or not labels_ok or
                metadata['featureCount'] != 238 or metadata['sequenceLength'] != 40 or
                json.loads((prepared / 'feature_schema.json').read_text(encoding='utf-8'))['order'] != FEATURE_ORDER):
            raise ValueError(f'Expected {class_count}-class {expected_variant} pilot artifacts.')
        models = dataset_root / 'models'
        model_group = (model_artifact_folder(models, experiment) if mode == 'lab-signs43-similarity'
                       else models / 'candidates' / experiment)
        folder = find_model_folder(models / 'candidates', experiment) if standalone else model_group / experiment
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
        checkpoint = folder / ('best_model.h5' if sign_only and not (similar_signs_v2 or standalone or ix_poss)
                               else 'best_model.keras')
        if sign_only or shape_motion_background:
            verified = json.loads((folder / 'checkpoint_verification.json').read_text(encoding='utf-8'))
            recorded_checkpoint = evaluation.get('checkpoint') or (checkpoint.name if train_gru_run else None)
            if (verified['experiment'] != experiment or verified['seed'] != 42 or verified['labels'] != self.labels or
                    verified['checkpoint'] != checkpoint.name or recorded_checkpoint != checkpoint.name or
                    verified['metadataSha256'] != digest(metadata_bytes) or
                    verified['checkpointSha256'] != digest(checkpoint.read_bytes())):
                raise ValueError(f'{class_count}-sign checkpoint verification mismatch.')
        model = tf.keras.models.load_model(checkpoint, compile=False)
        if tuple(model.input_shape[1:]) != (40, 238) or model.output_shape[-1] != class_count:
            raise ValueError('Pilot checkpoint shape mismatch.')
        standardize_for_model(np.zeros((1, 40, 238)), mean, std)
        identity = mode
        if standalone:
            identity = f"lab-signs32-standalone-{experiment.rsplit('_', 1)[-1]}"
        elif combined:
            identity = f"{mode}-{experiment.rsplit('_', 1)[-1]}"
        self.model_id = identity + '-seed42-graph-diagnostics'
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
        self.swap_hand_slots = getattr(candidate, 'swap_hand_slots', False)
        self.idle_without_hands = getattr(candidate, 'idle_without_hands', False)
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
    if mode in LAB_EXPERIMENTS:
        from app.core.config import settings
        with _diagnostic_load_lock:
            if mode not in _lab_recognizers:
                root = Path(settings.dataset_root) if settings.dataset_root else REPO.parent / 'SignSync Dataset'
                if mode == 'lab-alphabet':
                    from app.alphabet_recognition import AlphabetDiagnosticRecognizer
                    _lab_recognizers[mode] = AlphabetDiagnosticRecognizer(root)
                elif mode == 'lab-stage2':
                    from app.stage2_recognition import Stage2DiagnosticRecognizer
                    _lab_recognizers[mode] = Stage2DiagnosticRecognizer(root)
                elif mode == 'lab-ix-poss-motion':
                    from app.ix_poss_recognition import IxPossMotionRecognizer
                    _lab_recognizers[mode] = IxPossMotionRecognizer(root)
                elif mode == 'lab-signs32-standalone-v5-motion':
                    from app.sign_motion_recognition import SignMotionV5Recognizer
                    _lab_recognizers[mode] = SignMotionV5Recognizer(root)
                elif mode == 'lab-signs43-motion-e':
                    from app.sign_motion_e_recognition import SignMotionERecognizer
                    _lab_recognizers[mode] = SignMotionERecognizer(root)
                else:
                    _lab_recognizers[mode] = GraphP4DiagnosticRecognizer(SampleDiagnosticRecognizer(root, mode))
            return _lab_recognizers[mode]
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
