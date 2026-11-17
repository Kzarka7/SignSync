"""Prepare the eight steady-letter video replacements for the seed-43 alphabet dataset."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile

import numpy as np

from image_landmarks import static_features
from sample_pipeline import canonical
from train_alphabet import digest, load_prepared, prepare_dataset, write


REPLACED = 'BEFLUVWX'
# Collector export timestamps in UTC. Each batch contains all eight letters.
BATCHES = {
    '2026-11-09T15': ('uploaded-webcam', 'training'),
    '2026-11-10T06': ('uploaded-numbered', 'validation'),
    '2026-11-10T07': ('uploaded-numbered', 'validation'),
    '2026-11-10T18': ('collector-camera', 'test'),
}


def representative_frame(frames):
    times = np.asarray([f['timestamp'] for f in frames])
    duration = times[-1] - times[0]
    assert len(frames) >= 8 and np.isfinite(times).all() and np.all(np.diff(times) > 0)
    assert duration >= 400
    features = np.asarray([static_features(f['raw']) for f in frames])
    presence = features[:, [0, 64]]
    assert np.isfinite(features).all()
    usable = np.asarray([f['valid'] for f in frames]) & presence.any(axis=1)
    assert usable.mean() >= .8
    middle = times[0] + duration / 2
    central = np.flatnonzero(usable & (abs(times - middle) <= .3 * duration))
    common_hands = Counter(map(tuple, presence[central])).most_common(1)[0][0]
    same_hands = (presence == common_hands).all(axis=1)
    candidates = []
    for i in central[same_hands[central]]:
        neighborhood = abs(times - times[i]) <= 150
        if neighborhood.sum() < 5 or not np.all((usable & same_hands)[neighborhood]):
            continue
        local = features[neighborhood]
        variation = float(np.sqrt(np.mean((local - np.median(local, axis=0)) ** 2)))
        candidates.append((variation, abs(times[i] - middle), i))
    if not candidates:
        raise ValueError('No usable central frame with a consistent tracked hand')
    variation, _, index = min(candidates)
    return index, features[index].astype(np.float32), variation


def collect_video_samples(root, schema):
    rows, inputs, archives = [], [], {}
    for label in REPLACED:
        directory = root / 'raw/image-datasets/alphabet-v1' / label
        for path in sorted(directory.glob(f'signsync-dataset-{label.lower()}-60x-*-samples.zip')):
            archives[str(path)] = digest(path)
            with ZipFile(path) as archive:
                for member in archive.infolist():
                    assert member.filename.endswith('.json') and not member.is_dir()
                    payload = archive.read(member)
                    doc = json.loads(payload)
                    sequence, = doc['sequences']
                    source = sequence['videoImport']
                    review = source['review']
                    assert doc['schemaVersion'] == doc['sequenceCount'] == 1
                    assert doc['featureSchema'] == schema and doc['labels'] == [label]
                    assert sequence['label'] == review['label'] == label
                    assert source['reviewedAt'] and review['completeSign'] and review['qualityFindingsAccepted']
                    assert all(source[key] == review[key] for key in ('trimStartMs', 'trimEndMs', 'processingVersion'))
                    assert source['quality']['result'] in ('Pass', 'Review')
                    batch, split = BATCHES[sequence['createdAt'][:13]]
                    assert source['origin'] == ('camera-recording' if split == 'test' else 'uploaded-file')
                    frames = sequence['frames']
                    assert len(frames) == sequence['frameCount']
                    index, values, variation = representative_frame(frames)
                    content = [{key: frame[key] for key in ('timestamp', 'features', 'valid')} for frame in frames]
                    rows.append(dict(id=sequence['id'], kind='static', source_kind='video', label=label,
                                     included=True, split=split, source_archive=str(path),
                                     archive_sha256=archives[str(path)], member=member.filename,
                                     sample_sha256=hashlib.sha256(payload).hexdigest(),
                                     content_sha256=hashlib.sha256(canonical(content)).hexdigest(),
                                     source_recording=source['fingerprint'], source_filename=source['filename'],
                                     signer_id=None, session_id=None, collection_batch=batch,
                                     reviewed_at=source['reviewedAt'], collector_quality=source['quality'],
                                     frame_count=len(frames), selected_frame_index=int(index),
                                     selected_timestamp_ms=frames[index]['timestamp'],
                                     selected_source_timestamp_ms=frames[index]['sourceTimestampMs'],
                                     local_handshape_rms=variation))
                    inputs.append(values)
    assert Counter((r['label'], r['split']) for r in rows) == {
        (label, split): 20 for label in REPLACED for split in ('training', 'validation', 'test')}
    for field in ('id', 'source_recording', 'content_sha256'):
        unique = {row[field] for row in rows}
        assert all(unique) and len(unique) == len(rows), field
    return rows, np.stack(inputs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dataset-root', type=Path, required=True)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--baseline-run', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root, base, baseline, output = (p.resolve() for p in
                                    (args.dataset_root, args.base, args.baseline_run, args.output))
    if output.exists():
        raise FileExistsError(output)
    checksums = json.loads((base / 'artifact_checksums.json').read_bytes())
    reuse = ['static-24/feature_schema.json', 'static-24/labels.json', 'labels.json']
    reuse += [name for name in checksums if name.startswith('temporal-jz/')]
    static_input = 'static-24/raw_static_features.npz'
    static_manifest = 'static-24/manifest.jsonl'
    for name in [*reuse, static_input, static_manifest]:
        if digest(base / name) != checksums[name]:
            raise ValueError('Base artifact checksum mismatch: ' + name)
    _, _, _, _, _, metadata, _ = load_prepared(baseline)
    assert metadata['seed'] == 43
    assert all(checksums[name] == value for name, value in metadata['sourceSha256'].items())
    schema = json.loads((base / 'temporal-jz/collector_feature_schema.json').read_bytes())
    video_rows, video_x = collect_video_samples(root, schema)
    with np.load(base / static_input, allow_pickle=False) as old:
        labels = old['labels'].tolist()
        keep = ~np.isin(old['labels'][old['y']], list(REPLACED))
        excluded = set(old['sample_ids'][~keep].tolist())
        removed = Counter(old['labels'][old['y'][~keep]].tolist())
        ids = np.concatenate([old['sample_ids'][keep], [r['id'] for r in video_rows]])
        x = np.concatenate([old['X'][keep], video_x])
        y = np.concatenate([old['y'][keep], [labels.index(r['label']) for r in video_rows]])
    with (base / static_manifest).open(encoding='utf-8') as handle:
        retained = [row for row in map(json.loads, handle) if row['included'] and row['label'] not in REPLACED]
    assert set(ids.tolist()) == {row['id'] for row in [*retained, *video_rows]}
    assert set(REPLACED) == set(removed) and not excluded.intersection(ids)
    splits = {split: [sid for sid in members if sid not in excluded]
              + [row['id'] for row in video_rows if row['split'] == split]
              for split, members in metadata['sequenceIds'].items()}

    (output / 'static-24').mkdir(parents=True)
    for name in reuse:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(base / name, target)
    np.savez_compressed(output / static_input, X=x, y=y, sample_ids=ids, labels=np.asarray(labels))
    with (output / static_manifest).open('w', encoding='utf-8') as handle:
        for row in [*retained, *video_rows]:
            handle.write(json.dumps(row, allow_nan=False) + '\n')
    write(output / 'split_assignments.json',
          dict(method='seed-43 partitions for retained samples; collector batches for video replacements',
               sequenceIds=splits))
    write(output / 'replacement_receipt.json',
          dict(base=str(base), baseline=str(baseline), removedPreparedImages=dict(removed),
               addedVideos=dict(Counter(row['label'] for row in video_rows)),
               acceptedCollectorWarnings=dict(Counter(row['label'] for row in video_rows
                                                      if row['collector_quality']['result'] == 'Review')),
               frameSelection='One observed frame with the lowest local normalized landmark variation in the central 60% of each reviewed interval.',
               batchAssignments=BATCHES, splitCounts={key: len(value) for key, value in splits.items()},
               limitations=['Batches are inferred from collector timestamps and source origin. Signer and session identities are unavailable.',
                            'Frame choice uses landmark stability and the existing collector review. No new visual review was performed.']))
    shutil.copy2(__file__, output / Path(__file__).name)
    write(output / 'artifact_checksums.json',
          {p.relative_to(output).as_posix(): digest(p) for p in output.rglob('*') if p.is_file()})
    prepare_dataset(output, output / 'frozen')
    load_prepared(output / 'frozen')
    print('Prepared', output, {key: len(value) for key, value in splits.items()}, flush=True)


if __name__ == '__main__':
    main()
