import json
from collections import Counter
from pathlib import Path

import numpy as np


# This function converts a sequence with any number of frames
# into a sequence containing exactly 40 frames.
def resample_sequence(frames, target_frames=40):
    features = np.array(
        [frame["features"] for frame in frames],
        dtype=np.float32,
    )

    # Represent the original and target frames from 0% to 100%
    # of the complete sign movement.
    original_positions = np.linspace(
        0.0,
        1.0,
        num=len(features),
    )

    target_positions = np.linspace(
        0.0,
        1.0,
        num=target_frames,
    )

    resampled = np.empty(
        (target_frames, features.shape[1]),
        dtype=np.float32,
    )

    # Resample each of the 164 features independently.
    for feature_index in range(features.shape[1]):
        resampled[:, feature_index] = np.interp(
            target_positions,
            original_positions,
            features[:, feature_index],
        )

    return resampled


# Find the SignSync project and dataset folders.
project_folder = Path(__file__).resolve().parent.parent

dataset_path = (
    project_folder.parent
    / "SignSync Dataset"
    / "processed"
    / "participant_01-dataset.json"
)


# Load the JSON dataset.
with dataset_path.open("r", encoding="utf-8") as file:
    dataset = json.load(file)


# Inspect the overall dataset.
print("Schema version:", dataset["schemaVersion"])
print("Number of sequences:", dataset["sequenceCount"])
print("Labels:", dataset["labels"])
print("Feature count:", dataset["featureSchema"]["length"])


# Inspect the first sequence and its first frame.
first_sequence = dataset["sequences"][0]
first_frame = first_sequence["frames"][0]

print("\nFirst sequence:")
print("ID:", first_sequence["id"])
print("Label:", first_sequence["label"])
print("Frame count:", first_sequence["frameCount"])

print("\nFirst frame:")
print("Feature vector length:", len(first_frame["features"]))
print("First 10 features:", first_frame["features"][:10])


# Count the samples belonging to each label.
label_counts = Counter(
    sequence["label"]
    for sequence in dataset["sequences"]
)

print("\nNumber of labels:", len(label_counts))
print("Samples per label:")

for label in sorted(label_counts):
    print(f"{label}: {label_counts[label]}")


# Convert the first sequence into a NumPy array.
first_features = np.array(
    [
        frame["features"]
        for frame in first_sequence["frames"]
    ],
    dtype=np.float32,
)

print("\nFirst sequence NumPy shape:", first_features.shape)


# Examine the sequence lengths across the dataset.
frame_counts = np.array(
    [
        len(sequence["frames"])
        for sequence in dataset["sequences"]
    ]
)

print("\nSequence length statistics:")
print("Shortest:", frame_counts.min())
print("Longest:", frame_counts.max())
print("Average:", frame_counts.mean())
print("Median:", np.median(frame_counts))


# Resample the first sequence to exactly 40 frames.
resampled_first_sequence = resample_sequence(
    first_sequence["frames"],
    target_frames=40,
)

print("\nBefore resampling:", first_features.shape)
print("After resampling:", resampled_first_sequence.shape)

# Confirm that resampling did not change the sign's beginning or end.
print(
    "First frame preserved:",
    np.allclose(
        first_features[0],
        resampled_first_sequence[0],
    ),
)

print(
    "Last frame preserved:",
    np.allclose(
        first_features[-1],
        resampled_first_sequence[-1],
    ),
)