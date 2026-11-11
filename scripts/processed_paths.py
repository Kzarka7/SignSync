"""Locate prepared datasets without changing immutable arrays or provenance."""
from pathlib import Path, PureWindowsPath
import re

from model_paths import resolve_model_artifact_path

P4_RELEASE = 'sign_rest_idle_p4_signs_v1_2026_10_18'
SIMILAR_SIGNS = 'samples_43_signs_similarity_v1'

EXPERIMENT_GROUPS = {
    'candidates': (
        'p4_idle_rejection_v1_2026_10_18',
        'p4_which_replacement_v1',
        P4_RELEASE,
    ),
    'archive': (
        'sign_rest_idle_v1_2026_10_17',
        'sign_rest_idle_training_v1_2026_10_17',
        'stable_palm_v1_20261016',
    ),
    'reports/comparisons': (
        'continuous_policy_v3_2026_10_19',
        'gesture_segmentation_v1_2026_10_19',
        'no_hands_idle_v2_2026_10_19',
        'replay_confirmation_comparison_2026_10_19',
        'source_sampling_20261021',
        'thank_you_relabel_20261021',
    ),
    'reports/reviews': ('fsl_reference_review_2026_10_19',),
    'reports/verification': (
        'boundary_upload_20261021',
        'collector_release_20261021',
        'continuous_replay_v1_2026_10_18',
        'gesture_context_20261021',
        'graph_connection_verification_2026_10_19',
        'unified_samples_20261021',
    ),
}
EXPERIMENT_LAYOUT = {
    name: Path(group) / name
    for group, names in EXPERIMENT_GROUPS.items()
    for name in names
}


def resolve_experiment_path(path):
    """Find an experiment and its contents in organized or legacy roots."""
    path = Path(path)
    for parent in path.parents:
        if parent.name != 'experiments':
            continue
        name, *relative = path.relative_to(parent).parts
        if name == 'candidates' and relative and relative[0] == P4_RELEASE:
            name, *relative = relative
        if name not in EXPERIMENT_LAYOUT:
            continue
        legacy = parent / name
        organized = parent / EXPERIMENT_LAYOUT[name]
        if name == P4_RELEASE:
            baseline = parent.parent / 'models' / 'baseline' / name
            if baseline.exists():
                if legacy.exists() or organized.exists():
                    raise ValueError(f'Ambiguous experiment: {name} has both baseline and experiment folders')
                return baseline.joinpath(*relative)
        if legacy.exists():
            if organized.exists():
                raise ValueError(f'Ambiguous experiment: {legacy} and {organized}')
            return path
        return organized.joinpath(*relative)
    return path


def organized_processed_name(name):
    """Return a relative location for known source exports and tensor variants."""
    if name == SIMILAR_SIGNS:
        return f'current/{name}'
    if name == 'recordings_v5':
        return 'baseline/recordings_v5'
    if name == 'friend-landmark-comparison.gif':
        return 'reports/' + name
    dataset = re.fullmatch(r'participant_\d+-dataset(?:-v([2-6]))?\.json', name)
    if dataset:
        version = dataset[1]
        group = ('baseline/recordings_v5' if version == '5' else
                 'candidates/recordings_v6' if version == '6' else
                 f'archive/recordings_v{version}' if version else 'archive/baseline_v1')
        return f'{group}/datasets/{name}'
    if not re.fullmatch(r'gru_p\d+(?:_p\d+)*_train_p\d+_test(?:_\w+)?', name):
        return name
    version = re.search(r'_recordings_v([2-6])$', name)
    if name.endswith('_geometry_v3_recordings_v3_body_trajectory'):
        return f'archive/recordings_v3_body_trajectory/folds/{name}'
    if version:
        value = version[1]
        group = ('baseline/recordings_v5' if value == '5' else
                 'candidates/recordings_v6' if value == '6' else f'archive/recordings_v{value}')
        section = ('folds' if '_geometry_v3_' in name else
                   'intermediates/handshape' if '_handshape_v2_' in name else 'intermediates/raw')
        return f'{group}/{section}/{name}'
    for variant in ('finger_joints', 'no_orientation', 'no_start', 'no_wrist_position'):
        if name.endswith('_geometry_v3_' + variant):
            return f'archive/ablations/{variant}/{name}'
    for suffix, group in (('_geometry_v3', 'geometry_v3'), ('_handshape_v2', 'handshape_v2'),
                          ('_v1', 'baseline_v1')):
        if re.fullmatch(r'gru_p\d+(?:_p\d+)*_train_p\d+_test' + re.escape(suffix), name):
            return f'archive/{group}/folds/{name}'
    if name.endswith('_test'):
        return f'archive/two_participants/folds/{name}'
    return name


