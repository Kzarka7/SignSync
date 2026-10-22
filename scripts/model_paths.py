"""Resolve organized artifacts while supporting older dataset roots."""
from pathlib import Path

MODEL_LAYOUT = {
    'gru_model_train_test_geometry_v3_recordings_v5': 'current/recordings_v5',
    'gru_model_train_test_geometry_v3_recordings_v6': 'candidates/recordings_v6',
    'gru_model_train_test_geometry_v3': 'archive/geometry_v3',
    'gru_model_train_test_handshape_v2': 'archive/handshape_v2',
    'gru_model_train_test_v1': 'archive/baseline_v1',
    'gru_model_train_test_two_participants': 'archive/two_participants',
    'prediction-reports': 'reports/predictions',
    'idle_hand_v1_readiness': 'reports/readiness/idle_hand_v1',
    'v5_v6_ensemble_comparison_20261016': 'reports/comparisons/v5_v6_ensemble_20261016',
}
for version in (2, 3, 4):
    MODEL_LAYOUT[f'gru_model_train_test_geometry_v3_recordings_v{version}'] = f'archive/recordings_v{version}'
MODEL_LAYOUT['gru_model_train_test_geometry_v3_recordings_v3_body_trajectory'] = 'archive/recordings_v3_body_trajectory'
for variant in ('finger_joints', 'no_orientation', 'no_start', 'no_wrist_position'):
    MODEL_LAYOUT[f'gru_model_train_test_geometry_v3_{variant}'] = f'archive/ablations/{variant}'
for experiment in ('geometry_v3', 'handshape_v2', 'geometry_v3_finger_joints',
                   'geometry_v3_no_orientation', 'geometry_v3_no_start',
                   'geometry_v3_no_wrist_position', 'geometry_v3_recordings_v3_body_trajectory',
                   *(f'geometry_v3_recordings_v{version}' for version in range(2, 7))):
    MODEL_LAYOUT[f'{experiment}_comparison'] = f'reports/comparisons/{experiment}'
for review in ('p3_live_v5_threshold_audit_20261016', 'p4_live_v5_threshold_audit_20261016',
               'p4_which_replacement_review_20261016'):
    MODEL_LAYOUT[review] = f'reports/reviews/{review}'
for extension in ('json', 'md'):
    filename = f'wait_replacement_review_20261008.{extension}'
    MODEL_LAYOUT[filename] = f'reports/reviews/wait_replacement_20261008/{filename}'


def model_artifact_folder(root, name):
    """Use existing legacy paths, or organized paths for new artifacts.

    Refuse two competing locations rather than silently selecting a checkpoint.
    Unmapped run names remain valid for isolated experiment roots.
    """
    legacy = root / name
    organized = root / MODEL_LAYOUT.get(name, name)
    if legacy != organized and legacy.exists():
        if organized.exists():
            raise ValueError(f'Ambiguous model artifact: {legacy} and {organized}')
        return legacy
    return organized


def resolve_model_artifact_path(path):
    """Resolve model paths recorded in immutable historical provenance files."""
    path = Path(path)
    for parent in path.parents:
        if parent.name == 'models':
            relative = path.relative_to(parent)
            if relative.parts[0] in MODEL_LAYOUT:
                return model_artifact_folder(parent, relative.parts[0]).joinpath(*relative.parts[1:])
    return path


def find_model_folder(root, run):
    candidates = [p for p in root.rglob(run) if p.is_dir() and (p/'evaluation.json').is_file()]
    if len(candidates) != 1:
        raise ValueError(f'Expected one saved model for {run}, found {len(candidates)} under {root}')
    return candidates[0]


def geometry_model_folder(root, run):
    """Reuse a saved full-v3 run, or choose its grouped output location."""
    if any(p.is_dir() and (p/'evaluation.json').is_file() for p in root.rglob(run)):
        return find_model_folder(root, run)
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3')/run


def orientation_ablation_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_no_orientation')/run


def wrist_position_ablation_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_no_wrist_position')/run


def finger_joint_model_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_finger_joints')/run


def recordings_v2_model_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_recordings_v2')/run


def recordings_v3_model_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_recordings_v3')/run


def recordings_v4_model_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_recordings_v4')/run


def recordings_v5_model_folder(root, run):
    return model_artifact_folder(root, 'gru_model_train_test_geometry_v3_recordings_v5')/run
