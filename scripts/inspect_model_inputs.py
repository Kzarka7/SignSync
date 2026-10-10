"""Inspect saved model inputs by original sequence ID; never modifies datasets.

python scripts/inspect_model_inputs.py --experiment gru_p01_p03_train_p02_test_v1 --ids FULL_ID
Writes diagnostic JSON, Markdown, and PNGs under private documentation/input-inspections.
"""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent / "SignSync Dataset"
FINGERS = ("index", "middle", "ring", "pinky")


def resample(values, length):
    positions = np.linspace(0, len(values) - 1, length)
    return np.stack([np.interp(positions, np.arange(len(values)), values[:, j])
                     for j in range(values.shape[1])], axis=1)


def hand_metrics(values, order, hand):
    """2D projected geometry, not calibrated anatomical angles or FSL validity."""
    def xy(name):
        return values[:, [order.index(f"{hand}.{name}.{axis}") for axis in "xy"]]
    presence = values[:, order.index(f"{hand}.present")]
    wrist = xy("wrist")
    scale = np.linalg.norm(xy("middle_mcp") - wrist, axis=1)
    valid = np.isclose(presence, 1, atol=1e-5) & (scale > 1e-6)
    extension, angles = [], []
    for finger in FINGERS:
        extension.append(np.linalg.norm(xy(finger + "_tip") - wrist, axis=1) / np.maximum(scale, 1e-12))
        u, v = xy(finger + "_mcp") - xy(finger + "_pip"), xy(finger + "_dip") - xy(finger + "_pip")
        denom = np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1)
        angle = np.degrees(np.arccos(np.clip((u*v).sum(axis=1)/np.maximum(denom, 1e-12), -1, 1)))
        angle[denom < 1e-12] = np.nan
        angles.append(angle)
    extension, angle = np.mean(extension, axis=0), np.mean(angles, axis=0)
    extension[~valid] = np.nan
    angle[~valid] = np.nan
    return extension, angle, presence


