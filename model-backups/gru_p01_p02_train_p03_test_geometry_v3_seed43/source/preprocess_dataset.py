#!/usr/bin/env python3
"""Prepare one or more training participants and one held-out test participant.

The collector has already normalized every frame into a 164-value feature
vector.  This script only validates that format, resamples every performance
to the same number of frames, creates a label map, and writes NumPy arrays.

Example (run from the SignSync project folder):
    python scripts/preprocess_dataset.py \
      --train "../SignSync Dataset/processed/participant_01-dataset.json" \
      --test "../SignSync Dataset/processed/participant_02-dataset.json" \
      --output "../SignSync Dataset/processed/gru_p01_train_p02_test"

Pass multiple JSON paths after --train for multiple training participants.
Validation holds out four samples per label FROM EACH training participant.
Participant IDs default to the filename prefix before '-dataset'; override
with --train-participants and --test-participant for other filenames.
"""

from __future__ import annotations

import argparse
import json
import hashlib
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
    if not data["sequences"]:
        raise ValueError(f"{path.name}: no sequences")
    if set(data.get("labels", [])) != {s.get("label") for s in data["sequences"]}:
        raise ValueError(f"{path.name}: declared labels do not match sequences")
    ids = [s.get("id") for s in data["sequences"]]
    if any(not isinstance(sid, str) or not sid for sid in ids) or len(set(ids)) != len(ids):
        raise ValueError(f"{path.name}: missing or duplicate sequence IDs")
    if any(s.get("frameCount") != len(s.get("frames", [])) for s in data["sequences"]):
        raise ValueError(f"{path.name}: frameCount does not match frames")
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
    if validation_per_label < 1:
        raise ValueError("validation_per_label must be at least 1")
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
    parser.add_argument("--train", required=True, type=Path, nargs="+", help="One merged JSON per training participant")
    parser.add_argument("--train-participants", nargs="+", help="Participant IDs in the same order as --train")
    parser.add_argument("--test-participant", help="Held-out participant ID")
    parser.add_argument("--test", required=True, type=Path, help="Merged JSON for the unseen test participant")
    parser.add_argument("--output", required=True, type=Path, help="Directory to receive GRU-ready files")
    parser.add_argument("--frames", type=int, default=40, help="Fixed sequence length after resampling (default: 40)")
    parser.add_argument("--validation-per-label", type=int, default=4, help="Samples held out per label PER training participant (default: 4)")
    parser.add_argument("--seed", type=int, default=42, help="Reproducible split seed (default: 42)")
    args = parser.parse_args()

    if args.frames < 2:
        parser.error("--frames must be at least 2")
    if args.validation_per_label < 1:
        parser.error("--validation-per-label must be at least 1")
    if args.output.exists():
        parser.error("Output already exists; choose a new versioned folder to preserve previous results")
    train_participants = args.train_participants or [p.stem.split("-dataset")[0] for p in args.train]
    test_participant = args.test_participant or args.test.stem.split("-dataset")[0]
    if len(train_participants) != len(args.train):
        parser.error("Provide one --train-participants ID per training file")
    participants = train_participants + [test_participant]
    if any(not p.strip() for p in participants) or len(set(participants)) != len(participants):
        parser.error("Training and test participant IDs must be distinct and nonempty")
    paths = args.train + [args.test]
    if len({p.resolve() for p in paths}) != len(paths):
        parser.error("A dataset path cannot be used more than once")

    source_hashes = {str(p.resolve()): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    train_datasets = [load_export(p) for p in args.train]
    test_data = load_export(args.test)
    train_data = train_datasets[0]
    if any(d["featureSchema"] != train_data["featureSchema"] for d in train_datasets + [test_data]):
        raise SystemExit("The participant files have different feature schemas; do not train them together.")

    label_names = sorted(train_data["labels"])
    if any(set(d["labels"]) != set(label_names) for d in train_datasets + [test_data]):
        raise SystemExit("The participant files have different label sets; complete the missing labels first.")
    all_ids = [s["id"] for d in train_datasets + [test_data] for s in d["sequences"]]
    if len(set(all_ids)) != len(all_ids):
        raise SystemExit("Sequence IDs overlap across participant files; refusing possible leakage")
    label_to_index = {label: index for index, label in enumerate(label_names)}

    tensors, labels, train_ids, sample_participants = [], [], [], []
    training_parts, validation_parts = [], []
    offset = 0
    for participant, data in zip(train_participants, train_datasets):
        x, y, ids = prepare_sequences(data, label_to_index, args.frames)
        train, validation = stratified_train_validation_split(y, args.validation_per_label, args.seed)
        tensors.append(x)
        labels.append(y)
        train_ids.extend(ids)
        sample_participants.extend([participant] * len(ids))
        training_parts.append(train + offset)
        validation_parts.append(validation + offset)
        offset += len(ids)
    x_all, y_all = np.concatenate(tensors), np.concatenate(labels)
    train_indices, validation_indices = np.concatenate(training_parts), np.concatenate(validation_parts)
    x_test, y_test, test_ids = prepare_sequences(test_data, label_to_index, args.frames)

    # Standardize from training data only. Applying its statistics to validation
    # and unseen-participant test data prevents evaluation leakage.
    x_train_unscaled = x_all[train_indices]
    mean = x_train_unscaled.mean(axis=(0, 1), keepdims=True)
    std = x_train_unscaled.std(axis=(0, 1), keepdims=True)
    std[std < 1e-6] = 1.0

    args.output.mkdir(parents=True, exist_ok=False)
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
        "metadataVersion": 2,
        "trainSource": str(args.train[0].resolve()) if len(args.train) == 1 else None,
        "trainSources": [str(p.resolve()) for p in args.train],
        "testSource": str(args.test.resolve()),
        "sourceSha256": source_hashes,
        "trainingParticipants": train_participants,
        "testParticipant": test_participant,
        "standardizationFit": "training subset only",
        "resampling": "linear interpolation by frame index; collector normalization retained",
        "manifestAnnotationsUsed": False,
        "featureCount": EXPECTED_FEATURE_COUNT,
        "sequenceLength": args.frames,
        "labelToIndex": label_to_index,
        "split": {
            "validationPerLabel": args.validation_per_label,
            "stratification": "participant and label; not sign variant",
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
        "participantIds": {
            "training": [sample_participants[index] for index in train_indices],
            "validation": [sample_participants[index] for index in validation_indices],
            "test": [test_participant] * len(test_ids),
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
