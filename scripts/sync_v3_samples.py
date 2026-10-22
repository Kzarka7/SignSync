"""Back up samples.csv and replace P1/P2 FRIEND and WHERE with v3 recordings."""

from __future__ import annotations
from processed_paths import processed_artifact_path

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile

from sync_replacement_samples import BACKUPS, MANIFEST, MANILA, ROOT, read_rows, tracked_variant

TARGETS = {"FRIEND", "WHERE"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    fields, old_rows = read_rows(MANIFEST)
    if len(old_rows) != 1200 or len(fields) != 9:
        raise ValueError("Expected the 1,200-row, nine-column v2 manifest")
    old_by_id = {row["sequence_id"]: row for row in old_rows}
    new_rows = []
    new_only = []
    new_ids = set()
    for number in (1, 2, 3):
        participant = f"participant_{number:02d}"
        path = processed_artifact_path(ROOT / "processed", f"{participant}-dataset-v3.json")
        with path.open(encoding="utf-8") as stream:
            export = json.load(stream)
        sequences = export["sequences"]
        if len(sequences) != 400 or Counter(s["label"] for s in sequences) != Counter({label: 20 for label in export["labels"]}):
            raise ValueError(f"Unexpected dataset contents: {path}")
        for sequence in sequences:
            sid = sequence["id"]
            if sid in new_ids:
                raise ValueError(f"Duplicate v3 ID: {sid}")
            new_ids.add(sid)
            previous = old_by_id.get(sid)
            if previous is not None:
                if previous["participant_id"] != participant or previous["label"] != sequence["label"]:
                    raise ValueError(f"Existing sample identity changed: {sid}")
                new_rows.append(previous.copy())
                continue
            if participant == "participant_03" or sequence["label"] not in TARGETS:
                raise ValueError(f"Unexpected replacement sample: {participant} {sequence['label']} {sid}")
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

    retained = set(old_by_id) & new_ids
    removed = set(old_by_id) - new_ids
    expected = Counter({("participant_01", "FRIEND"): 20, ("participant_01", "WHERE"): 20,
                        ("participant_02", "FRIEND"): 20, ("participant_02", "WHERE"): 20})
    if len(new_rows) != 1200 or len(retained) != 1120 or len(removed) != 80 or len(new_only) != 80:
        raise ValueError("Expected 1,120 retained and 80 replacement samples")
    if Counter((r["participant_id"], r["label"]) for r in new_only) != expected:
        raise ValueError("New samples differ from the four requested participant/sign groups")
    if Counter((old_by_id[sid]["participant_id"], old_by_id[sid]["label"]) for sid in removed) != expected:
        raise ValueError("Removed samples differ from the four requested participant/sign groups")
    if len({r["sequence_id"] for r in new_rows}) != 1200:
        raise ValueError("Duplicate manifest ID")
    new_rows.sort(key=lambda row: (row["participant_id"], row["label"], row["recording_session"], row["sequence_id"]))

    print("Retained 1,120 rows; replaced 80 rows with 80 v3 samples", flush=True)
    print("New variants:", dict(sorted(Counter(row["variant"] for row in new_only).items())), flush=True)
    for row in sorted((r for r in new_only if r["variant"] == "UNKNOWN"),
                      key=lambda r: (r["participant_id"], r["label"], r["sequence_id"])):
        print("Review variant:", row["participant_id"], row["label"], row["sequence_id"], flush=True)
    if args.dry_run:
        return

    BACKUPS.mkdir(exist_ok=True)
    backup = BACKUPS / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True)
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
    print("Backup:", backup / MANIFEST.name, flush=True)
    print("Updated:", MANIFEST, flush=True)


if __name__ == "__main__":
    main()
