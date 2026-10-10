"""Synthetic checks for participant-separated preprocessing; no private data."""

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

import preprocess_dataset as preprocessing


class PreprocessingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.paths = []
        for participant in range(1, 4):
            sequences = []
            for label in ("A", "B"):
                for sample in range(6):
                    value = participant * 100 + sample * 5 + (label == "B")
                    sequences.append({
                        "id": f"p{participant}-{label}-{sample}", "label": label,
                        "frameCount": 2,
                        "frames": [{"features": [value + frame] * 164} for frame in range(2)],
                    })
            data = {"schemaVersion": 1, "featureSchema": {"length": 164},
                    "labels": ["A", "B"], "sequenceCount": 12, "sequences": sequences}
            path = self.root / f"participant_0{participant}-dataset.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            self.paths.append(path)

    def run_preprocessing(self, output, paths=None):
        args = ["preprocess", "--train", *map(str, paths or self.paths[:2]),
                "--test", str(self.paths[2]), "--output", str(output),
                "--validation-per-label", "2", "--frames", "4"]
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            preprocessing.main()

    def test_split_and_training_only_statistics(self):
        output = self.root / "first"
        self.run_preprocessing(output)
        metadata = json.loads((output / "metadata.json").read_text())
        splits = metadata["sequenceIds"]
        self.assertEqual([len(splits[k]) for k in ("training", "validation", "test")], [16, 8, 12])
        self.assertFalse(set(splits["training"]) & set(splits["validation"]))
        self.assertFalse((set(splits["training"]) | set(splits["validation"])) & set(splits["test"]))
        for participant in ("participant_01", "participant_02"):
            for label in ("A", "B"):
                self.assertEqual(sum(p == participant and f"-{label}-" in sid for p, sid in zip(metadata["participantIds"]["validation"], splits["validation"])), 2)
        with np.load(output / "gru_data.npz") as data:
            mean, std = data["feature_mean"].copy(), data["feature_std"].copy()
            self.assertEqual(data["X_train"].shape, (16, 4, 164))
            np.testing.assert_allclose(data["X_train"].mean(axis=(0, 1)), 0, atol=1e-6)
            self.assertTrue(all(np.isfinite(data[key]).all() for key in data.files))
        # Extreme changes to held-out and validation frames cannot influence fit statistics.
        for path in self.paths:
            d = json.loads(path.read_text())
            for s in d["sequences"]:
                if s["id"] in splits["validation"] or s["id"] in splits["test"]:
                    for frame in s["frames"]:
                        frame["features"] = [1e8] * 164
            path.write_text(json.dumps(d))
        self.run_preprocessing(self.root / "second")
        with np.load(self.root / "second" / "gru_data.npz") as data:
            np.testing.assert_array_equal(data["feature_mean"], mean)
            np.testing.assert_array_equal(data["feature_std"], std)

    def test_single_participant_split_compatibility(self):
        output = self.root / "single"
        self.run_preprocessing(output, [self.paths[0]])
        meta = json.loads((output / "metadata.json").read_text())
        d = preprocessing.load_export(self.paths[0])
        _, labels, ids = preprocessing.prepare_sequences(d, {"A": 0, "B": 1}, 4)
        train, validation = preprocessing.stratified_train_validation_split(labels, 2, 42)
        self.assertEqual(meta["sequenceIds"]["training"], [ids[i] for i in train])
        self.assertEqual(meta["sequenceIds"]["validation"], [ids[i] for i in validation])

    def test_reject_overlap_and_existing_output(self):
        output = self.root / "protected"
        output.mkdir()
        sentinel = output / "keep.txt"
        sentinel.write_text("unchanged")
        with self.assertRaises(SystemExit):
            self.run_preprocessing(output)
        self.assertEqual(sentinel.read_text(), "unchanged")
        data = json.loads(self.paths[2].read_text())
        data["sequences"][0]["id"] = "p1-A-0"
        self.paths[2].write_text(json.dumps(data))
        with self.assertRaises(SystemExit):
            self.run_preprocessing(self.root / "overlap")
        self.assertFalse((self.root / "overlap").exists())

    def test_reject_same_participant_version(self):
        version = self.root / "participant_03-dataset-v2.json"
        version.write_bytes(self.paths[0].read_bytes())
        with self.assertRaises(SystemExit):
            self.run_preprocessing(self.root / "same-participant", [version])


if __name__ == "__main__":
    unittest.main()
