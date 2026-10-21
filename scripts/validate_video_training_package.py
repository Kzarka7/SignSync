"""Validate a reviewed video ZIP and smoke-check the existing training loaders.

No training, split inference, interpolation-policy changes, or model promotion.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tempfile
import zipfile
from datetime import datetime

import numpy as np
from preprocess_dataset import load_export, resample_sequence
from run_recordings_v5_experiments import raw_geometry_features

POSE_NAMES = ('nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip')
HAND_NAMES = ('wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip', 'index_mcp', 'index_pip', 'index_dip', 'index_tip',
              'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip', 'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip', 'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip')


def expected_order():
    result = [f'pose.{name}.{axis}' for name in POSE_NAMES for axis in ('x', 'y', 'z', 'visibility')]
    for side in ('leftHand', 'rightHand'):
        result.append(side + '.present')
        result.extend(f'{side}.{name}.{axis}' for name in HAND_NAMES for axis in ('x', 'y', 'z'))
    return result


def validate_frame(frame, allow_missing_hands=False):
    """Verify the browser's established 164-feature transform and missingness flags."""
    raw = frame['raw']
    pose = raw['pose']
    hands = [raw[side] for side in ('leftHand', 'rightHand')]
    for hand in hands:
        if hand is not None and (len(hand) != 21 or not np.isfinite([[p[a] for a in ('x', 'y', 'z')] for p in hand]).all()):
            raise ValueError('Malformed hand observations')
    if pose is not None and not np.isfinite([[pose[name][axis] for axis in ('x', 'y', 'z')] + [pose[name].get('visibility', 0)] for name in POSE_NAMES]).all():
        raise ValueError('Malformed pose observations')
    scale = np.linalg.norm([pose['leftShoulder'][a] - pose['rightShoulder'][a] for a in ('x', 'y', 'z')]) if pose else 0
    valid = bool(pose is not None and np.isfinite(scale) and scale >= .02)
    expected = []
    if valid:
        origin = [(pose['leftShoulder'][a] + pose['rightShoulder'][a]) / 2 for a in ('x', 'y')]
        def point(p):
            return [(p['x'] - origin[0]) / scale, (p['y'] - origin[1]) / scale, p['z'] / scale]
        for name in POSE_NAMES:
            expected.extend(point(pose[name]) + [pose[name].get('visibility', 0)])
        for hand in hands:
            expected.append(1 if hand is not None else 0)
            expected.extend([value for p in hand for value in point(p)] if hand is not None else [0] * 63)
    else:
        expected = [0] * 164
    if frame.get('valid') is not valid or len(frame['features']) != 164 or not np.allclose(frame['features'], expected, rtol=1e-6, atol=1e-6):
        raise ValueError('Exported features or presence flags differ from raw observations')
    return valid and (allow_missing_hands or any(hand is not None for hand in hands)) and all(pose[name].get('visibility', 0) >= .5 for name in ('leftShoulder', 'rightShoulder'))


