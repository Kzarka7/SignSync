"""Run with TRAINING_PACKAGE_FIXTURE pointing to the frontend-generated test ZIP."""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

from validate_video_training_package import validate
from preprocess_dataset import assert_video_source_split_isolation


class SourceSplitTests(unittest.TestCase):
    def test_training_preparation_blocks_video_leakage_and_preserves_camera_compatibility(self):
        first = {'id': 'a', 'videoImport': {'fingerprint': 'a' * 64}}
        same_source = {'id': 'b', 'videoImport': {'fingerprint': 'A' * 64}}
        with self.assertRaisesRegex(ValueError, 'crosses'):
            assert_video_source_split_isolation({'training': [first], 'test': [same_source]})
        assert_video_source_split_isolation({'training': [first, same_source], 'test': [{'id': 'legacy-camera'}]})


@unittest.skipUnless(os.environ.get('TRAINING_PACKAGE_FIXTURE'), 'Generate the frontend training-package fixture first')
class TrainingPackageTests(unittest.TestCase):
    def setUp(self):
        with zipfile.ZipFile(os.environ['TRAINING_PACKAGE_FIXTURE']) as archive:
            self.files = {name: archive.read(name) for name in archive.namelist()}
        self.temp = tempfile.TemporaryDirectory(prefix='signsync-package-test-')
        self.addCleanup(self.temp.cleanup)

    def package(self, update=None, checksums=True):
        files = copy.deepcopy(self.files)
        if update:
            update(files)
        if checksums:
            files['checksums.json'] = json.dumps({name: hashlib.sha256(content).hexdigest() for name, content in files.items() if name != 'checksums.json'}).encode()
        path = Path(self.temp.name) / 'test.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            for name, content in files.items():
                archive.writestr(name, content)
        return path

    def test_current_export_loads_both_training_feature_formats(self):
        result = validate(self.package())
        self.assertEqual(result['baseShape'], [1, 40, 164])
        self.assertEqual(result['geometryShape'], [1, 40, 238])

    def test_changed_payload_fails_checksum(self):
        def change(files):
            files['dataset.json'] += b' '
        with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
            validate(self.package(change, checksums=False))

    def test_stale_review_is_rejected_even_with_updated_checksum(self):
        def change(files):
            data = json.loads(files['dataset.json']); data['sequences'][0]['videoImport']['review']['label'] = 'HELLO'
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Stale training approval'):
            validate(self.package(change))

    def test_stale_interval_decision_is_rejected(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['videoImport']['intervalReview'] = {'protocol': 'video-interval-review-v1', 'choice': 'selected-interval',
                'startMs': 500, 'endMs': 1600, 'confirmedAt': '2026-10-21T00:00:00Z'}
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Stale interval boundary'):
            validate(self.package(change))

    def test_fabricated_presence_flag_is_rejected(self):
        def change(files):
            data = json.loads(files['dataset.json']); data['sequences'][0]['frames'][0]['features'][100] = 1
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'presence flags'):
            validate(self.package(change))

    def test_partial_split_assignments_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'every included sample'):
            validate(self.package(), {})

    def test_same_recording_cannot_cross_splits(self):
        def change(files):
            data = json.loads(files['dataset.json']); duplicate = copy.deepcopy(data['sequences'][0]); duplicate['id'] = 'sample-2'
            data['sequences'].append(duplicate); data['sequenceCount'] = 2
            files['dataset.json'] = json.dumps(data).encode()
            manifest = json.loads(files['manifest.json']); group = copy.deepcopy(manifest['sourceGroups'][0]); group['sampleId'] = 'sample-2'
            manifest['sourceGroups'].append(group); files['manifest.json'] = json.dumps(manifest).encode()
            report = json.loads(files['acceptance-report.json']); entry = copy.deepcopy(report['samples'][0]); entry['id'] = 'sample-2'
            report['samples'] = [report['samples'][0], entry]; report['included'] = 2; report['excluded'] = 0
            files['acceptance-report.json'] = json.dumps(report).encode()
        with self.assertRaisesRegex(ValueError, 'crosses dataset splits'):
            validate(self.package(change), {'sample-1': 'training', 'sample-2': 'test'})


@unittest.skipUnless(os.environ.get('SOURCE_PACKAGE_FIXTURE'), 'Generate the source-frame fixture first')
class SourceFramePackageTests(TrainingPackageTests):
    def setUp(self):
        with zipfile.ZipFile(os.environ['SOURCE_PACKAGE_FIXTURE']) as archive:
            self.files = {name: archive.read(name) for name in archive.namelist()}
        self.temp = tempfile.TemporaryDirectory(prefix='signsync-source-package-test-')
        self.addCleanup(self.temp.cleanup)

    def test_actual_fps_cannot_be_fabricated(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['videoImport']['sampleFps'] = 60
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Reported FPS'):
            validate(self.package(change))

    def test_source_timestamps_must_match_sample_timeline(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['frames'][0]['sourceTimestampMs'] += 90
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'source frame provenance'):
            validate(self.package(change))


@unittest.skipUnless(os.environ.get('CONTEXT_PACKAGE_FIXTURE'), 'Generate the gesture-context fixture first')
class GestureContextPackageTests(SourceFramePackageTests):
    def setUp(self):
        with zipfile.ZipFile(os.environ['CONTEXT_PACKAGE_FIXTURE']) as archive:
            self.files = {name: archive.read(name) for name in archive.namelist()}
        self.temp = tempfile.TemporaryDirectory(prefix='signsync-context-package-test-')
        self.addCleanup(self.temp.cleanup)

    def test_changed_gesture_boundaries_require_new_review(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['videoImport']['qualityWindow']['startMs'] += 50
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Stale gesture/context'):
            validate(self.package(change))

    def test_context_counts_cannot_be_fabricated(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['videoImport']['quality']['context']['noHandFrames'] = 0
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'counts do not match'):
            validate(self.package(change))


@unittest.skipUnless(os.environ.get('BOUNDARY_PACKAGE_FIXTURE'), 'Generate the boundary fixture first')
class BoundaryPackageTests(unittest.TestCase):
    package = TrainingPackageTests.package

    def setUp(self):
        with zipfile.ZipFile(os.environ['BOUNDARY_PACKAGE_FIXTURE']) as archive:
            self.files = {name: archive.read(name) for name in archive.namelist()}
        self.temp = tempfile.TemporaryDirectory(prefix='signsync-boundary-package-test-')
        self.addCleanup(self.temp.cleanup)

    def test_missing_hands_are_valid_non_sign_observations(self):
        result = validate(self.package())
        self.assertEqual(result['labels'], ['IDLE_MOVEMENT'])
        self.assertEqual(result['baseShape'], [1, 40, 164])
        self.assertEqual(result['geometryShape'], [1, 40, 238])

    def test_changed_task_requires_new_approval(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['training']['taskId'] = 'idle-movement-hair'
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Stale non-sign'):
            validate(self.package(change))

    def test_body_quality_counts_cannot_be_fabricated(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['videoImport']['quality']['usableFrames'] = 0
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Non-sign quality counts'):
            validate(self.package(change))

    def test_non_sign_policy_cannot_be_attached_to_a_sign(self):
        def change(files):
            data = json.loads(files['dataset.json'])
            data['sequences'][0]['label'] = 'HELLO'; data['labels'] = ['HELLO']
            files['dataset.json'] = json.dumps(data).encode()
        with self.assertRaisesRegex(ValueError, 'Invalid non-sign'):
            validate(self.package(change))


if __name__ == '__main__':
    unittest.main()
