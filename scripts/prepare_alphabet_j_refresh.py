"""Replace prepared J with reviewed raw/J samples; preserve static letters and Z."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile

import numpy as np
from sample_pipeline import canonical, raw_groups


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def hand_input(sequence):
    vectors = np.asarray([f['features'] for f in sequence['frames']], dtype=np.float64)
    values = np.zeros((len(vectors), 128))
    for source, target in ((36, 0), (100, 64)):
        points = vectors[:, source + 1:source + 64].reshape((-1, 21, 3))
        scale = np.linalg.norm(points[:, 9] - points[:, 0], axis=1)
        valid = (vectors[:, source] == 1) & (scale > 1e-6)
        values[valid, target] = 1
        values[valid, target + 1:target + 64] = ((points[valid] - points[valid, :1]) / scale[valid, None, None]).reshape((-1, 63))
    positions = np.linspace(0, len(values) - 1, 40)
    result = np.stack([np.interp(positions, np.arange(len(values)), values[:, i]) for i in range(128)], axis=1)
    for target in (0, 64):
        result[result[:, target] < .999999, target:target + 64] = 0
    return result.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, required=True)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root, base, output = [p.resolve() for p in (args.dataset_root, args.base, args.output)]
    if output.exists():
        raise FileExistsError(output)
    checksums = json.loads((base / 'artifact_checksums.json').read_bytes())
    reusable = ['static-24/' + name for name in ('raw_static_features.npz', 'manifest.jsonl', 'feature_schema.json', 'labels.json', 'approval_receipt.json')]
    reusable += ['temporal-jz/' + name for name in ('raw_sequences.npz', 'manifest.jsonl', 'feature_schema.json', 'collector_feature_schema.json')]
    for name in reusable:
        assert digest(base / name) == checksums.get(name, checksums.get(name.replace('/', '\\'))), name
    schema = json.loads((base / 'temporal-jz/collector_feature_schema.json').read_bytes())
    old_rows = [json.loads(line) for line in (base / 'temporal-jz/manifest.jsonl').read_text(encoding='utf-8').splitlines()]
    with np.load(base / 'temporal-jz/raw_sequences.npz', allow_pickle=False) as arrays:
        assert arrays['labels'].tolist() == ['J', 'Z']
        assert arrays['sample_ids'].tolist() == [r['sequence_id'] for r in old_rows]
        selected = np.flatnonzero(arrays['y'] == 1)
        z_geometry, z_hand = arrays['X_geometry'][selected].copy(), arrays['X_hand'][selected].copy()
        z_ids = arrays['sample_ids'][selected].tolist()
    old_z = {r['sequence_id']: r for r in old_rows if r['label'] == 'Z'}
    assert len(old_z) == len(z_ids) == 450
    rows, geometry, hands, archives = [], [], [], {}
    for archive in sorted((root / 'raw/J').glob('*.zip')):
        archive_hash = digest(archive)
        archives[str(archive)] = archive_hash
        with ZipFile(archive) as z:
            for member in z.infolist():
                if member.is_dir():
                    continue
                assert member.filename.endswith('.json')
                payload = z.read(member)
                doc = json.loads(payload)
                assert doc['schemaVersion'] == 1 and doc['sequenceCount'] == len(doc['sequences']) == 1
                assert doc['labels'] == ['J'] and doc['featureSchema'] == schema
                sequence = doc['sequences'][0]
                frames, source = sequence['frames'], sequence['videoImport']
                review = source['review']
                assert sequence['label'] == review['label'] == 'J'
                assert source['reviewedAt'] and review['completeSign'] is True and review['qualityFindingsAccepted'] is True
                assert source['trimStartMs'] == review['trimStartMs'] and source['trimEndMs'] == review['trimEndMs']
                assert source['processingVersion'] == review['processingVersion']
                assert source['quality']['result'] in ('Pass', 'Review')
                vectors = np.asarray([f['features'] for f in frames], dtype=float)
                times = np.asarray([f['timestamp'] for f in frames])
                assert vectors.shape == (sequence['frameCount'], 164) and len(frames) >= 8
                assert np.isfinite(vectors).all() and np.isfinite(times).all()
                assert (np.diff(times) > 0).all() and times[-1] - times[0] >= 400
                assert np.isin(vectors[:, [36, 100]], [0, 1]).all()
                assert np.mean([f['valid'] for f in frames]) >= .8
                assert np.mean(vectors[:, [36, 100]].max(axis=1)) >= .5
                identity = hashlib.sha256(canonical([{k: f[k] for k in ('timestamp', 'features', 'valid')} for f in frames])).hexdigest()
                rows.append(dict(sequence_id=sequence['id'], label='J', source_archive=str(archive), archive_sha256=archive_hash,
                    member=member.filename, sample_sha256=hashlib.sha256(payload).hexdigest(), content_sha256=identity,
                    source_recording=source['fingerprint'], source_filename=source['filename'], signer_id=None,
                    recording_session=None, collection_batch=archive.stem, frame_count=len(frames),
                    review_status='collector-confirmed', complete_sign=True, collector_quality=source['quality']['result'],
                    tracking_warnings=source['quality']['findings'] if source['quality']['result'] == 'Review' else [],
                    quality_findings_accepted=True, reviewed_at=source['reviewedAt'], split='training_pool',
                    timestamps='original collector timestamps', dominant_tracked_hand='left' if vectors[:, 36].sum() > vectors[:, 100].sum() else 'right'))
                geometry.append(np.concatenate(raw_groups(sequence, schema['order']), axis=1).astype(np.float32))
                hands.append(hand_input(sequence))
        print('Verified J archive', archive.name, flush=True)
    assert len(rows) == 460
    # Relink preserved Z IDs/features to their current, byte-verified archive.
    z_matches = {}
    for archive in sorted((root / 'raw/image-datasets/alphabet-v1/Z').glob('*.zip')):
        archives[str(archive)] = digest(archive)
        with ZipFile(archive) as z:
            for member in z.infolist():
                if member.is_dir() or not member.filename.endswith('.json'):
                    continue
                payload = z.read(member)
                sequence = json.loads(payload)['sequences'][0]
                sid = sequence['id']
                assert sid in old_z and sid not in z_matches
                assert hashlib.sha256(payload).hexdigest() == old_z[sid]['sample_sha256']
                z_matches[sid] = dict(old_z[sid], previous_source_archive=old_z[sid]['source_archive'],
                    source_archive=str(archive), archive_sha256=archives[str(archive)], member=member.filename)
    assert set(z_matches) == set(z_ids)
    rows.extend(z_matches[sid] for sid in z_ids)
    for field in ('sequence_id', 'content_sha256', 'source_recording'):
        values = [r[field] for r in rows]
        assert all(values) and len(set(values)) == len(values), 'Duplicate or missing ' + field
    xg, xh = np.concatenate([np.stack(geometry), z_geometry]), np.concatenate([np.stack(hands), z_hand])
    assert xg.shape == (910, 40, 238) and xh.shape == (910, 40, 128)
    assert np.isfinite(xg).all() and np.isfinite(xh).all()
    output.mkdir(parents=True)
    for name in reusable:
        if name.startswith('static-24/') or name.endswith('feature_schema.json'):
            target = output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(base / name, target)
    target = output / 'temporal-jz'
    np.savez_compressed(target / 'raw_sequences.npz', X_geometry=xg, X_hand=xh,
        y=np.asarray([0] * 460 + [1] * 450), sample_ids=np.asarray([r['sequence_id'] for r in rows]), labels=np.asarray(['J', 'Z']))
    (target / 'manifest.jsonl').write_text(''.join(json.dumps(r, allow_nan=False) + '\n' for r in rows), encoding='utf-8')
    write(target / 'archive_checksums.json', archives)
    write(output / 'labels.json', {label: i for i, label in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ')})
    write(output / 'replacement_receipt.json', dict(base=str(base), baseChecksumsSha256=digest(base / 'artifact_checksums.json'),
        policy='All old prepared J IDs removed; only current raw/J archives included. Static letters and Z retained.',
        counts=dict(static=9180, J=460, Z=450, total=10090), excludedOldJIds=[r['sequence_id'] for r in old_rows if r['label'] == 'J'],
        jHandCounts=dict(Counter(r['dominant_tracked_hand'] for r in rows if r['label'] == 'J')),
        acceptedWarningIds=[r['sequence_id'] for r in rows if r['label'] == 'J' and r['collector_quality'] == 'Review'],
        limitations=['Signer/session identities unavailable; source fingerprints prevent repeated files crossing splits, not related recordings or unseen signer leakage.',
            'Retains mixed single-frame static and 40-frame temporal representation; does not resolve known architecture/trajectory limitations.']))
    shutil.copy2(__file__, output / Path(__file__).name)
    write(output / 'artifact_checksums.json', {p.relative_to(output).as_posix(): digest(p) for p in output.rglob('*') if p.is_file()})
    print('COMPLETE replacement source package', output, flush=True)


if __name__ == '__main__':
    main()
