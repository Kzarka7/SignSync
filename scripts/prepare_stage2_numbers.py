"""Freeze the November 7–8 reviewed numbers and unchanged approved TEN for Stage 2."""

import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np

from prepare_alphabet_j_refresh import digest, write
from sample_pipeline import canonical


LABELS = 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN'.split()
PACKAGE = 'stage2_numbers_revised_20261108'


def require(condition, source, reason):
    if not condition:
        raise ValueError(f'{source}: {reason}')


def inspect_member(payload, label, schema, source):
    export = json.loads(payload)
    require(export['schemaVersion'] == 1 and export['sequenceCount'] == 1
            and len(export['sequences']) == 1 and export['labels'] == [label]
            and export['featureSchema'] == schema, source, 'collector schema mismatch')
    sequence = export['sequences'][0]
    frames, video = sequence['frames'], sequence['videoImport']
    require(sequence['label'] == label and bool(sequence['id'])
            and len(frames) == sequence['frameCount'] >= 10, source, 'bad label, ID or frame count')
    review, quality = video['review'], video['quality']
    require(review['protocol'] == 'video-training-review-v1' and review['label'] == label
            and review['completeSign'] is True and review['qualityFindingsAccepted'] is True
            and bool(video['reviewedAt'])
            and all(review[key] == video[key] for key in ('trimStartMs', 'trimEndMs', 'processingVersion'))
            and quality['result'] in ('Pass', 'Review') and quality['totalFrames'] == len(frames),
            source, 'review or quality record does not match the saved clip')
    features = np.asarray([frame['features'] for frame in frames], dtype=np.float64)
    timestamps = np.asarray([frame['timestamp'] for frame in frames], dtype=np.float64)
    source_times = np.asarray([frame['sourceTimestampMs'] for frame in frames], dtype=np.float64)
    valid = np.asarray([frame['valid'] for frame in frames])
    require(features.shape == (len(frames), 164) and np.isfinite(features).all()
            and np.isfinite(features.astype(np.float32)).all() and valid.dtype == np.bool_
            and np.isfinite(timestamps).all() and np.isfinite(source_times).all()
            and np.all(np.diff(timestamps) > 0) and np.all(np.diff(source_times) > 0)
            and np.allclose(source_times - video['trimStartMs'], timestamps, rtol=0, atol=.001)
            and source_times[-1] <= video['trimEndMs'] + .001
            and abs(sequence['durationMs'] - (timestamps[-1] - timestamps[0])) <= 1,
            source, 'bad landmarks, timing or validity flags')
    hands = features[:, [36, 100]]
    require(np.isin(hands, [0, 1]).all() and np.any(hands, axis=1).mean() >= .5,
            source, 'insufficient hand tracking')
    fingerprint = video['fingerprint'].lower()
    require(len(fingerprint) == 64 and all(c in '0123456789abcdef' for c in fingerprint),
            source, 'missing or invalid source fingerprint')
    content = hashlib.sha256(canonical([
        {key: frame[key] for key in ('timestamp', 'features', 'valid')} for frame in frames
    ])).hexdigest()
    row = dict(sequence_id=sequence['id'], label=label, source_recording=fingerprint,
               source_filename=video['filename'], sample_sha256=hashlib.sha256(payload).hexdigest(),
               content_sha256=content, frame_count=len(frames), duration_ms=sequence['durationMs'],
               left_frames=int(hands[:, 0].sum()), right_frames=int(hands[:, 1].sum()),
               both_frames=int(hands.all(axis=1).sum()), no_hand_frames=int((~hands.any(axis=1)).sum()),
               quality=quality['result'], warnings=quality['findings'] if quality['result'] == 'Review' else [],
               review_status='collector-confirmed', reviewed_at=video['reviewedAt'],
               trim_start_ms=video['trimStartMs'], trim_end_ms=video['trimEndMs'],
               processing_version=video['processingVersion'])
    return row, (features.astype(np.float32), timestamps, source_times, valid)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, required=True)
    args = parser.parse_args()
    root = args.dataset_root.resolve()
    output = root / 'processed/candidates' / PACKAGE
    require(not output.exists(), output, 'output already exists')
    baseline = root / 'processed/image-datasets/alphabet-v2-j460'
    schema = json.loads((baseline / 'temporal-jz/collector_feature_schema.json').read_bytes())
    alphabet = [json.loads(line) for line in (baseline / 'temporal-jz/manifest.jsonl').read_text(encoding='utf-8').splitlines()]
    fields = ('sequence_id', 'content_sha256', 'source_recording')
    seen = {field: {row[field] for row in alphabet if row.get(field)} for field in fields}
    with (root / 'manifests/training-samples.csv').open(encoding='utf-8-sig', newline='') as handle:
        legacy = list(csv.DictReader(handle))
    old_sources = {row['source_recording']: row for row in legacy if row['source_recording']}
    approved_ten = {row['sequence_id']: row for row in legacy if row['label'] == 'TEN' and row['status'] == 'approved'}
    manifests, arrays, archives = [], [], {}
    for label in LABELS:
        folder = root / 'raw/processed-samples/NUMBERS' / label
        paths = sorted(path for path in folder.glob('*.zip')
                       if label == 'TEN' or any(date in path.name for date in ('2026-11-07', '2026-11-08')))
        require(paths, folder, 'no matching archives')
        for path in paths:
            relative = path.relative_to(root).as_posix()
            archives[relative] = digest(path)
            with ZipFile(path) as archive:
                for member in archive.infolist():
                    if member.is_dir():
                        continue
                    source = f'{relative}::{member.filename}'
                    row, data = inspect_member(archive.read(member), label, schema, source)
                    for field in fields:
                        require(row[field] not in seen[field], source, f'duplicate or alphabet overlap in {field}')
                        seen[field].add(row[field])
                    prior = old_sources.get(row['source_recording'])
                    if prior:
                        require(prior['label'] == label and prior['status'] == 'approved', source,
                                'recording fingerprint conflicts with prior label or approval')
                    if label == 'TEN':
                        original = approved_ten.pop(row['sequence_id'], {})
                        require(original.get('sha256') == row['sample_sha256']
                                and digest(root / original['sample_path']) == row['sample_sha256'],
                                source, 'TEN differs from the approved sample')
                    row.update(archive=relative, member=member.filename,
                               prior_sequence_id=prior['sequence_id'] if prior else None,
                               collection_batch=prior['collection_batch'] if prior else None,
                               signer_id=prior['signer_id'] or None if prior else None,
                               recording_session=prior['recording_session'] or None if prior else None,
                               selection='unchanged-approved' if label == 'TEN' else 'revised')
                    manifests.append(row)
                    arrays.append(data)
        print(label, sum(row['label'] == label for row in manifests), flush=True)
    require(not approved_ten, output, 'approved TEN records are missing')
    counts = Counter(row['label'] for row in manifests)
    summary = {label: dict(clips=counts[label],
                           quality=dict(Counter(row['quality'] for row in manifests if row['label'] == label)),
                           prior_fingerprint_matches=sum(bool(row['prior_sequence_id']) for row in manifests if row['label'] == label),
                           min_frames=min(row['frame_count'] for row in manifests if row['label'] == label),
                           max_frames=max(row['frame_count'] for row in manifests if row['label'] == label))
               for label in LABELS}
    output.mkdir()
    (output / 'manifest.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in manifests), encoding='utf-8')
    offsets = np.concatenate(([0], np.cumsum([row['frame_count'] for row in manifests], dtype=np.int64)))
    features, timestamps, source_times, valid = map(np.concatenate, zip(*arrays))
    np.savez_compressed(output / 'raw_sequences.npz', X=features, timestamps_ms=timestamps,
                        source_timestamps_ms=source_times, valid=valid, offsets=offsets,
                        y=np.asarray([LABELS.index(row['label']) for row in manifests], dtype=np.int64),
                        labels=LABELS, sample_ids=[row['sequence_id'] for row in manifests])
    write(output / 'feature_schema.json', schema)
    write(output / 'audit.json', dict(counts=summary, archive_sha256=archives,
                                     alphabet_source=baseline.relative_to(root).as_posix(),
                                     alphabet_manifest_sha256=digest(baseline / 'temporal-jz/manifest.jsonl'),
                                     split=None, scaler=None,
                                     selection='Revised ONE through NINE only, plus unchanged approved TEN.'))
    write(output / 'artifact_checksums.json', {path.name: digest(path) for path in sorted(output.iterdir())})
    print(f'Prepared {len(manifests)} sequences and {len(features)} frames in {output}')


if __name__ == '__main__':
    main()
