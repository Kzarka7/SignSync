"""Compare both v2 runs and v1 on aligned clips and frozen background probes."""

import argparse
from collections import Counter
from importlib.metadata import version
from pathlib import Path

import numpy as np

from model_paths import model_artifact_folder
from prepare_similarity_v2_windows import window_views
from processed_paths import processed_artifact_path
from sample_pipeline import load_sample, read_csv, read_json, write_json
from run_recordings_v5_experiments import standardize_for_model
from shape_motion_sequence import raw_shape_motion_features
from train_similarity_v2 import BASELINE, DATASET, VERSION


def read_background(root, prepared, baseline):
    rows = read_csv(prepared / "review-manifest.csv")
    probes = read_json(baseline / "background_predictions.json")
    order = read_json(prepared / "feature_schema.json")["order"]
    inputs = []
    eligible = []
    for probe in probes:
        sid = probe["sequenceId"]
        row = rows[sid]
        export, sequence, checksum, _ = load_sample(root / row["sample_path"], probe["actual"])
        if (checksum != probe["sha256"] or checksum != row["sha256"]
                or sequence["id"] != sid or export["featureSchema"]["order"] != order):
            raise ValueError(f"Frozen background sample mismatch: {sid}")
        inputs.append(raw_shape_motion_features(sequence, order))
        # V1 report ran the same capture and hand visibility gates.
        eligible.append(probe["captureEligible"] and probe["validHandFraction"] >= .5)
    with np.load(prepared / "gru_data.npz", allow_pickle=False) as arrays:
        features = standardize_for_model(np.stack(inputs), arrays["feature_mean"], arrays["feature_std"])
    return features, np.asarray(eligible), probes


def score(probabilities, truth, threshold):
    accepted = probabilities.max(axis=1) >= threshold
    correct = probabilities.argmax(axis=1) == truth
    return {
        "clips": len(truth),
        "correct": int(correct.sum()),
        "correctAccepted": int((correct & accepted).sum()),
        "wrongAccepted": int((~correct & accepted).sum()),
        "rejected": int((~accepted).sum()),
    }