def validate(path, assignments=None):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        required = {'dataset.json', 'manifest.json', 'acceptance-report.json', 'README.md', 'checksums.json'}
        if len(names) != len(set(names)) or set(names) != required:
            raise ValueError('Unexpected or duplicate package entries')
        contents = {name: archive.read(name) for name in required}
    checksums = json.loads(contents['checksums.json'])
    if set(checksums) != required - {'checksums.json'}:
        raise ValueError('Checksum manifest does not cover all payload files')
    for name, expected in checksums.items():
        if hashlib.sha256(contents[name]).hexdigest() != expected:
            raise ValueError(f'Checksum mismatch: {name}')
    manifest = json.loads(contents['manifest.json'])
    report = json.loads(contents['acceptance-report.json'])
    if manifest.get('packageVersion') != 'video-training-package-v1' or report.get('packageVersion') != manifest['packageVersion']:
        raise ValueError('Unsupported package version')
    # Write only a fixed filename into a fresh temporary folder; never extract ZIP paths.
    with tempfile.TemporaryDirectory(prefix='signsync-package-check-') as folder:
        dataset_file = Path(folder) / 'dataset.json'
        dataset_file.write_bytes(contents['dataset.json'])
        dataset = load_export(dataset_file)
    if dataset['featureSchema'] != manifest.get('featureSchema'):
        raise ValueError('Manifest feature schema differs from dataset')
    if dataset['featureSchema']['order'] != expected_order() or dataset['featureSchema']['normalization']['method'] != 'shoulder-centered, shoulder-width-scaled':
        raise ValueError('Unsupported feature order or normalization')
    included = [item for item in report['samples'] if item['state'] == 'Ready for training']
    if report['included'] != len(dataset['sequences']) or len(included) != report['included'] or report['excluded'] != len(report['samples']) - len(included):
        raise ValueError('Acceptance report counts are inconsistent')
    ids = {sample['id'] for sample in dataset['sequences']}
    if ids != {sample['id'] for sample in included}:
        raise ValueError('Acceptance report does not match included samples')
    groups = manifest['sourceGroups']
    if len(groups) != len(ids) or {group['sampleId'] for group in groups} != ids:
        raise ValueError('Missing or duplicate source groups')
    group_by_id = {group['sampleId']: group for group in groups}
    group_splits, source_ids = {}, set()
    if assignments is not None and (set(assignments) != ids or not set(assignments.values()) <= {'training', 'validation', 'test'}):
        raise ValueError('Split assignments must map every included sample to training, validation or test')
    for sample in dataset['sequences']:
        metadata = sample.get('videoImport', {})
        review = metadata.get('review', {})
        boundary = metadata.get('intervalReview')
        if boundary is not None:
            if not all(isinstance(boundary.get(key), (int, float)) and np.isfinite(boundary[key]) for key in ('startMs', 'endMs')) or not isinstance(boundary.get('confirmedAt'), str):
                raise ValueError('Invalid interval boundary confirmation')
            full = abs(metadata['trimStartMs']) < .001 and abs(metadata['trimEndMs'] - metadata['sourceDurationMs']) < .001
            if boundary.get('protocol') != 'video-interval-review-v1' or boundary.get('choice') != ('full-recording' if full else 'selected-interval') or \
                    abs(boundary.get('startMs', float('inf')) - metadata['trimStartMs']) >= .001 or abs(boundary.get('endMs', float('inf')) - metadata['trimEndMs']) >= .001:
                raise ValueError('Stale interval boundary confirmation')
            datetime.fromisoformat(boundary['confirmedAt'].replace('Z', '+00:00'))
        purpose = metadata.get('samplePurpose')
        boundary_policy = metadata.get('processingVersion') == 'video-import-v6-mp0.10.35-boundary'
        training = sample.get('training', {})
        if purpose or boundary_policy:
            if purpose not in ('rest', 'idle_movement') or not boundary_policy or metadata.get('qualityWindow') or \
                    training.get('protocol') != 'separate-training-v1' or training.get('category') != purpose or not training.get('taskId') or \
                    sample['label'] != ('REST' if purpose == 'rest' else 'IDLE_MOVEMENT'):
                raise ValueError('Invalid non-sign category, task or processing policy')
            if review.get('samplePurpose') != purpose or review.get('training') != training:
                raise ValueError('Stale non-sign category/task approval')
        elif training.get('category') in ('rest', 'idle_movement') or sample['label'] in ('REST', 'IDLE', 'IDLE_MOVEMENT'):
            raise ValueError('Non-sign footage requires its dedicated quality policy')
        if review.get('protocol') != 'video-training-review-v1' or review.get('completeSample' if purpose else 'completeSign') is not True or review.get('qualityFindingsAccepted') is not True:
            raise ValueError('Missing training approval')
        source_frames = metadata.get('processingVersion') in ('video-import-v4-mp0.10.35-source-frames', 'video-import-v5-mp0.10.35-gesture-context', 'video-import-v6-mp0.10.35-boundary')
        window = metadata.get('qualityWindow')
        if review.get('qualityWindow') != window:
            raise ValueError('Stale gesture/context assessment approval')
        if window:
            span = metadata['trimEndMs'] - metadata['trimStartMs']
            if metadata.get('processingVersion') != 'video-import-v5-mp0.10.35-gesture-context' or window.get('protocol') != 'gesture-context-v1' or window.get('basis') != 'automatic-hand-activity' or \
                    not all(isinstance(window.get(key), (int, float)) and np.isfinite(window[key]) for key in ('startMs', 'endMs')) or \
                    not (0 <= window['startMs'] <= 350 and window['endMs'] <= span and 0 <= span - window['endMs'] <= 350 and window['endMs'] - window['startMs'] >= 400):
                raise ValueError('Invalid gesture/context assessment boundaries')
        expected_preprocessing = {'orientation': 'source-display-transform' if source_frames else 'browser-displayed', 'mirroring': 'source-unchanged', 'handedness': 'mediapipe-assignment',
                                  'missingHands': 'null-with-presence-flags', 'interpolation': 'none'}
        if metadata.get('preprocessing') != expected_preprocessing or (not source_frames and (metadata.get('sampleFps') != 20 or not metadata.get('processingVersion', '').startswith('video-import-v3-'))):
            raise ValueError('Unsupported preprocessing provenance')
        if metadata.get('expectedHands') not in ('either', 'both') or metadata.get('quality', {}).get('result') not in ('Pass', 'Review'):
            raise ValueError('Missing hand expectation or unacceptable stored quality')
        for key, value in [('label', sample['label']), ('trimStartMs', metadata.get('trimStartMs')), ('trimEndMs', metadata.get('trimEndMs')),
                           ('expectedHands', metadata.get('expectedHands')), ('processingVersion', metadata.get('processingVersion'))]:
            if review.get(key) != value:
                raise ValueError(f'Stale training approval: {key}')
        fingerprint = metadata.get('fingerprint', '').lower()
        if len(fingerprint) != 64 or any(char not in '0123456789abcdef' for char in fingerprint):
            raise ValueError('Invalid source SHA256')
        group = group_by_id[sample['id']]
        if group['groupId'] != 'sha256:' + fingerprint or group['trimStartMs'] != metadata['trimStartMs'] or group['trimEndMs'] != metadata['trimEndMs']:
            raise ValueError('Source group does not match sample provenance')
        if assignments is not None:
            split = assignments[sample['id']]
            if group['groupId'] in group_splits and group_splits[group['groupId']] != split:
                raise ValueError('Source recording crosses dataset splits')
            group_splits[group['groupId']] = split
        if fingerprint in source_ids:
            raise ValueError('Duplicate source recording in package')
        source_ids.add(fingerprint)
        frames = sample['frames']
        times = np.asarray([frame['timestamp'] for frame in frames], dtype=float)
        if not len(times) or times[0] < 0 or not np.isfinite(times).all() or not np.all(np.diff(times) > 0):
            raise ValueError('Invalid relative timestamps')
        if not source_frames and (times[0] != 0 or not np.allclose(np.diff(times), 50, rtol=0, atol=.01)):
            raise ValueError('Invalid legacy 20 Hz timestamps')
        span = metadata['trimEndMs'] - metadata['trimStartMs']
        if span <= 0 or metadata['trimStartMs'] < 0 or metadata['trimEndMs'] > metadata['sourceDurationMs'] + .01 or times[-1] >= span + .01:
            raise ValueError('Invalid source interval')
        if (not source_frames and abs(len(times) - np.ceil(span / 50 - 1e-8)) > 0) or abs(sample['durationMs'] - (times[-1] - times[0])) > .01:
            raise ValueError('Declared interval does not match saved frames')
        if any(frame['raw']['timestamp'] != frame['timestamp'] for frame in frames):
            raise ValueError('Raw and normalized timestamps differ')
        observations = [validate_frame(frame, allow_missing_hands=bool(purpose)) for frame in frames]
        if purpose and (metadata['quality'].get('usableFrames') != sum(observations) or metadata['quality'].get('totalFrames') != len(frames)):
            raise ValueError('Non-sign quality counts do not match saved body observations')
        if source_frames:
            sampling = metadata.get('sampling', {})
            if sampling.get('method') != 'decoded-source-frames-v1' or sampling.get('requestedFps') not in (20, 30, 60):
                raise ValueError('Unsupported source-frame sampling policy')
            if not all(isinstance(sampling.get(key), (int, float)) and np.isfinite(sampling[key]) and sampling[key] > 0 for key in
                       ('effectiveTargetFps', 'sourceAverageFps', 'sourceMedianFps', 'achievedFps', 'processingMs', 'processingFps')):
                raise ValueError('Invalid source sampling rates')
            if sampling['selectedFrames'] != len(frames) or sampling['decodedFrames'] != len(frames) + sampling['skippedForTarget'] + sampling['duplicateTimestamps']:
                raise ValueError('Source selection counts do not balance')
            measured = (len(times) - 1) * 1000 / (times[-1] - times[0]) if len(times) > 1 else 0
            if abs(sampling['achievedFps'] - measured) > .001 or abs(metadata['sampleFps'] - measured) > .001:
                raise ValueError('Reported FPS differs from actual source timestamps')
            for frame in frames:
                if not np.isfinite(frame.get('sourceTimestampMs', float('nan'))) or not np.isfinite(frame.get('sourceDurationMs', float('nan'))) or frame['sourceDurationMs'] <= 0 or \
                        abs(frame['sourceTimestampMs'] - metadata['trimStartMs'] - frame['timestamp']) > .01:
                    raise ValueError('Invalid source frame provenance')
            step = 1000 / sampling['effectiveTargetFps']
            durations = np.maximum(0, np.minimum(np.append(times[1:], times[-1] + step), span) - times)
            if window:
                mask = (times >= window['startMs'] - .001) & (times < window['endMs'] - .001)
                gesture = metadata['quality'].get('gesture', {})
                context = metadata['quality'].get('context', {})
                before = times < window['startMs'] - .001
                after = times >= window['endMs'] - .001
                no_hands = np.asarray([frame['raw']['leftHand'] is None and frame['raw']['rightHand'] is None for frame in frames])
                if gesture.get('startMs') != window['startMs'] or gesture.get('endMs') != window['endMs'] or \
                        gesture.get('totalFrames') != int(np.sum(mask)) or gesture.get('usableFrames') != int(np.sum(np.asarray(observations) * mask)) or \
                        context.get('beforeFrames') != int(np.sum(before)) or context.get('afterFrames') != int(np.sum(after)) or context.get('noHandFrames') != int(np.sum(no_hands * (before | after))):
                    raise ValueError('Gesture/context counts do not match saved observations')
                if np.count_nonzero(mask) < 2 or times[mask][-1] - times[mask][0] < 400 - .01:
                    raise ValueError('Too little gesture observation span')
                durations = np.maximum(0, np.minimum(np.append(times[1:], times[-1] + step), window['endMs']) - times)
                usable = np.sum(np.minimum(durations, step * 1.5) * observations * mask)
            else:
                usable = np.sum(np.minimum(durations, step * 1.5) * observations)
            minimum = 400 - .01
        else:
            usable, minimum = sum(observations), 8
        if usable < minimum or times[-1] - times[0] < 400 - .01:
            raise ValueError('Too little usable hand/body data')
        base = resample_sequence(frames, 40, sample['id'])
        geometry = raw_geometry_features(sample, dataset['featureSchema']['order'], 40)
        if base.shape != (40, 164) or geometry.shape != (40, 238) or not np.isfinite(base).all() or not np.isfinite(geometry).all():
            raise ValueError('Existing training loader rejected sample tensors')
    return {'samples': len(ids), 'labels': dataset['labels'], 'baseShape': [len(ids), 40, 164], 'geometryShape': [len(ids), 40, 238],
            'splitAssignmentsChecked': assignments is not None, 'warning': manifest['signerWarning'],
            'resampling': 'Existing loader smoke check only. Export retains unmodified observations; loader interpolation/standardization policy must be versioned for training.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--split-file', type=Path)
    args = parser.parse_args()
    assignments = json.loads(args.split_file.read_text(encoding='utf-8')) if args.split_file else None
    print(json.dumps(validate(args.package, assignments), indent=2))