def processed_artifact_path(root, name):
    """Prefer an existing legacy artifact; new outputs use the organized layout."""
    root = Path(root)
    name = str(name)
    legacy = root / name
    organized = root / organized_processed_name(name)
    locations = {legacy, organized}
    if name == SIMILAR_SIGNS:
        locations.add(root / 'candidates' / name)
    elif organized.is_relative_to(root / 'baseline/recordings_v5'):
        locations.add(root / 'current/recordings_v5' / organized.relative_to(root / 'baseline/recordings_v5'))
    existing = sorted(path for path in locations if path.exists())
    if len(existing) > 1:
        raise ValueError(f'Ambiguous processed artifact: {existing}')
    return existing[0] if existing else organized


def p4_prepared_folder(release):
    """Find P4's prepared folds and datasets without rewriting its provenance."""
    release = Path(release)
    if release.name == P4_RELEASE and release.parent.name == 'baseline' and release.parent.parent.name == 'models':
        promoted = release.parents[2] / 'processed' / 'baseline' / P4_RELEASE
        if promoted.exists():
            if any((release / name).exists() for name in ('folds', 'datasets')):
                raise ValueError(f'Ambiguous P4 preprocessing: {release} and {promoted}')
            return promoted
    return release


def processed_glob(root, pattern):
    """Find folds in flat or organized roots without silently mixing copies."""
    matches = sorted(Path(root).rglob(pattern))
    identities = set()
    depth = len(Path(pattern).parts)
    for path in matches:
        identity = tuple(path.parts[-depth:])
        if identity in identities:
            raise ValueError(f'Duplicate processed artifact matching {pattern}: {path}')
        identities.add(identity)
    return matches


def resolve_artifact_path(path):
    """Resolve experiment, model and processed paths in frozen metadata."""
    path = resolve_model_artifact_path(resolve_experiment_path(path))
    for parent in path.parents:
        if parent.name == P4_RELEASE:
            relative = path.relative_to(parent)
            if relative.parts[0] in ('folds', 'datasets'):
                return p4_prepared_folder(parent) / relative
        if parent.name == 'processed':
            relative = path.relative_to(parent)
            if relative.parts[:2] == ('candidates', SIMILAR_SIGNS):
                return processed_artifact_path(parent, SIMILAR_SIGNS).joinpath(*relative.parts[2:])
            if relative.parts[:2] == ('current', 'recordings_v5'):
                return processed_artifact_path(parent, 'recordings_v5').joinpath(*relative.parts[2:])
            return processed_artifact_path(parent, relative.parts[0]).joinpath(*relative.parts[1:])
    return path


def resolved_source_hashes(hashes):
    """Compare immutable source records by resolved location and original digest."""
    resolved = {}
    for path, digest in hashes.items():
        key = str(resolve_artifact_path(path).resolve())
        if key in resolved:
            raise ValueError(f'Duplicate resolved source path: {key}')
        resolved[key] = digest
    return resolved


def reviewed_p4_dataset(root):
    reviewed = resolve_experiment_path(Path(root) / 'experiments' / 'p4_which_replacement_v1' / 'processed')
    return processed_artifact_path(reviewed, 'participant_04-dataset-v6.json')


def active_source_hashes(hashes):
    """Exclude retired participant staging paths from historical integrity records."""
    active = {}
    for path, digest in hashes.items():
        parts = PureWindowsPath(path).parts
        if any(parent.lower() == 'clean' and re.fullmatch(r'participant_\d+', child.lower())
               for parent, child in zip(parts, parts[1:])):
            continue
        active[path] = digest
    return active
