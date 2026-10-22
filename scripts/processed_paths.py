"""Locate prepared datasets without changing immutable arrays or provenance."""
from pathlib import Path
import re

from model_paths import resolve_model_artifact_path


def organized_processed_name(name):
    """Return a relative location for known source exports and tensor variants."""
    if name == 'friend-landmark-comparison.gif':
        return 'reports/' + name
    dataset = re.fullmatch(r'participant_\d+-dataset(?:-v([2-6]))?\.json', name)
    if dataset:
        version = dataset[1]
        group = ('current/recordings_v5' if version == '5' else
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
        group = ('current/recordings_v5' if value == '5' else
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
    if legacy != organized and legacy.exists():
        if organized.exists():
            raise ValueError(f'Ambiguous processed artifact: {legacy} and {organized}')
        return legacy
    return organized


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
    """Resolve model and processed paths recorded in frozen metadata files."""
    path = resolve_model_artifact_path(path)
    for parent in path.parents:
        if parent.name == 'processed':
            relative = path.relative_to(parent)
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
