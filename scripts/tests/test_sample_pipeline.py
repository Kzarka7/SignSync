"""Manifest, duplicate, split leakage, and candidate integrity regressions."""
import csv
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

import sample_pipeline as pipeline
from sample_training import validate_candidate, calibrate_threshold, threshold_metrics


def schema():
    pose = [f'pose.{name}.{axis}' for name in ('nose', 'leftShoulder', 'rightShoulder',
            'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip')
            for axis in ('x', 'y', 'z', 'visibility')]
    joints = ['wrist'] + ['thumb_' + j for j in ('cmc', 'mcp', 'ip', 'tip')]
    joints += [f + '_' + j for f in ('index', 'middle', 'ring', 'pinky') for j in ('mcp', 'pip', 'dip', 'tip')]
    order = pose + [name for hand in ('leftHand', 'rightHand')
                    for name in [hand + '.present'] + [f'{hand}.{j}.{a}' for j in joints for a in 'xyz']]
    return dict(length=len(order), order=order)


class SamplePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'manifests').mkdir()
        self.schema = schema()
        self.assertEqual(self.schema['length'], 164)

    def sample(self, sid, label='A', signer='p1', value=1):
        order = self.schema['order']
        vectors = np.full((3, 164), value, dtype=float)
        for hand in ('leftHand', 'rightHand'):
            vectors[:, order.index(hand + '.present')] = 1
            for i, joint in enumerate(('wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
                                      'index_mcp', 'index_pip', 'index_dip', 'index_tip',
                                      'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip',
                                      'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip',
                                      'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip')):
                vectors[:, order.index(f'{hand}.{joint}.x')] += i * .2
                vectors[:, order.index(f'{hand}.{joint}.y')] += i * .3
        seq = dict(id=sid, label=label, frameCount=3, metadata={'signerId': signer},
                   frames=[dict(timestamp=i * 100, valid=True, features=v.tolist()) for i, v in enumerate(vectors)])
        data = dict(schemaVersion=1, labels=[label], sequenceCount=1, featureSchema=self.schema, sequences=[seq])
        path = self.root / 'samples' / label / (sid + '.json')
        path.parent.mkdir(parents=True, exist_ok=True)
        pipeline.write_json(path, data)
        return path

    def save_rows(self, rows):
        (self.root / 'manifests/training-samples.csv').write_text(pipeline.csv_text(rows), encoding='utf-8')

    def test_new_pending_approval_preserved_changed_file_pending(self):
        path = self.sample('a')
        rows, _, report = pipeline.scan(self.root)
        self.assertEqual(report['statusCounts'], {'pending': 1})
        rows[0].update(status='approved', notes='reviewed')
        self.save_rows(rows)
        self.assertEqual(pipeline.scan(self.root)[0][0]['status'], 'approved')
        data = pipeline.read_json(path)
        data['sequences'][0]['frames'][0]['features'][0] += 1
        pipeline.write_json(path, data)
        self.assertEqual(pipeline.scan(self.root)[0][0]['status'], 'pending')
        with self.assertRaisesRegex(ValueError, 'stale'):
            pipeline.selected_manifest(self.root, ['A'])

    def test_label_schema_timestamp_and_malformed_files_are_audited(self):
        path = self.sample('a')
        data = pipeline.read_json(path)
        data['sequences'][0]['frames'][1]['timestamp'] = 0
        pipeline.write_json(path, data)
        rows, _, report = pipeline.scan(self.root)
        self.assertFalse(rows)
        self.assertIn('timestamps', report['problems'][0]['reason'])
        pipeline.write_json(path, [])
        self.assertEqual(len(pipeline.scan(self.root)[2]['problems']), 1)
        data['sequences'][0]['frames'][1]['timestamp'] = 100
        data['sequences'][0]['label'] = 'B'
        pipeline.write_json(path, data)
        self.assertIn('folder', pipeline.scan(self.root)[2]['problems'][0]['reason'])

    def test_duplicate_content_across_labels_and_duplicate_id(self):
        self.sample('a', 'A')
        path = self.sample('b', 'B')
        rows, _, report = pipeline.scan(self.root)
        self.assertEqual(len(report['problems']), 1)
        self.assertEqual(rows[1]['status'], 'excluded')
        data = pipeline.read_json(path)
        data['sequences'][0]['id'] = 'a'
        pipeline.write_json(path, data)
        rows, _, report = pipeline.scan(self.root)
        self.assertEqual(len(rows), 1)
        self.assertIn('duplicate ID', report['problems'][0]['reason'])

    def test_recording_connects_different_signers_and_unknown_groups_fail(self):
        rows = []
        for sid, signer in [('a', 'p1'), ('b', 'p2'), ('c', 'p3')]:
            self.sample(sid, signer=signer, value=len(rows) + 1)
            rows = pipeline.scan(self.root)[0]
        config = dict(labels=['A'], splitGroups=dict(training=['signer:p1'], validation=['signer:p2'], test=['signer:p3']))
        self.assertEqual([len(v) for v in pipeline.assign_splits(rows, config).values()], [1, 1, 1])
        rows[0]['source_recording'] = rows[1]['source_recording'] = 'shared-video'
        with self.assertRaisesRegex(ValueError, 'crosses'):
            pipeline.assign_splits(rows, config)
        rows[0]['source_recording'] = rows[1]['source_recording'] = ''
        rows[0]['signer_id'] = ''
        with self.assertRaisesRegex(ValueError, 'supply'):
            pipeline.assign_splits(rows, config)

    def fixture_candidate(self):
        for i, signer in enumerate(('p1', 'p2', 'p3')):
            self.sample('sample' + signer, signer=signer, value=i * 100 + 1)
        rows, _, _ = pipeline.scan(self.root)
        for row in rows:
            row.update(status='approved')
        self.save_rows(rows)
        config = dict(name='new_experiment', labels=['A'],
                      splitGroups=dict(training=['signer:p1'], validation=['signer:p2'], test=['signer:p3']))
        path = self.root / 'experiment.json'
        pipeline.write_json(path, config)
        pipeline.prepare(self.root, path)
        return self.root / 'processed/candidates/new_experiment', path

    def test_candidate_integrity_training_only_scaler_and_no_overwrite(self):
        folder, config = self.fixture_candidate()
        meta = pipeline.read_json(folder / 'metadata.json')
        validate_candidate(folder, meta)
        with np.load(folder / 'gru_data.npz') as arrays:
            self.assertEqual(arrays['X_train'].shape, (1, 40, 238))
            np.testing.assert_allclose(arrays['X_train'].mean(axis=(0, 1)), 0, atol=1e-6)
            self.assertLess(arrays['feature_mean'][0, 0, 0], 10)
        with self.assertRaises(FileExistsError):
            pipeline.prepare(self.root, config)
        with (folder / 'samples.csv').open('a') as handle:
            handle.write('tampering')
        with self.assertRaisesRegex(ValueError, 'changed'):
            validate_candidate(folder, meta)

    def test_threshold_selection_and_absent_background(self):
        labels = ['A', 'REST']
        y = np.asarray([0, 1])
        probabilities = np.asarray([[.9, .1], [.6, .4]])
        calibration = calibrate_threshold(y, probabilities, labels)
        self.assertGreater(calibration['selected']['threshold'], .6)
        self.assertEqual(calibration['selected']['idleFalseDetections'], 0)
        metric = threshold_metrics(np.asarray([0]), np.asarray([[1.]]), ['A'], .5)
        self.assertIsNone(metric['idleFalseDetectionRate'])

    def test_missing_class_and_unassigned_new_signer_refused(self):
        for i, signer in enumerate(('p1', 'p2', 'p3', 'p4')):
            self.sample(signer, signer=signer, value=i + 1)
        rows = pipeline.scan(self.root)[0]
        config = dict(labels=['A'], splitGroups=dict(training=['signer:p1'], validation=['signer:p2'], test=['signer:p3']))
        with self.assertRaisesRegex(ValueError, 'unassigned'):
            pipeline.assign_splits(rows, config)
        config['labels'].append('B')
        with self.assertRaisesRegex(ValueError, 'every configured label'):
            pipeline.assign_splits(rows[:3], config)

    def test_an_unknown_signer_can_use_a_batch_without_claiming_signer_isolation(self):
        for i in range(3):
            self.sample(str(i), signer='', value=i + 1)
        rows = pipeline.scan(self.root)[0]
        for i, row in enumerate(rows):
            row['collection_batch'] = 'batch' + str(i)
        config = dict(labels=['A'], splitGroups=dict(training=['batch:batch0'], validation=['batch:batch1'], test=['batch:batch2']))
        self.assertEqual([len(p) for p in pipeline.assign_splits(rows, config).values()], [1, 1, 1])


if __name__ == '__main__':
    unittest.main()