def compare(root, primary_only):
    import tensorflow as tf

    prepared = processed_artifact_path(root / "processed", BASELINE)
    metadata = read_json(prepared / "metadata.json")
    labels = sorted(metadata["labelToIndex"], key=metadata["labelToIndex"].get)
    baseline = model_artifact_folder(root / "models", BASELINE) / BASELINE
    output = root / "models" / "candidates" / VERSION / VERSION
    augmented = VERSION + "_window_aug"
    runs = {"v1": baseline, "v2": output}
    if not primary_only:
        runs["v2 with window augmentation"] = root / "models" / "candidates" / augmented / augmented
    background, eligible, probes = read_background(root, prepared, baseline)
    synthetic, synthetic_truth, _, synthetic_metadata = window_views(root, prepared, metadata, "test")
    with np.load(prepared / "gru_data.npz", allow_pickle=False) as arrays:
        truth = arrays["y_test"]

    results = {}
    for name, path in runs.items():
        evaluation = read_json(path / "evaluation.json")
        threshold = evaluation["acceptance"]["threshold"]
        if evaluation["preprocessingMetadata"] != metadata:
            raise ValueError(f"{name} used different prepared data")
        with np.load(path / "predictions.npz", allow_pickle=False) as saved:
            np.testing.assert_array_equal(saved["sequence_ids"], metadata["sequenceIds"]["test"])
            np.testing.assert_array_equal(saved["y_true"], truth)
            scores = saved["probabilities"]
            clips = score(scores, truth, threshold)
            incorrect = scores.argmax(axis=1) != truth
            confusion_counts = Counter(zip(truth[incorrect], scores.argmax(axis=1)[incorrect]))
            confusions = [
                {"actual": labels[actual], "prediction": labels[predicted], "clips": count}
                for (actual, predicted), count in confusion_counts.most_common()
            ]
        model = tf.keras.models.load_model(path / evaluation["checkpoint"], compile=False)
        probabilities = model.predict(background, verbose=0)
        accepts = (probabilities.max(axis=1) >= threshold) & eligible
        false_accepts = {
            label: {"clips": sum(p["actual"] == label for p in probes),
                    "accepted": sum(bool(accept) for p, accept in zip(probes, accepts) if p["actual"] == label)}
            for label in ("REST", "IDLE_MOVEMENT")
        }
        if name == "v1":
            np.testing.assert_array_equal(accepts, [p["labGateAccept"] for p in probes])
        results[name] = {
            "version": evaluation["experiment"],
            "parameters": model.count_params(),
            "threshold": threshold,
            "rawMacroF1": evaluation["macroF1"],
            "thresholdedMacroF1": evaluation["acceptance"]["macroF1"],
            "original": clips,
            "originalConfusions": confusions,
            "syntheticWindows": score(model.predict(synthetic, verbose=0), synthetic_truth, threshold),
            "backgroundClips": false_accepts,
            "backgroundPredictions": [
                {"sequenceId": p["sequenceId"], "label": labels[int(values.argmax())],
                 "score": float(values.max()), "accepted": bool(accepted)}
                for p, values, accepted in zip(probes, probabilities, accepts)
            ],
        }
    write_json(output / "comparison.json", {
        "windowProbe": synthetic_metadata,
        "runs": results,
        "packages": {name: version(name) for name in ("numpy", "tensorflow", "scikit-learn")},
    })
    lines = [
        "# 43 Similar Signs v2 experiment",
        "",
        "All runs use the same 43 labels, source clips, split assignments, and training-fitted scaler.",
        "The split contains 2,671 training, 572 validation, and 573 test clips.",
        "Known source recordings stay in one split. Signers and collection batches can cross splits.",
        "This is a held-out clip comparison.",
        "",
        "V1 is the original seed-42 warm-start GRU with targeted augmentation and class weighting.",
        "V2 trains from scratch on the unaugmented frozen training split.",
        "Its parallel stride-1 Conv1D branches have 64 filters each with widths 3 and 7 and same padding.",
        "They feed GRU(128), dropout, Dense(64, ReLU), dropout, and the 43-class softmax.",
        "V2 vs. v1 compares the saved models. It also changes the training recipe.",
        "V2 checkpoints were selected by validation loss. Acceptance thresholds were selected on original validation clips.",
        "The 40-epoch cap, batch size 32, validation-loss patience 8, and starting learning rate 0.001 apply to both v2 runs.",
        "",
        "## Held-out clips",
        "",
        "| Model | Accuracy | Macro F1 | Threshold | Correct accepts | Wrong accepts | Rejections |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, row in results.items():
        clips = row["original"]
        lines.append(f"| {name} | {clips['correct'] / clips['clips']:.2%} | {row['rawMacroF1']:.2%} | "
                     f"{row['threshold']:.2f} | {clips['correctAccepted']} | {clips['wrongAccepted']} | "
                     f"{clips['rejected']} |")
    for name, row in results.items():
        confusions = [f"{x['actual']} → {x['prediction']} ({x['clips']})" for x in row["originalConfusions"][:4]]
        lines.extend(["", f"Most frequent {name} confusions by argmax are " + ", ".join(confusions) + "."])
    lines.extend([
        "",
        "## Window perturbations",
        "",
        "The window ablation samples raw training clips with seed 42 and appends one synthetic view per eligible selection.",
        "It varies timestamps and hand placement, adds short stationary observations at the start and end, then recomputes",
        "the model features. Validation and original test arrays keep their frozen form.",
        f"The stress probe applies these transforms to {len(synthetic_truth)} eligible held-out clips using seed 43.",
        "These probes measure sensitivity to simulated edge context in presegmented clips.",
        "",
        "| Model | Correct | Correct accepts | Wrong accepts | Rejections |",
        "| --- | ---: | ---: | ---: | ---: |",
    ])
    for name, row in results.items():
        clips = row["syntheticWindows"]
        lines.append(f"| {name} | {clips['correct']} | {clips['correctAccepted']} | {clips['wrongAccepted']} | "
                     f"{clips['rejected']} |")
    lines.extend([
        "",
        "## Frozen background clips",
        "",
        "The same 51 approved REST and IDLE_MOVEMENT clips from v1 were scored using capture, hand visibility, and",
        "model-score gates. The signer also contributed training signs. These counts apply to isolated background clips.",
        "",
        "| Model | REST false accepts | IDLE_MOVEMENT false accepts |",
        "| --- | ---: | ---: |",
    ])
    for name, row in results.items():
        cells = [f"{x['accepted']}/{x['clips']}" for x in row["backgroundClips"].values()]
        lines.append(f"| {name} | {' | '.join(cells)} |")
    lines.extend([
        "",
        "## Recognition Lab decision",
        "",
        "Use architecture-only v2 as an opt-in comparison against the v1 default. The window-augmented checkpoint is a",
        "separate experimental run. Held-out continuous accuracy, signer generalization, shortcut recall, and live",
        "confirmation delay still require annotated camera recordings.",
        "",
        "## Reproduction",
        "",
        "Run from the system repository root with the existing `.venv-gru` environment.",
        "Training refuses to overwrite completed model artifacts or an existing staging directory.",
        "",
        "```powershell",
        ".venv-gru/Scripts/python.exe scripts/train_similarity_v2.py",
        ".venv-gru/Scripts/python.exe scripts/train_similarity_v2.py --window-augmentation",
        ".venv-gru/Scripts/python.exe scripts/report_similarity_v2.py",
        "```",
        "",
        "- [Per-clip comparison details](comparison.json)",
        "- [V2 evaluation and per-label scores](evaluation.json)",
        "- [V2 threshold calibration](threshold_selection.json)",
    ])
    if not primary_only:
        lines.append(f"- [Window-augmented v2 evaluation](../../{augmented}/{augmented}/evaluation.json)")
    report = output / "REPORT.md"
    report.write_text("\n".join([*lines, ""]), encoding="utf-8")
    print(report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, default=DATASET)
    parser.add_argument("--primary-only", action="store_true")
    args = parser.parse_args()
    compare(args.dataset_root, args.primary_only)
