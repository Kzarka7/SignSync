"""Saved runs must be found unambiguously after folder organization."""
from pathlib import Path
import tempfile
import unittest
from model_paths import find_model_folder, geometry_model_folder


class ModelPathTests(unittest.TestCase):
    def test_geometry_output_reuses_saved_run(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(geometry_model_folder(root, 'run'), root/'gru_model_train_test_geometry_v3'/'run')
            saved = root/'run'
            saved.mkdir()
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


if __name__ == '__main__': unittest.main()