def median(values):
    finite = values[np.isfinite(values)]
    return float(np.median(finite)) if len(finite) else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--ids", nargs="+", required=True, help="Full original sequence IDs")
    args = parser.parse_args()
    if Path(args.experiment).name != args.experiment:
        parser.error("Use an experiment folder name")
    folder = ROOT / "processed" / args.experiment
    meta = json.loads((folder / "metadata.json").read_text())
    sequences, participants = {}, {}
    order = None
    for path in meta["trainSources"] + [meta["testSource"]]:
        payload = Path(path).read_bytes()
        if hashlib.sha256(payload).hexdigest() != meta["sourceSha256"][path]:
            raise ValueError(f"Source changed since preprocessing: {path}")
        data = json.loads(payload)
        if order is not None and order != data["featureSchema"]["order"]:
            raise ValueError("Feature order mismatch")
        order = data["featureSchema"]["order"]
        for s in data["sequences"]:
            if s["id"] in sequences:
                raise ValueError("Duplicate source ID")
            sequences[s["id"]] = s
    rows, inspected = [], {}
    with np.load(folder / "gru_data.npz", allow_pickle=False) as arrays:
        mean = arrays["feature_mean"].reshape(-1).astype(float)
        std = arrays["feature_std"].reshape(-1).astype(float)
        if not np.isfinite(mean).all() or not np.isfinite(std).all() or np.any(std <= 0):
            raise ValueError("Invalid standardization statistics")
        for split, suffix in (("training", "train"), ("validation", "validation"), ("test", "test")):
            ids = meta["sequenceIds"][split]
            if len(ids) != len(arrays["X_"+suffix]):
                raise ValueError("Tensor/ID count mismatch")
            for index, sid in enumerate(ids):
                s = sequences[sid]
                if s["label"] not in ("SORRY", "PLEASE") and sid not in args.ids:
                    continue
                tensor = arrays["X_"+suffix][index].astype(float)
                if arrays["y_"+suffix][index] != meta["labelToIndex"][s["label"]]:
                    raise ValueError(f"Label mismatch: {sid}")
                original = np.asarray([f["features"] for f in s["frames"]], dtype=np.float32)
                expected = resample(original, len(tensor))
                recovered = tensor * std + mean
                if not np.allclose(recovered, expected, atol=2e-5, rtol=2e-5):
                    raise ValueError(f"Saved tensor differs from independent resampling: {sid}")
                hand = max(("leftHand", "rightHand"), key=lambda h: original[:,order.index(h+".present")].sum())
                before = hand_metrics(original, order, hand)
                after = hand_metrics(recovered, order, hand)
                fractional = {h: int(((expected[:,order.index(h+".present")]>1e-6) & (expected[:,order.index(h+".present")]<1-1e-6)).sum()) for h in ("leftHand", "rightHand")}
                row = dict(id=sid, label=s["label"], participant=meta["participantIds"][split][index], split=split,
                           tensor_row=index, original_frames=len(original), model_frames=len(tensor), dominant_detected_hand=hand,
                           max_reconstruction_error=float(np.abs(recovered-expected).max()),
                           original_extension=median(before[0]), resampled_extension=median(after[0]),
                           original_pip_angle=median(before[1]), resampled_pip_angle=median(after[1]),
                           fractional_presence_frames=fractional)
                rows.append(row)
                if sid in args.ids:
                    inspected[sid] = (original, recovered, before, after, row)
    if set(args.ids) != set(inspected):
        raise ValueError(f"IDs missing from experiment: {set(args.ids)-set(inspected)}")
    output = ROOT / "documentation" / "input-inspections" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output.mkdir(parents=True, exist_ok=False)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from compare_landmarks import HAND_CONNECTIONS
    for sid, (original, recovered, before, after, row) in inspected.items():
        fig, ax = plt.subplots(2, 2, figsize=(12, 8))
        fig.suptitle(f"{row['participant']} {row['label']} | {sid}\n{row['split']} tensor row {row['tensor_row']} (zero-based)", fontsize=11)
        valid = np.flatnonzero(np.isfinite(before[0]))
        raw_index = int(valid[len(valid)//2]) if len(valid) else 0
        new_index = round(raw_index / max(1,len(original)-1) * (len(recovered)-1))
        for axis, values, frame, title in ((ax[0,0],original,raw_index,"Original exported features"),(ax[0,1],recovered,new_index,"Actual tensor: standardization reversed")):
            names = [n for n in order if n.startswith(row['dominant_detected_hand']+'.') and n.endswith('.x')]
            indices = [[order.index(n),order.index(n[:-1]+'y')] for n in names]
            xy = values[frame,np.asarray(indices)]
            for a,b in HAND_CONNECTIONS:axis.plot(xy[[a,b],0],xy[[a,b],1],color='tab:blue',lw=1)
            axis.scatter(xy[:,0],xy[:,1],s=14)
            axis.set_title(f"{title}\nFrame {frame+1}/{len(values)}",fontsize=10)
            axis.set_aspect('equal');axis.invert_yaxis();axis.set_xlabel('Shoulder-normalized x');axis.set_ylabel('Shoulder-normalized y')
        for j, name in enumerate(("Mean fingertip distance / palm length", "Projected PIP angle (degrees)")):
            axis=ax[1,j]
            axis.plot(np.linspace(0,1,len(original)),before[j],'.-',label='Original')
            axis.plot(np.linspace(0,1,len(recovered)),after[j],'.--',label='40-frame input (unstandardized)')
            axis.set_title(name,fontsize=10);axis.set_xlabel('Sequence progress by frame index');axis.legend(fontsize=8);axis.grid(alpha=.2)
        fig.tight_layout(rect=(0,0,1,.92));fig.savefig(output/(sid[:8]+'.png'),dpi=140);plt.close(fig)
    groups = defaultdict(list)
    for row in rows:
        if row['split'] != 'validation':groups[(row['participant'],row['label'],row['split'])].append(row)
    lines=['# Model input inspection', '',f'Experiment: {args.experiment}', '',
           'All inspected tensor labels and IDs matched source data; all source hashes matched preprocessing metadata.',
           'Saved inputs matched an independent resampling calculation after reversing standardization within float32 tolerance.', '',
           '## Cohort comparison', '', 'Values below are medians of per-sequence medians, using the most frequently detected hand. Training rows exclude validation samples.', '',
           '| Participant / sign / split | Samples | Extension original → resampled | PIP angle original → resampled | Samples with fractional hand presence |',
           '|---|---:|---:|---:|---:|']
    for key, group in sorted(groups.items()):
        agg=lambda name: float(np.median([r[name] for r in group if r[name] is not None]))
        lines.append(f"| {' / '.join(key)} | {len(group)} | {agg('original_extension'):.3f} → {agg('resampled_extension'):.3f} | {agg('original_pip_angle'):.1f} → {agg('resampled_pip_angle'):.1f} | {sum(any(r['fractional_presence_frames'].values()) for r in group)} |")
    lines+=['','## Selected sequence IDs','']
    for sid, (*_,row) in inspected.items():
        lines += [f"- {sid}: {row['label']}, {row['split']} row {row['tensor_row']}; {row['original_frames']} → {row['model_frames']} frames; reconstruction error {row['max_reconstruction_error']:.3g}; fractional presence {row['fractional_presence_frames']}.",f"  ![Handshape inspection]({sid[:8]}.png)"]
    lines += ['', '## Interpretation limits', '',
              '- Geometry plots use the inverse-standardized tensor; the model itself receives standardized values. These are collector features, not raw camera coordinates.',
              '- Measures use projected x/y coordinates. Camera angle, finger foreshortening, motion stage and tracking affect them; they are descriptive diagnostics, not FSL validation or a classifier.',
              '- Geometric summaries exclude frames where the selected hand is absent or its interpolated presence is fractional. The model still receives those frames.',
              '- Resampling can blend absent-hand zero coordinates with detected coordinates; fractional presence identifies such transitions, not automatically defective recordings.',
              '- Matching tensor values establishes pipeline consistency, not which features caused a learned model decision.',
              '- No datasets, manifests, preprocessing outputs or models were modified.']
    (output/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    (output/'measurements.json').write_text(json.dumps(rows,indent=2,allow_nan=False),encoding='utf-8')
    print('Inspection complete. See report.md for results.');print('OUTPUT',output)


if __name__ == '__main__':
    main()
