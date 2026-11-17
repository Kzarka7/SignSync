"""Generate synthetic Lab windows using checked raw clips and the v1 scaler."""

import numpy as np

from prepare_similarity_pilot import shifted
from sample_pipeline import load_sample, read_csv, read_json
from shape_motion_sequence import raw_shape_motion_features


MIN_WINDOW_MS = 400
MAX_WINDOW_MS = 4000


def vary_window(sequence, rng):
    speed = rng.uniform(.8, 1.25)
    preview = shifted(sequence, dx=rng.uniform(-.05, .05), dy=rng.uniform(-.12, .12), time_scale=speed)
    frames = preview["frames"]
    times = np.asarray([frame["timestamp"] for frame in frames])
    if not MIN_WINDOW_MS <= times[-1] <= MAX_WINDOW_MS or len(frames) < 8:
        return None
    # A Lab capture can start with pre-roll and end after the pose settles.
    # Preserve all clip observations and simulate only short stationary edges.
    interval = np.clip(np.median(np.diff(times)), 15, 60)
    placements = rng.uniform([0, 0], [100, 200])
    before = np.arange(1, 1 + int(placements[0] / interval)) * interval
    after = np.arange(1, 1 + int(placements[1] / interval)) * interval
    window = [
        *[dict(frames[0], timestamp=float(-t)) for t in before[::-1]],
        *frames,
        *[dict(frames[-1], timestamp=float(times[-1] + t)) for t in after],
    ]
    if len(window) > 240 or window[-1]["timestamp"] - window[0]["timestamp"] > MAX_WINDOW_MS:
        return None
    if (np.mean([f["valid"] for f in window]) < .8
            or np.mean([f["valid"] and (f["features"][36] == 1 or f["features"][100] == 1)
                        for f in window]) < .5):
        return None
    return dict(preview, frames=window)


def window_views(root, prepared, metadata, split):
    rows = read_csv(prepared / "samples.csv")
    order = read_json(prepared / "feature_schema.json")["order"]
    seed = 42 if split == "training" else 43
    rng = np.random.default_rng(seed)
    examples = []
    targets = []
    source_ids = []
    for sid in metadata["sequenceIds"][split]:
        if split == "training" and rng.random() >= .4:
            continue
        row = rows[sid]
        export, sequence, checksum, _ = load_sample(root / row["sample_path"], row["label"])
        if checksum != row["sha256"] or sequence["id"] != sid or export["featureSchema"]["order"] != order:
            raise ValueError(f"Frozen {split} sample differs from its manifest: {sid}")
        view = vary_window(sequence, rng)
        if view is None:
            continue
        examples.append(raw_shape_motion_features(view, order).astype(np.float32))
        targets.append(metadata["labelToIndex"][row["label"]])
        source_ids.append(sid)

    with np.load(prepared / "gru_data.npz", allow_pickle=False) as data:
        tensor = (np.stack(examples) - data["feature_mean"]) / data["feature_std"]
    if tensor.shape != (len(source_ids), 40, 238) or not np.isfinite(tensor).all():
        raise ValueError("Invalid window feature tensor")
    return tensor, np.asarray(targets), source_ids, {
        "seed": seed,
        "split": split,
        "rows": len(source_ids),
        "sourceIds": source_ids,
        "timestampScale": [.8, 1.25],
        "horizontalOffsetShoulderWidths": [-.05, .05],
        "verticalOffsetShoulderWidths": [-.12, .12],
        "nominalPreRollMs": 100,
        "nominalTailMs": 200,
        "captureLimitsMs": [MIN_WINDOW_MS, MAX_WINDOW_MS],
    }
