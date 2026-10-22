"""Prepared data migration must preserve lookup and provenance checks."""
from pathlib import Path
import tempfile
import unittest

from processed_paths import (organized_processed_name, processed_artifact_path,
                             processed_glob, resolve_artifact_path, resolved_source_hashes)


class ProcessedPathTests(unittest.TestCase):
    def test_versions_and_intermediates_stay_separate(self):
        fold = 'gru_p01_p02_train_p03_test_geometry_v3_recordings_v5'
        self.assertEqual(organized_processed_name(fold), f'current/recordings_v5/folds/{fold}')
        self.assertEqual(organized_processed_name('participant_01-dataset-v5.json'),
                         'current/recordings_v5/datasets/participant_01-dataset-v5.json')
        self.assertEqual(organized_processed_name('participant_04-dataset-v6.json'),
                         'candidates/recordings_v6/datasets/participant_04-dataset-v6.json')
        raw = 'gru_p01_p02_train_p03_test_recordings_v5'
        self.assertEqual(organized_processed_name(raw), f'current/recordings_v5/intermediates/raw/{raw}')
        shape = raw.replace('_recordings', '_handshape_v2_recordings')
        self.assertEqual(organized_processed_name(shape), f'current/recordings_v5/intermediates/handshape/{shape}')
        self.assertTrue(organized_processed_name(fold.replace('_v5', '_v4')).startswith('archive/recordings_v4/folds/'))

    def test_legacy_roots_and_moved_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'processed'
            name = 'participant_01-dataset-v5.json'
            old = root/name
            new = root/'current'/'recordings_v5'/'datasets'/name
            old.parent.mkdir()
            old.write_bytes(b'original')
            self.assertEqual(processed_artifact_path(root, name), old)
            new.parent.mkdir(parents=True)
            old.rename(new)
            self.assertEqual(processed_artifact_path(root, name), new)
            self.assertEqual(resolve_artifact_path(old), new)
            self.assertEqual(new.read_bytes(), b'original')
            old.write_bytes(b'other')
            with self.assertRaisesRegex(ValueError, 'Ambiguous'):
                processed_artifact_path(root, name)

    def test_fold_discovery_and_metadata_globs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'processed'
            name = 'gru_p01_p02_train_p03_test_geometry_v3_recordings_v5'
            folder = processed_artifact_path(root, name)
            folder.mkdir(parents=True)
            (folder/'metadata.json').write_text('{}')
            self.assertEqual(processed_glob(root, 'gru_*_recordings_v5'), [folder])
            self.assertEqual(processed_glob(root, 'gru_*/metadata.json'), [folder/'metadata.json'])
            (root/name).mkdir()
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                processed_glob(root, 'gru_*_recordings_v5')

    def test_provenance_hashes_compare_after_move_without_changing_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'processed'
            name = 'participant_01-dataset-v5.json'
            old = root/name
            new = processed_artifact_path(root, name)
            new.parent.mkdir(parents=True)
            new.write_bytes(b'data')
            record = {str(old): 'original-sha256'}
            self.assertEqual(resolved_source_hashes(record), {str(new.resolve()): 'original-sha256'})
            self.assertEqual(record, {str(old): 'original-sha256'})
            self.assertNotEqual(resolved_source_hashes(record), resolved_source_hashes({str(new): 'changed'}))

    def test_isolated_unknown_artifacts_remain_in_place(self):
        root = Path('isolated')/'processed'
        name = 'gru_p01_p02_train_p03_test_geometry_v3_sign_rest_idle_v1'
        self.assertEqual(processed_artifact_path(root, name), root/name)
        self.assertEqual(resolve_artifact_path(root/'custom.json'), root/'custom.json')


if __name__ == '__main__':
    unittest.main()
