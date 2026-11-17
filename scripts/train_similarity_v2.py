"""Train a parallel Conv1D/GRU candidate on the frozen 43 Similar Signs split."""

import argparse
import json
from pathlib import Path

import numpy as np

from model_paths import model_artifact_folder
from processed_paths import processed_artifact_path
from sample_pipeline import digest, read_json, write_json
from sample_training import calibrate_threshold, threshold_metrics, validate_candidate
from shape_motion_sequence import SHAPE_MOTION_V1


BASELINE = "samples_43_signs_similarity_v1"
VERSION = "samples_43_signs_similarity_v2"
CHECKPOINT = "best_model.keras"
DATASET = Path(__file__).resolve().parents[2] / "SignSync Dataset"
SEED = 42
BATCH_SIZE = 32


def build_model(tf):
    sequence = tf.keras.Input(shape=(40, 238), name="landmark_sequence")
    kernels = (3, 7)
    branches = [
        tf.keras.layers.Conv1D(64, size, padding="same", activation="relu", name=f"conv_{size}")(sequence)
        for size in kernels
    ]
    features = tf.keras.layers.Concatenate()(branches)
    features = tf.keras.layers.GRU(128, name="gru")(features)
    features = tf.keras.layers.Dropout(.30, name="gru_dropout")(features)
    features = tf.keras.layers.Dense(64, activation="relu", name="dense")(features)
    features = tf.keras.layers.Dropout(.20, name="dense_dropout")(features)
    probabilities = tf.keras.layers.Dense(43, activation="softmax", name="sign_probabilities")(features)
    model = tf.keras.Model(sequence, probabilities, name="signsync_similarity_v2")
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=.001),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def validate_baseline(root, prepared, metadata):
    folder = model_artifact_folder(root / "models", BASELINE) / BASELINE
    verification = read_json(folder / "checkpoint_verification.json")
    labels = sorted(metadata["labelToIndex"], key=metadata["labelToIndex"].get)
    if (metadata["experiment"] != BASELINE
            or metadata["featureVariant"] != SHAPE_MOTION_V1
            or (metadata["sequenceLength"], metadata["featureCount"], len(labels)) != (40, 238, 43)
            or sorted(metadata["labelToIndex"].values()) != list(range(len(labels)))
            or verification["experiment"] != BASELINE or verification["seed"] != SEED
            or verification["labels"] != labels
            or verification["metadataSha256"] != digest((prepared / "metadata.json").read_bytes())
            or verification["checkpointSha256"] != digest((folder / verification["checkpoint"]).read_bytes())):
        raise ValueError("The baseline checkpoint and frozen preparation do not match")
    return labels, verification


def train(args):
    prepared = processed_artifact_path(args.dataset_root / "processed", BASELINE)
    metadata = read_json(prepared / "metadata.json")
    validate_candidate(prepared, metadata)
    labels, baseline = validate_baseline(args.dataset_root, prepared, metadata)
    with np.load(prepared / "gru_data.npz", allow_pickle=False) as arrays:
        x_train, y_train = arrays["X_train"], arrays["y_train"]
        x_validation, y_validation = arrays["X_validation"], arrays["y_validation"]
        x_test, y_test = arrays["X_test"], arrays["y_test"]
    for split, tensor, targets in (
        ("training", x_train, y_train), ("validation", x_validation, y_validation), ("test", x_test, y_test)
    ):
        if (tensor.shape != (len(targets), 40, 238) or not np.isfinite(tensor).all()
                or sorted(np.unique(targets)) != list(range(len(labels)))):
            raise ValueError(f"Invalid frozen {split} data")

    augmented = None
    version = VERSION
    if args.window_augmentation:
        from prepare_similarity_v2_windows import window_views

        aug_x, aug_y, source_ids, augmented = window_views(args.dataset_root, prepared, metadata, "training")
        original_labels = dict(zip(metadata["sequenceIds"]["training"], y_train))
        if not np.array_equal(aug_y, np.array([original_labels[sid] for sid in source_ids])):
            raise ValueError("An augmented sample differs from its frozen training label")
        x_train = np.concatenate((x_train, aug_x))
        y_train = np.concatenate((y_train, aug_y))
        version += "_window_aug"

    output = args.dataset_root / "models" / "candidates" / version / version
    staging = output.with_name(output.name + ".training")
    if output.exists() or staging.exists():
        raise FileExistsError(f"Existing run or in-progress artifacts at {output.parent}")

    import tensorflow as tf
    from sklearn.metrics import classification_report

    tf.keras.utils.set_random_seed(SEED)
    staging.mkdir(parents=True, exist_ok=False)
    model = build_model(tf)
    checkpoint = staging / CHECKPOINT
    print(f"Training {version}: {len(x_train)} training, {len(x_validation)} validation, {len(x_test)} test clips",
          flush=True)
    history = model.fit(
        x_train, y_train, validation_data=(x_validation, y_validation), epochs=args.epochs, batch_size=BATCH_SIZE,
        callbacks=[
            tf.keras.callbacks.ModelCheckpoint(checkpoint, monitor="val_loss", save_best_only=True),
            tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=8, verbose=1),
            tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", patience=4, factor=.5, min_lr=.00001),
        ],
        verbose=2,
    )
    model = tf.keras.models.load_model(checkpoint, compile=False)
    validation_probabilities = model.predict(x_validation, verbose=0)
    calibration = calibrate_threshold(y_validation, validation_probabilities, labels)
    probabilities = model.predict(x_test, verbose=0)
    report = classification_report(y_test, probabilities.argmax(axis=1), labels=np.arange(len(labels)),
                                   target_names=labels, output_dict=True, zero_division=0)
    evaluation = {
        "experiment": version,
        "runName": version,
        "randomSeed": SEED,
        "checkpoint": CHECKPOINT,
        "architecture": json.loads(model.to_json())["config"],
        "parameterCount": model.count_params(),
        "preprocessingMetadata": metadata,
        "baseline": baseline,
        "windowAugmentation": augmented,
        "epochsLimit": args.epochs,
        "epochsCompleted": len(history.epoch),
        "bestEpoch": int(np.argmin(history.history["val_loss"])) + 1,
        "batchSize": BATCH_SIZE,
        "trainingRows": len(y_train),
        "testAccuracy": report["accuracy"],
        "macroF1": report["macro avg"]["f1-score"],
        "classificationReport": report,
        "acceptance": threshold_metrics(y_test, probabilities, labels, calibration["selected"]["threshold"]),
    }
    write_json(staging / "evaluation.json", evaluation)
    write_json(staging / "threshold_selection.json", calibration)
    write_json(staging / "history.json", history.history)
    for name, scores, targets, split in (
        ("validation_predictions", validation_probabilities, y_validation, "validation"),
        ("predictions", probabilities, y_test, "test"),
    ):
        np.savez_compressed(staging / f"{name}.npz", probabilities=scores, y_true=targets,
                            sequence_ids=np.asarray(metadata["sequenceIds"][split]))
    write_json(staging / "checkpoint_verification.json", {
        "experiment": version, "seed": SEED, "labels": labels, "checkpoint": CHECKPOINT,
        "metadataSha256": baseline["metadataSha256"], "checkpointSha256": digest(checkpoint.read_bytes()),
    })
    staging.rename(output)
    print(output, flush=True)
    print(f"Test accuracy {report['accuracy']:.4f}, macro F1 {evaluation['macroF1']:.4f}, "
          f"threshold {calibration['selected']['threshold']:.2f}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, default=DATASET)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--window-augmentation", action="store_true")
    args = parser.parse_args()
    if args.epochs < 1:
        parser.error("--epochs must be positive")
    train(args)
