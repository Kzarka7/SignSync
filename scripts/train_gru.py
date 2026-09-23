"""Train and evaluate a participant-independent SignSync GRU baseline.

The script reads one experiment produced by preprocess_dataset.py, trains a
small GRU classifier, saves the best model, and generates research evaluation
files. Select the participant direction with --experiment.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np


# ---------------------------------------------------------------------------
# 1. Experiment configuration
# ---------------------------------------------------------------------------

RANDOM_SEED = 42
EPOCHS = 100
BATCH_SIZE = 16

EXPERIMENTS = {
    "gru_p01_train_p02_test": {
        "trainingParticipants": ["participant_01"],
        "testParticipant": "participant_02",
    },
    "gru_p02_train_p01_test": {
        "trainingParticipants": ["participant_02"],
        "testParticipant": "participant_01",
    },
    "gru_p01_p02_train_p03_test_v1": {
        "trainingParticipants": ["participant_01", "participant_02"],
        "testParticipant": "participant_03",
    },
    "gru_p01_p03_train_p02_test_v1": {
        "trainingParticipants": ["participant_01", "participant_03"],
        "testParticipant": "participant_02",
    },
    "gru_p02_p03_train_p01_test_v1": {
        "trainingParticipants": ["participant_02", "participant_03"],
        "testParticipant": "participant_01",
    },
}

# Separate handshape experiments use the same architecture and training settings.
EXPERIMENTS.update({name.replace('_v1', '_handshape_v2'): dict(config)
                    for name, config in list(EXPERIMENTS.items()) if name.endswith('_v1')})

parser = argparse.ArgumentParser(
    description="Train a SignSync GRU participant-independent experiment."
)
parser.add_argument(
    "--experiment",
    choices=sorted(EXPERIMENTS),
    default="gru_p01_train_p02_test",
    help="Preprocessed experiment folder to train (default: %(default)s)",
)
parser.add_argument("--check-only", action="store_true", help="Validate the experiment without training or writing outputs")
parser.add_argument("--seed", type=int, default=42, help="Training randomness seed; preprocessing splits stay unchanged (default: 42)")
arguments = parser.parse_args()
if not 0 <= arguments.seed < 2**32:
    parser.error("--seed must be between 0 and 4294967295")
RANDOM_SEED = arguments.seed

EXPERIMENT_NAME = arguments.experiment
experiment = EXPERIMENTS[EXPERIMENT_NAME]
TRAINING_PARTICIPANTS = experiment["trainingParticipants"]
TEST_PARTICIPANT = experiment["testParticipant"]

PROJECT_FOLDER = Path(__file__).resolve().parent.parent
DATASET_FOLDER = PROJECT_FOLDER.parent / "SignSync Dataset"
PREPROCESSED_FOLDER = DATASET_FOLDER / "processed" / EXPERIMENT_NAME
RUN_NAME = EXPERIMENT_NAME if RANDOM_SEED == 42 else f"{EXPERIMENT_NAME}_seed{RANDOM_SEED}"
MODEL_FOLDER = DATASET_FOLDER / "models" / RUN_NAME

DATA_PATH = PREPROCESSED_FOLDER / "gru_data.npz"
METADATA_PATH = PREPROCESSED_FOLDER / "metadata.json"

if not arguments.check_only and MODEL_FOLDER.exists():
    parser.error(f"Model folder already exists; preserving previous results: {MODEL_FOLDER}")


# ---------------------------------------------------------------------------
# 2. Make the experiment reproducible
# ---------------------------------------------------------------------------

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)


# ---------------------------------------------------------------------------
# 3. Load the preprocessed arrays and label mapping
# ---------------------------------------------------------------------------

with np.load(DATA_PATH) as data:
    X_train = data["X_train"]
    y_train = data["y_train"]
    X_validation = data["X_validation"]
    y_validation = data["y_validation"]
    X_test = data["X_test"]
    y_test = data["y_test"]

with METADATA_PATH.open("r", encoding="utf-8") as file:
    metadata = json.load(file)

if "trainingParticipants" in metadata:
    if metadata["trainingParticipants"] != TRAINING_PARTICIPANTS or metadata.get("testParticipant") != TEST_PARTICIPANT:
        raise ValueError("Preprocessing participant identities do not match the chosen experiment")
elif len(TRAINING_PARTICIPANTS) > 1:
    raise ValueError("Multi-participant experiments require participant identities in preprocessing metadata")

label_to_index = metadata["labelToIndex"]
label_names = [
    label
    for label, _ in sorted(
        label_to_index.items(),
        key=lambda item: item[1],
    )
]

number_of_classes = len(label_names)
sequence_length = X_train.shape[1]
feature_count = X_train.shape[2]

if sorted(label_to_index.values()) != list(range(number_of_classes)):
    raise ValueError("Label indices must be consecutive starting at zero")
seen_ids = set()
for split, x, y in (
    ("training", X_train, y_train),
    ("validation", X_validation, y_validation),
    ("test", X_test, y_test),
):
    if x.ndim != 3 or x.shape[1:] != (metadata["sequenceLength"], metadata["featureCount"]) or len(x) == 0:
        raise ValueError(f"{split}: invalid tensor shape")
    if y.shape != (len(x),) or not np.issubdtype(y.dtype, np.integer) or np.any(y < 0) or np.any(y >= number_of_classes):
        raise ValueError(f"{split}: invalid labels")
    if not np.isfinite(x).all():
        raise ValueError(f"{split}: non-finite features")
    ids = metadata["sequenceIds"][split]
    if len(ids) != len(x) or len(set(ids)) != len(ids) or seen_ids.intersection(ids):
        raise ValueError(f"{split}: missing, duplicate, or overlapping sequence IDs")
    seen_ids.update(ids)
    if "participantIds" in metadata:
        participants = metadata["participantIds"][split]
        expected = {TEST_PARTICIPANT} if split == "test" else set(TRAINING_PARTICIPANTS)
        if len(participants) != len(x) or set(participants) != expected:
            raise ValueError(f"{split}: incorrect participant membership")

print("Loaded dataset")
print("Experiment:", EXPERIMENT_NAME)
print("Training seed:", RANDOM_SEED)
print("Model output:", MODEL_FOLDER)
print("Training participants:", ", ".join(TRAINING_PARTICIPANTS))
print("Unseen test participant:", TEST_PARTICIPANT)
print("X_train:", X_train.shape)
print("X_validation:", X_validation.shape)
print("X_test:", X_test.shape)
print("Classes:", number_of_classes)

if arguments.check_only:
    print("Validation passed. No training or output files written.")
    raise SystemExit(0)

import matplotlib.pyplot as plt
import tensorflow as tf
from sklearn.metrics import ConfusionMatrixDisplay, classification_report

tf.random.set_seed(RANDOM_SEED)
MODEL_FOLDER.mkdir(parents=True, exist_ok=False)


# ---------------------------------------------------------------------------
# 4. Define the GRU model
# ---------------------------------------------------------------------------

model = tf.keras.Sequential(
    [
        tf.keras.layers.Input(
            shape=(sequence_length, feature_count),
            name="landmark_sequence",
        ),
        tf.keras.layers.GRU(
            64,
            name="gru",
        ),
        tf.keras.layers.Dropout(
            0.30,
            name="gru_dropout",
        ),
        tf.keras.layers.Dense(
            32,
            activation="relu",
            name="dense",
        ),
        tf.keras.layers.Dropout(
            0.20,
            name="dense_dropout",
        ),
        tf.keras.layers.Dense(
            number_of_classes,
            activation="softmax",
            name="sign_probabilities",
        ),
    ],
    name="signsync_gru_baseline",
)

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

model.summary()


# ---------------------------------------------------------------------------
# 5. Configure training safeguards
# ---------------------------------------------------------------------------

callbacks = [
    tf.keras.callbacks.EarlyStopping(
        monitor="val_loss",
        patience=15,
        restore_best_weights=True,
        verbose=1,
    ),
    tf.keras.callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=5,
        min_lr=0.00001,
        verbose=1,
    ),
    tf.keras.callbacks.ModelCheckpoint(
        filepath=MODEL_FOLDER / "best_model.keras",
        monitor="val_loss",
        save_best_only=True,
        verbose=1,
    ),
]


# ---------------------------------------------------------------------------
# 6. Train using only the selected training participants
# ---------------------------------------------------------------------------

history = model.fit(
    X_train,
    y_train,
    validation_data=(X_validation, y_validation),
    epochs=EPOCHS,
    batch_size=BATCH_SIZE,
    callbacks=callbacks,
    verbose=1,
)


# ---------------------------------------------------------------------------
# 7. Evaluate once on the selected unseen test participant
# ---------------------------------------------------------------------------

test_loss, test_accuracy = model.evaluate(
    X_test,
    y_test,
    verbose=0,
)

probabilities = model.predict(
    X_test,
    verbose=0,
)

predictions = np.argmax(
    probabilities,
    axis=1,
)

report = classification_report(
    y_test,
    predictions,
    labels=np.arange(number_of_classes),
    target_names=label_names,
    output_dict=True,
    zero_division=0,
)

print("\nUnseen-participant test results")
print(f"Test loss: {test_loss:.4f}")
print(f"Test accuracy: {test_accuracy:.4f}")
print(f"Macro F1: {report['macro avg']['f1-score']:.4f}")


# ---------------------------------------------------------------------------
# 8. Save numerical evaluation results
# ---------------------------------------------------------------------------

evaluation = {
    "experiment": EXPERIMENT_NAME,
    "runName": RUN_NAME,
    "trainingParticipant": TRAINING_PARTICIPANTS[0] if len(TRAINING_PARTICIPANTS) == 1 else None,
    "trainingParticipants": TRAINING_PARTICIPANTS,
    "testParticipant": TEST_PARTICIPANT,
    "randomSeed": RANDOM_SEED,
    "epochsLimit": EPOCHS,
    "batchSize": BATCH_SIZE,
    "preprocessingMetadata": metadata,
    "testLoss": float(test_loss),
    "testAccuracy": float(test_accuracy),
    "macroPrecision": float(report["macro avg"]["precision"]),
    "macroRecall": float(report["macro avg"]["recall"]),
    "macroF1": float(report["macro avg"]["f1-score"]),
    "classificationReport": report,
}

with (MODEL_FOLDER / "evaluation.json").open(
    "w",
    encoding="utf-8",
) as file:
    json.dump(evaluation, file, indent=2)


# ---------------------------------------------------------------------------
# 9. Save the training-history graph
# ---------------------------------------------------------------------------

figure, axes = plt.subplots(
    1,
    2,
    figsize=(12, 4),
)

axes[0].plot(history.history["loss"], label="Training")
axes[0].plot(history.history["val_loss"], label="Validation")
axes[0].set_title("Loss")
axes[0].set_xlabel("Epoch")
axes[0].set_ylabel("Cross-entropy loss")
axes[0].legend()

axes[1].plot(history.history["accuracy"], label="Training")
axes[1].plot(history.history["val_accuracy"], label="Validation")
axes[1].set_title("Accuracy")
axes[1].set_xlabel("Epoch")
axes[1].set_ylabel("Accuracy")
axes[1].legend()

figure.tight_layout()
figure.savefig(
    MODEL_FOLDER / "training_history.png",
    dpi=160,
)
plt.close(figure)


# ---------------------------------------------------------------------------
# 10. Save the confusion matrix
# ---------------------------------------------------------------------------

figure, axis = plt.subplots(
    figsize=(12, 12),
)

ConfusionMatrixDisplay.from_predictions(
    y_test,
    predictions,
    labels=np.arange(number_of_classes),
    display_labels=label_names,
    xticks_rotation=90,
    colorbar=False,
    ax=axis,
)

axis.set_title(
    f"GRU confusion matrix: {TEST_PARTICIPANT} test set"
)
figure.tight_layout()
figure.savefig(
    MODEL_FOLDER / "confusion_matrix.png",
    dpi=160,
)
plt.close(figure)


print("\nSaved outputs")
print(MODEL_FOLDER / "best_model.keras")
print(MODEL_FOLDER / "evaluation.json")
print(MODEL_FOLDER / "training_history.png")
print(MODEL_FOLDER / "confusion_matrix.png")
