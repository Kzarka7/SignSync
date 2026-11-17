"""Append the new E/X video clips and replace M images with reviewed video clips."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
from zipfile import ZipFile

import numpy as np
from sklearn.model_selection import train_test_split

from prepare_alphabet_video_replacements import representative_frame
from sample_pipeline import canonical
from train_alphabet import digest, write


def collect_archive(path, label, schema, retained, existing_features):
    archive_hash = digest(path)
    rows, features, existing_ids = {}, {}, set()
    with ZipFile(path) as archive:
        for member in archive.infolist():
            payload = archive.read(member)
            doc = json.loads(payload)
            sequence, = doc['sequences']
            source = sequence['videoImport']
            review = source['review']
            sid = sequence['id']
            assert doc['schemaVersion'] == doc['sequenceCount'] == 1 and doc['featureSchema'] == schema
            assert doc['labels'] == [label] and sequence['label'] == review['label'] == label
            assert source['reviewedAt'] and review['completeSign'] and review['qualityFindingsAccepted']
            assert all(source[key] == review[key] for key in ('trimStartMs', 'trimEndMs', 'processingVersion'))
            assert source['quality']['result'] in ('Pass', 'Review')
            assert sid not in rows and sid not in existing_ids
            sample_hash = hashlib.sha256(payload).hexdigest()
            if sid in retained:
                row = retained[sid]
                assert row['label'] == label and row['source_kind'] == 'video'
                assert row['sample_sha256'] == sample_hash and row['source_recording'] == source['fingerprint']
                assert sid in existing_features
                row.update(source_archive=str(path), archive_sha256=archive_hash, member=member.filename)
                existing_ids.add(sid)
                continue
            frames = sequence['frames']
            assert len(frames) == sequence['frameCount'] and source['origin'] == 'camera-recording'
            index, values, variation = representative_frame(frames)
            content = [{key: frame[key] for key in ('timestamp', 'features', 'valid')} for frame in frames]
            rows[sid] = dict(id=sid, kind='static', source_kind='video', label=label, included=True,
                             source_archive=str(path), archive_sha256=archive_hash, member=member.filename,
                             sample_sha256=sample_hash, content_sha256=hashlib.sha256(canonical(content)).hexdigest(),
                             source_recording=source['fingerprint'], source_filename=source['filename'],
                             signer_id=None, session_id=None, collection_batch='collector-camera-2026-11-11',
                             reviewed_at=source['reviewedAt'], collector_quality=source['quality'],
                             frame_count=len(frames), selected_frame_index=int(index),
                             selected_timestamp_ms=frames[index]['timestamp'],
                             selected_source_timestamp_ms=frames[index]['sourceTimestampMs'],
                             local_handshape_rms=variation)
            features[sid] = values
    return rows, features, existing_ids


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('dataset-root', 'base', 'baseline-run', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    root, base, baseline, output = (p.resolve() for p in (args.dataset_root, args.base, args.baseline_run, args.output))
    if output.exists():
        raise FileExistsError(output)
    checksums = json.loads((base / 'artifact_checksums.json').read_bytes())
    static_input = 'static-24/raw_static_features.npz'
    static_manifest = 'static-24/manifest.jsonl'
    reuse = ['static-24/feature_schema.json', 'static-24/labels.json', 'labels.json']
    reuse += [name for name in checksums if name.startswith('temporal-jz/')]
    for name in [*reuse, static_input, static_manifest]:
        assert digest(base / name) == checksums[name], name
    previous_checksums = json.loads((baseline / 'artifact_checksums.json').read_bytes())
    assert digest(baseline / 'metadata.json') == previous_checksums['metadata.json']
    previous = json.loads((baseline / 'metadata.json').read_bytes())
    assert previous['seed'] == 43
    for name, checksum in previous['sourceSha256'].items():
        assert digest(base / name) == checksum, name
    schema = json.loads((base / 'temporal-jz/collector_feature_schema.json').read_bytes())
    with (base / static_manifest).open(encoding='utf-8') as handle:
        rows = {row['id']: row for row in map(json.loads, handle)}
    removed = {sid for sid, row in rows.items() if row['label'] == 'M'}
    assert len(removed) == 306 and all(rows[sid].get('source_kind') != 'video' for sid in removed)
    retained = {sid: row for sid, row in rows.items() if sid not in removed}
    with np.load(base / static_input, allow_pickle=False) as arrays:
        labels = arrays['labels']
        features = {sid: x for sid, x in zip(arrays['sample_ids'], arrays['X']) if sid not in removed}
    assert set(features) == set(retained)
    partitions = {split: [sid for sid in ids if sid not in removed] for split, ids in previous['sequenceIds'].items()}
    new_counts, hand_counts, warnings = {}, {}, {}
    for label, added in [('E', 40), ('M', 100), ('X', 40)]:
        directory = root / 'raw/image-datasets/alphabet-v1' / label
        if label != 'M':
            directory /= 'combined'
        archive, = sorted(directory.glob(f'signsync-dataset-{label.lower()}-100x-*-samples.zip'))
        new_rows, new_features, matched = collect_archive(archive, label, schema, retained, features)
        assert len(new_rows) == added and len(matched) == 100 - added
        assert matched == {sid for sid, row in retained.items() if row['label'] == label}
        ids = sorted(new_rows)
        hands = {sid: tuple(new_features[sid][[0, 64]].astype(int)) for sid in ids}
        assert all(hand in ((1, 0), (0, 1)) for hand in hands.values())
        side = {sid: 'left' if hand[0] else 'right' for sid, hand in hands.items()}
        train, other = train_test_split(ids, train_size=added * 60 // 100, random_state=43,
                                        stratify=[side[sid] for sid in ids])
        validation, test = train_test_split(other, train_size=added * 15 // 100, random_state=43,
                                            stratify=[side[sid] for sid in other])
        for split, members in zip(partitions, (train, validation, test)):
            partitions[split].extend(members)
        retained.update(new_rows)
        features.update(new_features)
        new_counts[label] = added
        hand_counts[label] = dict(Counter(side.values()))
        warnings[label] = sum(row['collector_quality']['result'] == 'Review' for row in new_rows.values())
        assert [sum(retained.get(sid, {}).get('label') == label for sid in ids)
                for ids in partitions.values()] == [60, 15, 25]
        print('Verified', label, len(matched), 'retained and', added, 'new clips', flush=True)
    video = [row for row in retained.values() if row.get('source_kind') == 'video']
    for field in ('source_recording', 'content_sha256'):
        distinct = {row[field] for row in video}
        assert all(distinct) and len(distinct) == len(video), field
    assert not removed.intersection(retained)
    assert [len(ids) for ids in partitions.values()] == [4236, 1059, 1766]
    for split, members in partitions.items():
        for sid in members:
            if sid in retained:
                retained[sid]['split'] = split

    (output / 'static-24').mkdir(parents=True)
    for name in reuse:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(base / name, target)
    ids = list(features)
    label_index = {label: i for i, label in enumerate(labels)}
    np.savez_compressed(output / static_input, X=np.stack([features[sid] for sid in ids]),
                        y=np.asarray([label_index[retained[sid]['label']] for sid in ids]),
                        sample_ids=np.asarray(ids), labels=labels)
    with (output / static_manifest).open('w', encoding='utf-8') as handle:
        for sid in ids:
            handle.write(json.dumps(retained[sid], allow_nan=False) + '\n')
    write(output / 'split_assignments.json',
          dict(method='60/15/25 per new letter, with prior split assignments preserved for retained clips',
               keepVideoBatchesTogether=False, assignmentSeed=43, sequenceIds=partitions))
    write(output / 'replacement_receipt.json',
          dict(base=str(base), baseline=str(baseline), removedMImages=len(removed), addedVideos=new_counts,
               detectedHands=hand_counts, acceptedCollectorWarnings=warnings,
               splitCounts={key: len(ids) for key, ids in partitions.items()},
               limitations=['New clips are split by clip and stratified by detected hand. Splits can share a recording batch.',
                            'Frame selection uses landmark stability and existing collector approvals.']))
    shutil.copy2(__file__, output / Path(__file__).name)
    write(output / 'artifact_checksums.json',
          {p.relative_to(output).as_posix(): digest(p) for p in output.rglob('*') if p.is_file()})


if __name__ == '__main__':
    main()
