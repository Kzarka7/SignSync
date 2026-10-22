"""Saved runs must be found unambiguously after folder organization."""
from processed_paths import processed_artifact_path
from pathlib import Path
import tempfile
import unittest
from model_paths import find_model_folder, geometry_model_folder, model_artifact_folder, resolve_model_artifact_path


class ModelPathTests(unittest.TestCase):
    def test_geometry_output_reuses_saved_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(geometry_model_folder(root, 'run'), root/'archive'/'geometry_v3'/'run')
            saved = root/'run'
            saved.mkdir(parents=True)
            (saved/'evaluation.json').write_text('{}')
            self.assertEqual(geometry_model_folder(root, 'run'), saved)

    def test_flat_and_grouped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder in (root/'flat_run', root/'group'/'nested_run'):
                folder.mkdir(parents=True)
                (folder/'evaluation.json').write_text('{}')
                self.assertEqual(find_model_folder(root, folder.name), folder)

    def test_missing_and_duplicate_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                find_model_folder(root, 'run')

            for group in ('a', 'b'):
                folder = root/group/'run'
                folder.mkdir(parents=True)
                (folder/'evaluation.json').write_text('{}')
            with self.assertRaises(ValueError):
                find_model_folder(root, 'run')

    def test_artifact_migration_supports_old_and_new_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'gru_model_train_test_geometry_v3_recordings_v5'
            organized = root/'current'/'recordings_v5'
            self.assertEqual(model_artifact_folder(root, name), organized)
            legacy = root/name
            legacy.mkdir(parents=True)
            self.assertEqual(model_artifact_folder(root, name), legacy)
            organized.parent.mkdir(parents=True)
            legacy.rename(organized)
            self.assertEqual(model_artifact_folder(root, name), organized)
            legacy.mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, 'Ambiguous'):
                model_artifact_folder(root, name)

    def test_isolated_candidate_run_paths_are_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(model_artifact_folder(root, 'candidate_run'), root/'candidate_run')

    def test_historical_checkpoint_reference_resolves_after_move(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)/'models'
            old = root/'gru_model_train_test_geometry_v3_recordings_v5'/'run'/'best_model.h5'
            new = root/'current'/'recordings_v5'/'run'/'best_model.h5'
            new.parent.mkdir(parents=True)
            new.write_bytes(b'checkpoint')
            self.assertEqual(resolve_model_artifact_path(old), new)
            untouched = processed_artifact_path(root.parent/'processed', 'metadata.json')
            self.assertEqual(resolve_model_artifact_path(untouched), untouched)


if __name__ == '__main__': unittest.main()
