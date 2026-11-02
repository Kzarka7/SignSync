"""Synthetic preparation checks. Mock landmarks are never sign correctness evidence.

Run with .venv-gru/Scripts/python.exe -m unittest discover -s scripts -p test_prepare_image_dataset.py
"""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import subprocess

import numpy as np
from PIL import Image
from image_landmarks import POSE, features
from prepare_image_dataset import (DEFAULTS, prepare, scan, timing, write, image_info,
                                   process_sample, group_and_split, decide)
from sample_pipeline import load_sample


class FixtureExtractor:
    """Deterministic injected landmarks for generated noise; NOT an image detector."""
    def __init__(self, settings, video=False):
        pass

    def detect(self, image, timestamp=None):
        x = float(np.asarray(image)[0, 0, 0]) / 2550
        pose = {name: dict(x=.5, y=.4, z=.1, visibility=.99) for name in POSE}
        pose['leftShoulder']['x'], pose['rightShoulder']['x'] = .3, .7
        hand = [dict(x=.3 + i*.005 + x, y=.4 + i*.003, z=i*.001) for i in range(21)]
        return dict(timestamp=timestamp, pose=pose, leftHand=hand, rightHand=None,
                    handedness=[dict(label='Left', score=.99)])

    def close(self):
        pass


def make_fixture(root):
    """Persistent, explicitly synthetic input catalog exercising both tensor shapes."""
    rng = np.random.default_rng(42)
    for i in range(9):
        path = root / 'inputs/static/FIXTURE_HANDSHAPE' / f'noise-{i}.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rng.integers(0, 256, (64, 64, 3), dtype=np.uint8)).save(path)
        for j in range(3):
            path = root / 'inputs/sequences/FIXTURE_MOVEMENT' / f'noise-seq-{i}' / f'{j}.png'
            path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rng.integers(0, 256, (64, 64, 3), dtype=np.uint8)).save(path)
    (root / 'inputs/static/FIXTURE_HANDSHAPE/corrupt.png').write_bytes(b'not an image')
    catalog = scan(root)
    for i, r in enumerate(catalog['samples']):
        r.update(source_dataset='SYNTHETIC_TEST_FIXTURE', signer_id=f'fixture-signer-{i}',
            mapping_verified=True, sign_correctness_verified=True, static_suitability_verified=True,
            complete_sign_verified=True, mirrored=False, review_notes='Synthetic flags exercise inclusion gates only.')
        if r['kind'] == 'sequence':
            directory = root / r['original_path']
            r['frames'] = [p.relative_to(root).as_posix() for p in sorted(directory.glob('*.png'))]
            r['timestamps_ms'] = [0, 80, 200]
    write(root / 'catalog.json', catalog)
    return catalog


