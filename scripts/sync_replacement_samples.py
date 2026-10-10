"""Replace the five re-recorded signs in samples.csv with dataset-v2 IDs.

The raw hand tracks give a provisional variant only when their evidence is
strong. FSL verification remains pending until a person reviews the take.
"""

from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent.parent.parent / "SignSync Dataset"
MANIFEST = ROOT / "manifests" / "samples.csv"
BACKUPS = MANIFEST.parent / "backups"
TARGETS = {"THANK_YOU", "SORRY", "PLEASE", "WAIT", "WAVE_GREETING"}
MANILA = timezone(timedelta(hours=8))


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    if not fields or any(set(row) != set(fields) for row in rows):
        raise ValueError(f"Invalid CSV columns: {path}")
    if len({row["sequence_id"] for row in rows}) != len(rows):
        raise ValueError(f"Duplicate sequence ID: {path}")
    return fields, rows


def tracked_variant(sequence: dict) -> str:
    frames = sequence["frames"]
    if not frames:
        return "UNKNOWN"
    counts = Counter(
        ("L" if frame["raw"]["leftHand"] is not None else "")
        + ("R" if frame["raw"]["rightHand"] is not None else "")
        for frame in frames
    )
    n = len(frames)
    left = (counts["L"] + counts["LR"]) / n
    right = (counts["R"] + counts["LR"]) / n
    both = counts["LR"] / n
    if left >= 0.8 and right <= 0.1:
        return "ONE_HAND_LEFT"
    if right >= 0.8 and left <= 0.1:
        return "ONE_HAND_RIGHT"
    if both >= 0.6:
        return "TWO_HAND"
    return "UNKNOWN"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    fields, old_rows = read_rows(MANIFEST)
    if len(old_rows) != 1200 or len(fields) != 9:
        raise ValueError("Expected the existing 1,200-row, nine-column manifest")
    old_by_id = {row["sequence_id"]: row for row in old_rows}
    new_rows = []
    new_ids = set()
    new_only = []
    for number in (1, 2, 3):
        participant = f"participant_{number:02d}"
        path = ROOT / "processed" / f"{participant}-dataset-v2.json"
        with path.open(encoding="utf-8") as stream:
            export = json.load(stream)
        sequences = export["sequences"]
        if len(sequences) != 400 or Counter(s["label"] for s in sequences) != Counter({label: 20 for label in export["labels"]}):
            raise ValueError(f"Unexpected dataset contents: {path}")
        for sequence in sequences:
            sid = sequence["id"]
            if sid in new_ids:
                raise ValueError(f"Duplicate v2 ID: {sid}")
            new_ids.add(sid)
            previous = old_by_id.get(sid)
            if previous is not None:
                if previous["participant_id"] != participant or previous["label"] != sequence["label"]:
                    raise ValueError(f"Existing sample identity changed: {sid}")
                new_rows.append(previous.copy())
                continue
            if sequence["label"] not in TARGETS:
                raise ValueError(f"Unexpected replacement label: {sequence['label']}")
            date = datetime.fromisoformat(sequence["createdAt"].replace("Z", "+00:00")).astimezone(MANILA).date()
            row = dict.fromkeys(fields, "")
            row.update(
                sequence_id=sid,
                label=sequence["label"],
                participant_id=participant,
                recording_session=f"{date.month}/{date.day}/{date.year}",
                technical_status="passed",
                variant=tracked_variant(sequence),
                fsl_verified="pending",
            )
            new_rows.append(row)
            new_only.append(row)

    kept = set(old_by_id) & new_ids
    removed = set(old_by_id) - new_ids
    if len(new_rows) != 1200 or len(kept) != 900 or len(removed) != 300 or len(new_only) != 300:
        raise ValueError("Expected 900 retained, 300 removed and 300 new IDs")
    if any(old_by_id[sid]["label"] not in TARGETS for sid in removed):
        raise ValueError("A non-target sign was removed")
    if Counter(row["participant_id"] for row in new_only) != Counter({f"participant_{i:02d}": 100 for i in (1, 2, 3)}):
        raise ValueError("Expected 100 replacement rows per participant")
    new_rows.sort(key=lambda row: (row["participant_id"], row["label"], row["recording_session"], row["sequence_id"]))

    counts = Counter(row["variant"] for row in new_only)
    print(f"Retained {len(kept)}; replaced {len(removed)} with {len(new_only)} new rows")
    print("New variants:", dict(sorted(counts.items())))
    for row in sorted((r for r in new_only if r["variant"] == "UNKNOWN"), key=lambda r: (r["participant_id"], r["label"], r["sequence_id"])):
        print("Review variant:", row["participant_id"], row["label"], row["sequence_id"])
    if args.dry_run:
        return

    BACKUPS.mkdir(exist_ok=True)
    backup = BACKUPS / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir()
    shutil.copy2(MANIFEST, backup / MANIFEST.name)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", dir=MANIFEST.parent,
                                         prefix="samples.", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\r\n")
            writer.writeheader()
            writer.writerows(new_rows)
        os.replace(temporary, MANIFEST)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    print("Backup:", backup / MANIFEST.name)
    print("Updated:", MANIFEST)


if __name__ == "__main__":
    main()
