"""Train a fresh four-fold v6 experiment with P4's six new WHICH recordings.

Stages an isolated dataset root, leaving existing prepared sources and models
unchanged. Run the existing four-participant trainer against that root.
"""
from __future__ import annotations
from processed_paths import processed_artifact_path, resolve_artifact_path, reviewed_p4_dataset, resolve_experiment_path
from model_paths import model_artifact_folder

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from preprocess_dataset import load_export


def digest(path: Path) -> str:
    path = resolve_artifact_path(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()



def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    source = args.dataset_root.resolve()
    output = resolve_experiment_path(args.output).resolve()
    if source == output or source not in output.parents or output.exists():
        parser.error('--output must be a NEW folder inside --dataset-root')

    old_path = processed_artifact_path(source / 'processed', 'participant_04-dataset-v6.json')
    old = json.loads(old_path.read_text(encoding='utf-8'))
    reviewed_path = reviewed_p4_dataset(source)
    current = load_export(reviewed_path)
    old_by_label = {label: {s['id'] for s in old['sequences'] if s['label'] == label}
                    for label in old['labels']}
    new_by_label = {label: {s['id'] for s in current['sequences'] if s['label'] == label}
                    for label in current['labels']}
    if old['featureSchema'] != current['featureSchema'] or Counter(s['label'] for s in current['sequences']) != Counter(s['label'] for s in old['sequences']):
        raise ValueError('P4 schema or label counts differ from saved baseline')
    changes = {label: {'removed': sorted(old_by_label[label] - new_by_label[label]),
                       'added': sorted(new_by_label[label] - old_by_label[label])}
               for label in old_by_label if old_by_label[label] != new_by_label[label]}
    if set(changes) != {'WHICH'} or len(changes['WHICH']['removed']) != 6 or len(changes['WHICH']['added']) != 6:
        raise ValueError(f'Expected exactly six WHICH replacements, got {changes}')

    source_files = [processed_artifact_path(source / 'processed', f'participant_{i:02}-dataset-v5.json') for i in range(1, 4)]
    source_files += [old_path, reviewed_path]
    baseline_hashes = {str(p): digest(p) for p in source_files}
    print('Verified six WHICH replacements and 394 retained P4 recordings.', flush=True)

    (output / 'processed').mkdir(parents=True)
    (output / 'models').mkdir(parents=True)
    for path in [*source_files[:3], reviewed_path]:
        destination = processed_artifact_path(output / 'processed', path.name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    (output / 'source-provenance.json').write_text(json.dumps({
        'purpose': 'P4 six-WHICH replacement experiment',
        'sourceSha256': baseline_hashes,
        'changes': changes,
        'baselineP4PreparedSource': str(old_path),
        'liveRecognitionChanged': False,
    }, indent=2), encoding='utf-8')
    command = [sys.executable, '-u', str(Path(__file__).with_name('run_recordings_v6_experiments.py')),
               '--dataset-root', str(output)]
    if args.prepare_only:
        command.append('--prepare-only')
    print('Running:', ' '.join(command), flush=True)
    result = subprocess.run(command, env=dict(os.environ, PYTHONUNBUFFERED='1'))
    for path, expected in baseline_hashes.items():
        if digest(Path(path)) != expected:
            raise RuntimeError(f'Source changed during experiment: {path}')
    if result.returncode:
        raise SystemExit(result.returncode)
    print('Original source hashes unchanged. Results:', model_artifact_folder(output / 'models', 'geometry_v3_recordings_v6_comparison') / 'report.md', flush=True)


if __name__ == '__main__':
    main()
