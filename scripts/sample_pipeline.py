"""Manifest-controlled preparation from samples/<SIGN>/*.json.

index is read-only unless --write is supplied. prepare freezes a new candidate;
reproduce checks the three saved v5 folds without writing or training.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
from datetime import datetime, timezone

import numpy as np

from preprocess_dataset import resample_sequence
from prepare_handshape_experiments import handshape, resample_shape
from gesture_geometry import geometry, resample as resample_geometry, feature_names

ROOT = Path(__file__).resolve().parents[2] / 'SignSync Dataset'
SPLITS = ('training', 'validation', 'test')
SUFFIXES = ('train', 'validation', 'test')
FIELDS = ('sequence_id', 'label', 'sample_path', 'sha256', 'content_sha256',
          'sequence_sha256', 'signer_id', 'recording_session', 'collection_batch',
          'source_recording', 'status', 'reason', 'quality_notes', 'notes')
BACKGROUND = {'REST', 'IDLE_MOVEMENT'}


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def read_csv(path, key='sequence_id'):
    if not path.exists():
        return {}
    with path.open(encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle))
    result = {}
    for row in rows:
        identity = row.get(key)
        if not identity or identity in result:
            raise ValueError(f'{path}: missing or repeated {key}')
        result[identity] = row
    return result


def csv_text(rows):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows({key: row.get(key, '') for key in FIELDS} for row in rows)
    return stream.getvalue()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def safe_name(name):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', name):
        raise ValueError('Use a version name containing letters, digits, underscores or hyphens')
    return name


def load_sample(path, label=None):
    payload = path.read_bytes()
    data = json.loads(payload.decode('utf-8-sig'))
    if data.get('schemaVersion') != 1 or data.get('sequenceCount') != 1 or len(data.get('sequences', [])) != 1:
        raise ValueError('expected one schemaVersion=1 sample per JSON')
    sequence = data['sequences'][0]
    if not isinstance(sequence.get('id'), str) or not sequence['id'].strip():
        raise ValueError('missing sample ID')
    if not isinstance(sequence.get('label'), str) or not sequence['label'].strip():
        raise ValueError('missing sign label')
    if label is not None and sequence['label'] != label:
        raise ValueError('sample label does not match sign folder')
    if data.get('labels') != [sequence['label']]:
        raise ValueError('export labels do not match sample')
    schema = data.get('featureSchema', {})
    order = schema.get('order', [])
    if schema.get('length') != 164 or len(order) != 164 or len(set(order)) != 164:
        raise ValueError('expected 164 uniquely named landmark features')
    if not {'leftHand.present', 'rightHand.present'} <= set(order):
        raise ValueError('missing hand tracking flags')
    frames = sequence.get('frames', [])
    if len(frames) < 2 or sequence.get('frameCount') != len(frames):
        raise ValueError('invalid frame count or incomplete gesture')
    vectors = np.asarray([frame.get('features') for frame in frames], dtype=float)
    if vectors.shape != (len(frames), 164) or not np.isfinite(vectors).all():
        raise ValueError('malformed or non-finite landmarks')
    timestamps = np.asarray([frame.get('timestamp') for frame in frames], dtype=float)
    if not np.isfinite(timestamps).all() or np.any(np.diff(timestamps) <= 0):
        raise ValueError('timestamps must be finite and strictly increasing')
    if any(not isinstance(f.get('valid'), bool) for f in frames):
        raise ValueError('missing boolean tracking validity')
    notes = []
    present = (vectors[:, order.index('leftHand.present')] > .5) | (vectors[:, order.index('rightHand.present')] > .5)
    if sequence['label'] not in BACKGROUND:
        if present.mean() < .5:
            notes.append('hands detected in fewer than 50% of frames')
        indices = np.flatnonzero(present)
        if len(indices) > 1 and np.diff(indices).max() >= 6:
            notes.append('internal hand tracking gap of at least 5 frames')
        if np.mean([f['valid'] for f in frames]) < .5:
            notes.append('fewer than 50% valid frames')
    return data, sequence, digest(payload), notes


def scan(root):
    """Preserve decisions only for unchanged files. New samples stay pending."""
    samples = root / 'samples'
    if not samples.is_dir():
        raise ValueError(f'Missing samples folder: {samples}')
    existing = read_csv(root / 'manifests' / 'training-samples.csv')
    legacy = read_csv(root / 'manifests' / 'samples.csv')
    exclusions = read_csv(root / 'manifests' / 'excluded-samples.csv')
    # The byte-verified migration is the only automatic approval bootstrap.
    provenance = read_csv(root / 'documentation' / 'cleanup-audit-20261022' /
                          'sample-flatten-manifest.csv', 'sample_id')
    rows, problems, schema = [], [], None
    seen_ids, seen_content = {}, {}
    paths = sorted(samples.rglob('*.json'))
    for path in paths:
        relative = path.relative_to(root).as_posix()
        try:
            parts = path.relative_to(samples).parts
            if len(parts) != 2:
                raise ValueError('expected samples/<SIGN>/<sample>.json; no participant folders')
            data, sequence, checksum, notes = load_sample(path, parts[0])
            if schema is None:
                schema = data['featureSchema']
            if data['featureSchema'] != schema:
                raise ValueError('feature schema differs from other samples')
            sid = sequence['id']
            # Exclude ID, label, export time and raw landmark packaging from the
            # content fingerprint, so relabelled copies are detected as well.
            content = digest(canonical([{'timestamp': f['timestamp'], 'features': f['features'],
                                         'valid': f['valid']} for f in sequence['frames']]))
            old = existing.get(sid, {})
            bootstrap = provenance.get(sid, {})
            known = bootstrap.get('sha256') == checksum and bootstrap.get('label') == sequence['label']
            unchanged = bool(old) and old.get('sha256') == checksum and old.get('label') == sequence['label']
            metadata = sequence.get('metadata') or {}
            source = sequence.get('videoImport') or {}
            signer = (old.get('signer_id') or metadata.get('signerId') or sequence.get('signerId') or
                      (bootstrap.get('participant_id') if known else '') or legacy.get(sid, {}).get('participant_id', ''))
            row = dict(sequence_id=sid, label=sequence['label'], sample_path=relative,
                       sha256=checksum, content_sha256=content, sequence_sha256=digest(canonical(sequence)),
                       signer_id=signer, recording_session=old.get('recording_session') or metadata.get('recordingSession', ''),
                       collection_batch=old.get('collection_batch') or metadata.get('collectionBatch', ''),
                       source_recording=str(source.get('fingerprint') or old.get('source_recording') or metadata.get('sourceRecording', '')).lower(),
                       status=old.get('status', 'pending') if unchanged else ('approved' if known and not old else 'pending'),
                       reason=old.get('reason', '') if unchanged else ('sample changed; review again' if old else ''),
                       quality_notes='; '.join(notes), notes=old.get('notes', ''))
            if row['status'] not in {'approved', 'pending', 'excluded'}:
                raise ValueError('manifest status must be approved, pending or excluded')
            if notes and row['status'] == 'approved' and not known and not row['notes'].strip():
                row.update(status='pending', reason='quality findings require a review note')
            if sid in exclusions:
                row.update(status='excluded', reason=exclusions[sid].get('reason') or 'historical exclusion')
            duplicate = None
            if sid in seen_ids:
                duplicate = 'duplicate ID of ' + seen_ids[sid]
            elif content in seen_content:
                duplicate = 'duplicate content of ' + seen_content[content]
            if duplicate:
                problems.append(dict(sample_path=relative, sequence_id=sid, reason=duplicate))
                # A repeated ID has no independent review identity; retain only
                # the canonical row and record the second path in the audit.
                if sid in seen_ids:
                    continue
                row.update(status='excluded', reason=duplicate)
            seen_ids[sid] = relative
            seen_content.setdefault(content, relative)
            rows.append(row)
        except (ValueError, TypeError, KeyError, OSError, IndexError, AttributeError, OverflowError) as error:
            problems.append(dict(sample_path=relative, reason=str(error)))
    missing = sorted(existing.keys() - {r['sequence_id'] for r in rows})
    for sid in missing:
        problems.append(dict(sequence_id=sid, sample_path=existing[sid]['sample_path'], reason='previous manifest sample missing or invalid'))
    report = dict(filesScanned=len(paths), samples=len(rows), statusCounts=dict(Counter(r['status'] for r in rows)),
                  labelCounts=dict(sorted(Counter(r['label'] for r in rows).items())),
                  qualityFindings=sum(bool(r['quality_notes']) for r in rows), problems=problems)
    return rows, schema, report


def group_components(rows):
    """Connect signers AND source recordings; unknown signers need batch/session."""
    parents = {r['sequence_id']: r['sequence_id'] for r in rows}

    def find(key):
        while key != parents[key]:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key

    owners = {}
    for row in rows:
        tokens = []
        if row['signer_id']:
            tokens.append('signer:' + row['signer_id'])
        if row['source_recording']:
            tokens.append('recording:' + row['source_recording'])
        if row['collection_batch']:
            tokens.append('batch:' + row['collection_batch'])
        if row['recording_session']:
            tokens.append('session:' + row['recording_session'])
        if not tokens:
            raise ValueError(f"{row['sequence_id']}: supply an anonymous signer ID, source recording, session or batch")
        for token in tokens:
            if token in owners:
                parents[find(row['sequence_id'])] = find(owners[token])
            owners[token] = row['sequence_id']
    return {r['sequence_id']: find(r['sequence_id']) for r in rows}, owners


def assign_splits(rows, config):
    groups, owners = group_components(rows)
    wanted = config['splitGroups']
    if set(wanted) != set(SPLITS):
        raise ValueError('splitGroups must contain training, validation and test')
    assignments = {}
    for split in SPLITS:
        for token in wanted[split]:
            if token not in owners:
                raise ValueError(f'Unknown or unused split group: {token}')
            component = groups[owners[token]]
            if component in assignments and assignments[component] != split:
                raise ValueError(f'Related signer/recording/session/batch crosses splits: {token}')
            assignments[component] = split
    if set(groups.values()) - assignments.keys():
        raise ValueError('Approved samples have unassigned groups; explicitly update splitGroups for a new experiment')
    partitions = {split: [r for r in rows if assignments[groups[r['sequence_id']]] == split] for split in SPLITS}
    expected = set(config['labels'])
    for split, members in partitions.items():
        if {r['label'] for r in members} != expected:
            raise ValueError(f'{split}: every configured label needs approved samples in this split')
    return partitions


def raw_groups(sequence, order, length=40):
    vectors = np.asarray([f['features'] for f in sequence['frames']], dtype=float)
    return (resample_sequence(sequence['frames'], length, sequence['id']),
            resample_shape(handshape(vectors, order), length),
            resample_geometry(geometry(vectors, order), length))


def build_arrays(root, partitions, schema, length=40):
    """Match the existing 164 + 26 + 48 feature pipeline, including cast order."""
    values = {}
    for split in SPLITS:
        channels = [[], [], []]
        for row in partitions[split]:
            _, seq, checksum, _ = load_sample(root / row['sample_path'], row['label'])
            if checksum != row['sha256']:
                raise ValueError('Sample changed during preparation: ' + row['sample_path'])
            for channel, value in zip(channels, raw_groups(seq, schema['order'], length)):
                channel.append(value)
        values[split] = [np.stack(channel) for channel in channels]
    means = [x.mean(axis=(0, 1), keepdims=True) for x in values['training']]
    stds = [x.std(axis=(0, 1), keepdims=True) for x in values['training']]
    for std in stds:
        std[std < 1e-6] = 1
    arrays = {}
    for split, suffix in zip(SPLITS, SUFFIXES):
        arrays['X_' + suffix] = np.concatenate([((x - mean) / std).astype(np.float32)
                                               for x, mean, std in zip(values[split], means, stds)], axis=2)
    arrays['feature_mean'] = np.concatenate(means, axis=2).astype(np.float32)
    arrays['feature_std'] = np.concatenate(stds, axis=2).astype(np.float32)
    return arrays


def selected_manifest(root, labels):
    path = root / 'manifests' / 'training-samples.csv'
    if not path.exists():
        raise ValueError('Run sample_pipeline.py index --write and review the training manifest first')
    frozen = read_csv(path)
    current, schema, report = scan(root)
    # A malformed/new file is audited but never silently trained. Existing
    # approved files must still match the persisted manifest exactly.
    current_by_id = {r['sequence_id']: r for r in current}
    selected = []
    for sid, row in frozen.items():
        if row['status'] != 'approved' or row['label'] not in labels:
            continue
        now = current_by_id.get(sid)
        if now is None or any(now[k] != row[k] for k in FIELDS):
            raise ValueError(f'{sid}: approved manifest is stale; re-index and review')
        selected.append(row)
    if any(p.get('reason', '').startswith('duplicate ID') for p in report['problems']):
        raise ValueError('Resolve duplicate sample IDs before preparation')
    return selected, schema, report


def prepare(root, config_path, check_only=False):
    config = read_json(config_path)
    name = safe_name(config['name'])
    labels = config['labels']
    if not labels or len(set(labels)) != len(labels) or any(not isinstance(label, str) for label in labels):
        raise ValueError('labels must be a nonempty list of unique sign names')
    if config.get('frames', 40) != 40:
        raise ValueError('This baseline uses exactly 40 frames')
    rows, schema, report = selected_manifest(root, labels)
    include_signers = config.get('includeSignerIds')
    if include_signers is not None:
        if not include_signers or set(include_signers) - {r['signer_id'] for r in rows}:
            raise ValueError('includeSignerIds must list existing approved signer IDs')
        rows = [r for r in rows if r['signer_id'] in include_signers]
    partitions = assign_splits(rows, config)
    target = root / 'processed' / 'candidates' / name
    summary = dict(candidate=name, output=str(target), splitCounts={s: len(partitions[s]) for s in SPLITS},
                   featureCount=238, sequenceLength=40, audit=report)
    if target.exists() and not check_only:
        raise FileExistsError(f'Preserving existing candidate: {target}; choose a new version name')
    if check_only:
        return summary
    arrays = build_arrays(root, partitions, schema)
    label_map = {label: i for i, label in enumerate(sorted(labels))}
    for split, suffix in zip(SPLITS, SUFFIXES):
        arrays['y_' + suffix] = np.asarray([label_map[r['label']] for r in partitions[split]], dtype=np.int64)
    # Create only after all checks and feature extraction succeed.
    target.mkdir(parents=True, exist_ok=False)
    try:
        np.savez_compressed(target / 'gru_data.npz', **arrays)
        (target / 'samples.csv').write_text(csv_text(rows), encoding='utf-8', newline='')
        shutil.copy2(root / 'manifests' / 'training-samples.csv', target / 'review-manifest.csv')
        write_json(target / 'config.json', config)
        write_json(target / 'feature_schema.json', schema)
        write_json(target / 'audit.json', report)
        source_dir = target / 'source'
        source_dir.mkdir()
        for filename in ('sample_pipeline.py', 'preprocess_dataset.py', 'prepare_handshape_experiments.py',
                         'gesture_geometry.py', 'train_gru.py', 'sample_training.py',
                         'processed_paths.py', 'model_paths.py', 'requirements-ml.txt'):
            shutil.copy2(Path(__file__).with_name(filename), source_dir / filename)
        metadata = dict(metadataVersion=3, pipeline='sign-folder-manifest-v1', experiment=name,
                        featureCount=238, sequenceLength=40, labelToIndex=label_map,
                        geometryVersion=3, geometryFeatureNames=feature_names(), handshapeVersion=2,
                        standardizationFit='training subset only',
                        resampling='linear interpolation by frame index; collector normalization retained',
                        manifestAnnotationsUsed=True,
                        sequenceIds={s: [r['sequence_id'] for r in partitions[s]] for s in SPLITS},
                        signerIds={s: [r['signer_id'] for r in partitions[s]] for s in SPLITS},
                        split=dict(method='explicit connected signer/recording/session/batch groups',
                                   groups=config['splitGroups'],
                                   unseenSignerEvaluation=all(bool(r['signer_id']) for r in rows)),
                        sourceSha256={r['sample_path']: r['sha256'] for r in rows})
        metadata['artifactSha256'] = {p.relative_to(target).as_posix(): digest(p.read_bytes())
                                     for p in sorted(target.rglob('*')) if p.is_file()}
        write_json(target / 'metadata.json', metadata)
    except Exception:
        # Keep partial evidence for diagnosis; an incomplete candidate cannot
        # pass training validation (metadata.json is written last).
        raise
    return summary


def reproduce(root):
    """Rebuild v5 tensors directly from samples with its original ID ordering."""
    rows, schema, audit = scan(root)
    by_id = {r['sequence_id']: r for r in rows}
    if audit['problems']:
        raise ValueError('Resolve sample audit problems before baseline reproduction')
    results = []
    for path in sorted((root / 'processed/current/recordings_v5/folds').glob('*/metadata.json')):
        metadata = read_json(path)
        partitions = {s: [by_id[sid] for sid in metadata['sequenceIds'][s]] for s in SPLITS}
        # Also compare complete sequence and schema records to baseline sources.
        from processed_paths import resolve_artifact_path
        verified = set()
        for source in metadata['trainSources'] + [metadata['testSource']]:
            resolved = resolve_artifact_path(source)
            if digest(resolved.read_bytes()) != metadata['sourceSha256'][source]:
                raise ValueError('Baseline source hash changed: ' + source)
            original = read_json(resolved)
            if original['featureSchema'] != schema:
                raise ValueError('Baseline feature schema changed')
            for sequence in original['sequences']:
                if by_id[sequence['id']]['sequence_sha256'] != digest(canonical(sequence)):
                    raise ValueError('Baseline sample differs: ' + sequence['id'])
                verified.add(sequence['id'])
        if verified != {r['sequence_id'] for p in partitions.values() for r in p}:
            raise ValueError('Baseline ID selection differs')
        arrays = build_arrays(root, partitions, schema, metadata['sequenceLength'])
        with np.load(path.parent / 'gru_data.npz', allow_pickle=False) as saved:
            for split, suffix in zip(SPLITS, SUFFIXES):
                expected_labels = [metadata['labelToIndex'][r['label']] for r in partitions[split]]
                np.testing.assert_array_equal(expected_labels, saved['y_' + suffix])
            for key, value in arrays.items():
                np.testing.assert_array_equal(value, saved[key], err_msg=path.parent.name + ': ' + key)
        results.append(dict(fold=path.parent.name, samples=len(verified), exactArrays=True,
                            originalSplits=True, completeSequences=True))
        print('Verified baseline:', path.parent.name, flush=True)
    if len(results) != 3:
        raise ValueError('Expected all three current v5 folds')
    return dict(folds=results, trainingRun=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, default=ROOT)
    commands = parser.add_subparsers(dest='command', required=True)
    index = commands.add_parser('index', help='Audit samples and refresh review manifest')
    index.add_argument('--write', action='store_true')
    prep = commands.add_parser('prepare', help='Freeze a new processed candidate')
    prep.add_argument('--config', type=Path, required=True)
    prep.add_argument('--check-only', action='store_true')
    commands.add_parser('reproduce', help='Verify exact current v5 reproduction; no writes')
    args = parser.parse_args()
    root = args.dataset_root.resolve()
    if args.command == 'index':
        rows, _, report = scan(root)
        if args.write:
            directory = root / 'manifests'
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / 'training-samples.csv'
            if target.exists():
                backup = directory / 'backups' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
                backup.mkdir(parents=True)
                shutil.copy2(target, backup / target.name)
            temporary = target.with_suffix('.csv.tmp')
            temporary.write_text(csv_text(rows), encoding='utf-8', newline='')
            temporary.replace(target)
            write_json(directory / 'training-samples-audit.json', report)
        print(json.dumps(report, indent=2))
        if report['problems']:
            raise SystemExit(1)
    elif args.command == 'prepare':
        print(json.dumps(prepare(root, args.config, args.check_only), indent=2))
    else:
        print(json.dumps(reproduce(root), indent=2))


if __name__ == '__main__':
    main()
