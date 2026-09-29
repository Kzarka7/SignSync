"""Export sequence-level predictions from saved GRU models without retraining.

Run: python scripts/export_predictions.py --all
All seeds: python scripts/export_predictions.py --all --seeds 42 43 44
Handshape: python scripts/export_predictions.py --all --feature-set handshape --seeds 42 43 44
Or:  python scripts/export_predictions.py --experiment gru_p01_p02_train_p03_test_v1
Reports are private CSV files under SignSync Dataset/models/prediction-reports/.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
from model_paths import find_model_folder


EXPERIMENTS = (
    "gru_p01_p02_train_p03_test_v1",
    "gru_p01_p03_train_p02_test_v1",
    "gru_p02_p03_train_p01_test_v1",
)
HANDSHAPE_EXPERIMENTS = tuple(name.replace("_v1", "_handshape_v2") for name in EXPERIMENTS)
GEOMETRY_EXPERIMENTS = tuple(name.replace("_v1", "_geometry_v3") for name in EXPERIMENTS)
DATASET_FOLDER = Path(__file__).resolve().parent.parent.parent / "SignSync Dataset"


def write_excel_csv(path: Path, rows: list[dict]) -> None:
    """Write a standard comma-separated UTF-8 CSV for Excel."""
    with path.open("x", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=list(rows[0]),
            delimiter=",",
            lineterminator="\r\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def prediction_rows(metadata, y_test, probabilities, experiment):
    mapping = metadata["labelToIndex"]
    labels = [label for label, _ in sorted(mapping.items(), key=lambda item: item[1])]
    if sorted(mapping.values()) != list(range(len(labels))):
        raise ValueError("Invalid label mapping")
    ids = metadata["sequenceIds"]["test"]
    participants = metadata["participantIds"]["test"]
    if len(ids) != len(y_test) or len(set(ids)) != len(ids) or len(participants) != len(ids):
        raise ValueError("Test sequence IDs or participant IDs do not align with tensors")
    if set(participants) != {metadata["testParticipant"]}:
        raise ValueError("Unexpected participant in test set")
    if y_test.shape != (len(ids),) or not np.issubdtype(y_test.dtype, np.integer) or np.any(y_test < 0) or np.any(y_test >= len(labels)):
        raise ValueError("Invalid test labels")
    if probabilities.shape != (len(ids), len(labels)) or not np.isfinite(probabilities).all():
        raise ValueError("Model output does not match test samples and labels")
    if np.any(probabilities < 0) or np.any(probabilities > 1) or not np.allclose(probabilities.sum(axis=1), 1, atol=1e-5):
        raise ValueError("Expected class probabilities")
    predicted = probabilities.argmax(axis=1)
    return [{
        "sequence_id": sid,
        "participant_id": participants[i],
        "actual_sign": labels[int(y_test[i])],
        "predicted_sign": labels[int(predicted[i])],
        "correct": "yes" if predicted[i] == y_test[i] else "no",
        "predicted_probability": f"{probabilities[i, predicted[i]]:.6f}",
        "experiment": experiment,
    } for i, sid in enumerate(ids)]


def export_experiment(experiment, output, load_model, seed=42):
    processed = DATASET_FOLDER / "processed" / experiment
    run_name = experiment if seed == 42 else f"{experiment}_seed{seed}"
    model_folder = find_model_folder(DATASET_FOLDER / "models", run_name)
    metadata_path = processed / "metadata.json"
    data_path = processed / "gru_data.npz"
    model_path = model_folder / "best_model.keras"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    evaluation = json.loads((model_folder / "evaluation.json").read_text(encoding="utf-8"))
    if evaluation.get("randomSeed") != seed:
        raise ValueError(f"{run_name}: saved training seed does not match requested seed")
    if evaluation.get("preprocessingMetadata") != metadata or evaluation.get("experiment") != experiment:
        raise ValueError(f"{experiment}: metadata differs from the saved training evaluation")
    with np.load(data_path, allow_pickle=False) as data:
        x_test, y_test = data["X_test"], data["y_test"]
    if x_test.shape != (len(y_test), metadata["sequenceLength"], metadata["featureCount"]) or not np.isfinite(x_test).all():
        raise ValueError("Invalid test tensor")
    model = load_model(model_path, compile=False)
    probabilities = np.asarray(model.predict(x_test, batch_size=16, verbose=0))
    rows = prediction_rows(metadata, y_test, probabilities, experiment)
    for row in rows:
        row.update(seed=seed, run_name=run_name)
    correct = sum(r["correct"] == "yes" for r in rows)
    # Reconcile per-class metrics; the original report has no per-sample predictions.
    matches = True
    for label, index in metadata["labelToIndex"].items():
        actual = y_test == index
        predicted = probabilities.argmax(axis=1) == index
        tp = int((actual & predicted).sum())
        recall = tp / actual.sum() if actual.any() else 0.0
        precision = tp / predicted.sum() if predicted.any() else 0.0
        saved = evaluation["classificationReport"][label]
        matches &= bool(np.isclose(recall, saved["recall"]) and np.isclose(precision, saved["precision"]) and actual.sum() == saved["support"])
    csv_path = output / f"{run_name}.csv"
    write_excel_csv(csv_path, rows)
    print(f"{run_name}: {correct}/{len(rows)} correct; saved metrics match: {matches}")
    if not matches:
        print("  WARNING: predictions differ from original evaluation metrics. Treat this as a new inference report.")
    print(f"  {csv_path}")
    return {
        "seed": seed, "runName": run_name,
        "experiment": experiment, "samples": len(rows), "correct": correct,
        "accuracy": correct / len(rows), "savedMetricsMatch": matches,
        "note": "New inference from the saved checkpoint; matching aggregate metrics cannot prove identical historical per-sample predictions.",
        "sourceSha256": {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (model_path, data_path, metadata_path)},
    }, rows


def compare_seed_rows(seed_rows):
    """Join by sequence identity, never by CSV row position."""
    seeds = list(seed_rows)
    indexed = {}
    for seed, rows in seed_rows.items():
        index = {r["sequence_id"]: r for r in rows}
        if len(index) != len(rows) or not rows:
            raise ValueError("Missing or duplicate comparison rows")
        indexed[seed] = index
    first = indexed[seeds[0]]
    if any(set(index) != set(first) for index in indexed.values()):
        raise ValueError("Sequence IDs differ across seeds")
    result = []
    for sid, original in first.items():
        rows = [indexed[seed][sid] for seed in seeds]
        if any(any(r[k] != original[k] for k in ("participant_id", "actual_sign", "experiment")) for r in rows):
            raise ValueError(f"Sample identity differs across seeds: {sid}")
        correct = sum(r["correct"] == "yes" for r in rows)
        distinct = len({r["predicted_sign"] for r in rows})
        row = {k: original[k] for k in ("sequence_id", "participant_id", "actual_sign", "experiment")}
        for seed, prediction in zip(seeds, rows):
            row[f"predicted_seed{seed}"] = prediction["predicted_sign"]
            row[f"correct_seed{seed}"] = prediction["correct"]
        row.update(correct_runs=correct, total_runs=len(seeds),
                   outcome="ALWAYS_CORRECT" if correct == len(seeds) else "ALWAYS_WRONG" if correct == 0 else "MIXED",
                   prediction_consistent="yes" if distinct == 1 else "no")
        result.append(row)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all", action="store_true", help="Export all three participant-held-out experiments")
    selection.add_argument("--experiment", choices=EXPERIMENTS + HANDSHAPE_EXPERIMENTS + GEOMETRY_EXPERIMENTS)
    parser.add_argument("--feature-set", choices=("baseline", "handshape", "geometry"), default="baseline", help="Experiment family for --all (default: baseline)")
    parser.add_argument("--seeds", nargs="+", type=int, default=[42], help="Saved training seeds to export (default: 42); two or more also creates consistency.csv")
    args = parser.parse_args()
    if len(set(args.seeds)) != len(args.seeds) or any(s < 0 or s >= 2**32 for s in args.seeds):
        parser.error("Seeds must be distinct integers between 0 and 4294967295")
    if args.experiment and args.feature_set != "baseline":
        parser.error("Use --feature-set with --all; --experiment already identifies the feature set")
    families = {"baseline": EXPERIMENTS, "handshape": HANDSHAPE_EXPERIMENTS, "geometry": GEOMETRY_EXPERIMENTS}
    experiments = families[args.feature_set] if args.all else (args.experiment,)
    # Fail before creating output folders if a requested saved run is missing.
    for experiment in experiments:
        for seed in args.seeds:
            name = experiment if seed == 42 else f"{experiment}_seed{seed}"
            for filename in ("best_model.keras", "evaluation.json"):
                path = find_model_folder(DATASET_FOLDER / "models", name) / filename
                if not path.is_file():
                    parser.error(f"Missing saved run file: {path}")
    import tensorflow as tf

    output = DATASET_FOLDER / "models" / "prediction-reports" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output.mkdir(parents=True, exist_ok=False)
    summaries = []
    consistency = []
    for experiment in experiments:
        seed_rows = {}
        for seed in args.seeds:
            summary, rows = export_experiment(experiment, output, tf.keras.models.load_model, seed)
            summaries.append(summary)
            seed_rows[seed] = rows
            tf.keras.backend.clear_session()
        if len(args.seeds) > 1:
            consistency.extend(compare_seed_rows(seed_rows))
    if consistency:
        write_excel_csv(output / "consistency.csv", consistency)
        print(f"Across requested seeds: {output / 'consistency.csv'}")
    (output / "summary.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")
    print("Filter actual_sign=SORRY and correct=no in the CSV to find failed SORRY samples.")


if __name__ == "__main__":
    main()
