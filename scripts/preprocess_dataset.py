#!/usr/bin/env python3
"""Prepare two SignSync participant exports for the first GRU baseline.

The collector has already normalized every frame into a 164-value feature
vector.  This script only validates that format, resamples every performance
to the same number of frames, creates a label map, and writes NumPy arrays.

Example (run from the SignSync project folder):
    python scripts/preprocess_dataset.py \
      --train "../SignSync Dataset/processed/participant_01-dataset.json" \
      --test "../SignSync Dataset/processed/participant_02-dataset.json" \
      --output "../SignSync Dataset/processed/gru_p01_train_p02_test"

Run it a second time with --train and --test swapped for the reverse
participant-independent experiment.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np


EXPECTED_SCHEMA_VERSION = 1
EXPECTED_FEATURE_COUNT = 164


def load_export(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    if data.get("schemaVersion") != EXPECTED_SCHEMA_VERSION:
        raise ValueError(f"{path.name}: expected schemaVersion {EXPECTED_SCHEMA_VERSION}")
    if data.get("featureSchema", {}).get("length") != EXPECTED_FEATURE_COUNT:
        raise ValueError(f"{path.name}: expected {EXPECTED_FEATURE_COUNT} features per frame")
    if data.get("sequenceCount") != len(data.get("sequences", [])):
        raise ValueError(f"{path.name}: sequenceCount does not match its sequences array")
    return data


def resample_sequence(frames: list[dict], target_frames: int, sequence_id: str) -> np.ndarray:
    """Linearly resample one complete sign performance to target_frames."""
    if not frames:
        raise ValueError(f"{sequence_id}: has no frames")

    vectors = np.asarray([frame.get("features") for frame in frames], dtype=np.float32)
    if vectors.shape != (len(frames), EXPECTED_FEATURE_COUNT):
        raise ValueError(f"{sequence_id}: contains a malformed feature vector")
    if not np.isfinite(vectors).all():
        raise ValueError(f"{sequence_id}: contains a non-numeric feature value")

    # A 1-frame sequence cannot describe a movement, but repeating it makes
    # the failure obvious in later quality review while preserving tensor shape.
    if len(vectors) == 1:
        return np.repeat(vectors, target_frames, axis=0)

    source_index = np.linspace(0, len(vectors) - 1, target_frames)
    left = np.floor(source_index).astype(int)
    right = np.ceil(source_index).astype(int)
    fraction = (source_index - left)[:, None]
    return vectors[left] * (1.0 - fraction) + vectors[right] * fraction


def prepare_sequences(data: dict, label_to_index: dict[str, int], target_frames: int) -> tuple[np.ndarray, np.ndarray, list[str]]:
    sequences = data["sequences"]
    tensors: list[np.ndarray] = []
    labels: list[int] = []
    ids: list[str] = []

    for sequence in sequences:
        label = sequence.get("label")
        sequence_id = sequence.get("id")
        if not isinstance(sequence_id, str) or not sequence_id:
            raise ValueError("A sequence is missing its id")
        if label not in label_to_index:
            raise ValueError(f"{sequence_id}: unknown label {label!r}")

        tensors.append(resample_sequence(sequence.get("frames", []), target_frames, sequence_id))
        labels.append(label_to_index[label])
        ids.append(sequence_id)

    return np.stack(tensors), np.asarray(labels, dtype=np.int64), ids


def stratified_train_validation_split(labels: np.ndarray, validation_per_label: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    train_indices: list[int] = []
    validation_indices: list[int] = []

    for label_index in np.unique(labels):
        indices = np.flatnonzero(labels == label_index)
        if len(indices) <= validation_per_label:
            raise ValueError(
                f"Class index {label_index} has {len(indices)} samples; it needs more than "
                f"validation_per_label ({validation_per_label})."
            )
        rng.shuffle(indices)
        validation_indices.extend(indices[:validation_per_label])
        train_indices.extend(indices[validation_per_label:])

    return np.asarray(sorted(train_indices)), np.asarray(sorted(validation_indices))


def counts_by_label(labels: np.ndarray, label_names: list[str]) -> dict[str, int]:
    counts = Counter(labels.tolist())
    return {label: int(counts[index]) for index, label in enumerate(label_names)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--train", required=True, type=Path, help="Merged JSON for the training participant")
    parser.add_argument("--test", required=True, type=Path, help="Merged JSON for the unseen test participant")
    parser.add_argument("--output", required=True, type=Path, help="Directory to receive GRU-ready files")
    parser.add_argument("--frames", type=int, default=40, help="Fixed sequence length after resampling (default: 40)")
    parser.add_argument("--validation-per-label", type=int, default=4, help="Training-participant samples held out per label (default: 4)")
    parser.add_argument("--seed", type=int, default=42, help="Reproducible split seed (default: 42)")
    args = parser.parse_args()

    if args.frames < 2:
        parser.error("--frames must be at least 2")

    train_data = load_export(args.train)
    test_data = load_export(args.test)
    if train_data["featureSchema"] != test_data["featureSchema"]:
        raise SystemExit("The participant files have different feature schemas; do not train them together.")

    label_names = sorted(set(train_data["labels"]) | set(test_data["labels"]))
    if set(train_data["labels"]) != set(test_data["labels"]):
        raise SystemExit("The participant files have different label sets; complete the missing labels first.")
    label_to_index = {label: index for index, label in enumerate(label_names)}

    x_all, y_all, train_ids = prepare_sequences(train_data, label_to_index, args.frames)
    x_test, y_test, test_ids = prepare_sequences(test_data, label_to_index, args.frames)
    train_indices, validation_indices = stratified_train_validation_split(y_all, args.validation_per_label, args.seed)

    # Standardize from training data only. Applying its statistics to validation
    # and unseen-participant test data prevents evaluation leakage.
    x_train_unscaled = x_all[train_indices]
    mean = x_train_unscaled.mean(axis=(0, 1), keepdims=True)
    std = x_train_unscaled.std(axis=(0, 1), keepdims=True)
    std[std < 1e-6] = 1.0

    args.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output / "gru_data.npz",
        X_train=((x_all[train_indices] - mean) / std).astype(np.float32),
        y_train=y_all[train_indices],
        X_validation=((x_all[validation_indices] - mean) / std).astype(np.float32),
        y_validation=y_all[validation_indices],
        X_test=((x_test - mean) / std).astype(np.float32),
        y_test=y_test,
        feature_mean=mean.astype(np.float32),
        feature_std=std.astype(np.float32),
    )

    metadata = {
        "trainSource": str(args.train.resolve()),
        "testSource": str(args.test.resolve()),
        "featureCount": EXPECTED_FEATURE_COUNT,
        "sequenceLength": args.frames,
        "labelToIndex": label_to_index,
        "split": {
            "validationPerLabel": args.validation_per_label,
            "seed": args.seed,
            "trainingCounts": counts_by_label(y_all[train_indices], label_names),
            "validationCounts": counts_by_label(y_all[validation_indices], label_names),
            "testCounts": counts_by_label(y_test, label_names),
        },
        "sequenceIds": {
            "training": [train_ids[index] for index in train_indices],
            "validation": [train_ids[index] for index in validation_indices],
            "test": test_ids,
        },
    }
    with (args.output / "metadata.json").open("w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)

    print("Preprocessing complete.")
    print(f"  Training:   {len(train_indices)} sequences")
    print(f"  Validation: {len(validation_indices)} sequences")
    print(f"  Test:       {len(y_test)} sequences")
    print(f"  Tensor shape: ({len(train_indices)}, {args.frames}, {EXPECTED_FEATURE_COUNT})")
    print(f"  Wrote: {args.output / 'gru_data.npz'}")
    print(f"  Wrote: {args.output / 'metadata.json'}")


if __name__ == "__main__":
    main()