class ImagePreparationTests(unittest.TestCase):
    def setUp(self):
        workspace = Path(__file__).resolve().parents[1] / '.tmp/image-processor-tests'
        workspace.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=workspace)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.catalog = make_fixture(self.root)

    def test_end_to_end_and_reproduction(self):
        before = {p: p.read_bytes() for p in (self.root/'inputs').rglob('*') if p.is_file()}
        report = prepare(self.root, self.root/'catalog.json', self.root/'run1', {}, FixtureExtractor, fixture=True)
        self.assertEqual(report['included'], 18)
        self.assertEqual(report['technically_valid'], 18)
        self.assertEqual(report['total_samples'], 19)
        for kind in ('static', 'sequence'):
            self.assertTrue(report['tensors'][kind]['evaluation_ready'])
        for path in (self.root/'run1/compatible_samples').rglob('*.json'):
            load_sample(path, path.parent.name)  # Existing pipeline's real schema validator.
        prepare(self.root, self.root/'catalog.json', self.root/'run2', {}, FixtureExtractor, fixture=True)
        self.assertEqual((self.root/'run1/manifest.jsonl').read_bytes(), (self.root/'run2/manifest.jsonl').read_bytes())
        for name, dimensions in [('static_data.npz', (128,)), ('temporal_data.npz', (40,238))]:
            with np.load(self.root/'run1'/name) as a, np.load(self.root/'run2'/name) as b:
                for key in a.files:
                    np.testing.assert_array_equal(a[key], b[key])
                self.assertEqual(a['X_train'].shape[1:], dimensions)
                np.testing.assert_allclose(a['X_train'].mean(axis=tuple(range(a['X_train'].ndim-1))), 0, atol=2e-5)
        self.assertTrue(all(p.read_bytes() == value for p, value in before.items()))

    def test_no_single_frame_temporal_or_unknown_timing(self):
        row = next(r for r in self.catalog['samples'] if r['kind']=='sequence')
        row['frames'] = row['frames'][:1]
        row['timestamps_ms'] = [0]
        result = process_sample(row, self.root, DEFAULTS, FixtureExtractor)
        self.assertIn('single_image_cannot_be_temporal_sequence', result['exclusions'])
        row['timestamps_ms'] = None
        result = process_sample(row, self.root, DEFAULTS, FixtureExtractor)
        self.assertIn('temporal_timing_required', result['exclusions'])
        row['frames'] = None
        result = process_sample(row, self.root, DEFAULTS, FixtureExtractor)
        self.assertTrue(result['exclusions'][0].startswith('missing_or_ambiguous'))

    def test_duplicate_and_overlapping_provenance_isolation(self):
        samples = [copy.deepcopy(self.catalog['samples'][i]) for i in range(3)]
        samples[1]['frames'] = samples[0]['frames'][:]
        samples[2]['session_id'] = samples[1]['session_id'] = 'shared-session'
        samples[2]['source_dataset'] = samples[1]['source_dataset'] = samples[0]['source_dataset']
        rows = [process_sample(r, self.root, DEFAULTS, FixtureExtractor) for r in samples]
        group_and_split(rows, DEFAULTS)
        decide(rows)
        self.assertTrue(any('duplicate' in w for w in rows[1]['warnings']))
        self.assertFalse(rows[1]['included'])
        self.assertEqual(len({r['leakage_group'] for r in rows}), 1)
        # Source fallback cannot split known and unknown people from the same source.
        rows[0]['signer_id'] = None
        rows[2]['session_id'] = None
        group_and_split(rows, DEFAULTS, detect_duplicates=False)
        self.assertEqual(len({r['leakage_group'] for r in rows}), 1)

    def test_train_only_statistics(self):
        prepare(self.root, self.root/'catalog.json', self.root/'first', {}, FixtureExtractor, fixture=True)
        rows = [json.loads(line) for line in (self.root/'first/manifest.jsonl').read_text().splitlines()]
        held = {r['id'] for r in rows if r['split'] in ('validation', 'test')}
        class ExtremeExtractor(FixtureExtractor):
            def detect(self, image, timestamp=None):
                raw = super().detect(image, timestamp)
                for point in raw['leftHand']:
                    point['x'] *= 1000
                return raw
        # Replace only held-out sample feature values by selecting per-sample factory calls.
        import prepare_image_dataset as pipeline
        original = pipeline.process_sample
        from unittest.mock import patch
        def changed(sample, root, settings, factory):
            row = original(sample, root, settings, factory)
            if sample['id'] in held:
                for f in row['extracted_frames']:
                    f['features'] = [v * 1000 for v in f['features']]
                    f['static_features'] = [v * 1000 for v in f['static_features']]
            return row
        with patch.object(pipeline, 'process_sample', changed):
            prepare(self.root, self.root/'catalog.json', self.root/'second', {}, FixtureExtractor, fixture=True)
        for name in ('static_data.npz', 'temporal_data.npz'):
            with np.load(self.root/'first'/name) as a, np.load(self.root/'second'/name) as b:
                np.testing.assert_array_equal(a['feature_mean'], b['feature_mean'])
                np.testing.assert_array_equal(a['feature_std'], b['feature_std'])

    def test_orientation_and_normalization(self):
        path = self.root/'oriented.jpg'
        image = Image.new('RGB', (40, 80))
        exif = image.getexif()
        exif[274] = 6
        image.save(path, exif=exif)
        oriented, info = image_info(path, DEFAULTS)
        self.assertEqual(oriented.size, (80, 40))
        self.assertEqual(info['exif_orientation'], 6)
        raw = FixtureExtractor({}).detect(oriented)
        vector, valid = features(raw)
        self.assertTrue(valid)
        self.assertEqual(len(vector), 164)
        self.assertAlmostEqual(vector[2], .25)  # Depth is scaled, not centered.
        self.assertEqual((vector[36], vector[100]), (1,0))
        raw['pose'] = None
        self.assertEqual(features(raw), ([0.]*164, False))
        with self.assertRaises(ValueError):
            timing(dict(kind='sequence', timestamps_ms=[0,0]), 2)

    def test_external_source_stays_read_only(self):
        source = self.root/'reserved'
        source.mkdir()
        (source/'A').mkdir()
        Image.new('RGB', (40,40)).save(source/'A/sign.png')
        indexed = scan(self.root, source, 'static')
        self.assertEqual(indexed['samples'][0]['frames'], ['A/sign.png'])
        self.assertEqual(indexed['source_root'], str(source.resolve()))
        write(self.root/'external.json', indexed)
        result = prepare(self.root, self.root/'external.json', self.root/'external-output', {}, FixtureExtractor, fixture=True)
        self.assertEqual(result['included'], 0)  # Technical extraction does not approve meaning.
        self.assertEqual(sorted(p.relative_to(source).as_posix() for p in source.rglob('*')), ['A','A/sign.png'])

    def test_actual_collector_parity(self):
        from image_landmarks import SCHEMA
        oracle = Path(__file__).with_name('tests')/'collector_image_parity.cjs'
        result = subprocess.run(['node', str(oracle)], check=True, capture_output=True, text=True)
        actual = json.loads(result.stdout)
        self.assertEqual(SCHEMA, actual['schema'])
        for raw, expected in zip(actual['frames'], actual['results']):
            vector, valid = features(raw)
            self.assertEqual(valid, expected['valid'])
            np.testing.assert_allclose(vector, expected['features'], atol=1e-12)


if __name__ == '__main__':
    unittest.main()
