#!/usr/bin/env python3
"""Generate SignSync sample and exclusion manifests from merged datasets."""

from __future__ import annotations

import csv
import json
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path


PROJECT_FOLDER = Path(__file__).resolve().parent.parent
DATASET_FOLDER = PROJECT_FOLDER.parent / "SignSync Dataset"
PROCESSED_FOLDER = DATASET_FOLDER / "processed"
MANIFEST_FOLDER = DATASET_FOLDER / "manifests"
SAMPLES_PATH = MANIFEST_FOLDER / "samples.csv"
EXCLUDED_PATH = MANIFEST_FOLDER / "excluded-samples.csv"

PARTICIPANT_DATASETS = {
    "participant_01": PROCESSED_FOLDER / "participant_01-dataset.json",
    "participant_02": PROCESSED_FOLDER / "participant_02-dataset.json",
    "participant_03": PROCESSED_FOLDER / "participant_03-dataset.json",
}

EXCLUDED_SAMPLES = [
    ("74f464dd-2251-4657-9293-104d114d80f8", "THANK_YOU", "long internal hand-detection gap", "b0a3c6f5-21f7-4924-955b-7039067f0c3b"),
    ("e78d190e-5de5-4fc3-82b3-1ac4a063cef7", "THANK_YOU", "long internal hand-detection gap", ""),
    ("068befde-2414-490b-abd0-649ebc630afc", "THANK_YOU", "long internal hand-detection gap", ""),
    ("dcdf4991-d67b-4ba3-a062-0cef97b3dc0a", "THANK_YOU", "long internal hand-detection gap", ""),
    ("37b5fd76-b308-49d5-b5ce-1c93556a9bef", "THANK_YOU", "long internal hand-detection gap", ""),
    ("eb9bc84d-a64f-4fab-b68b-d277a05beca4", "THANK_YOU", "long internal hand-detection gap", ""),
    ("eed1581a-fd67-4f3a-a1b0-e58e7cb1c312", "THANK_YOU", "long internal hand-detection gap", ""),
    ("c2472ed3-21c8-4418-9e18-9fe9b7488c73", "THANK_YOU", "long internal hand-detection gap", ""),
    ("df81b401-c57a-4c10-bb6c-2a61145729a8", "THANK_YOU", "long internal hand-detection gap", ""),
    ("233cd2f8-ff48-453f-94b1-7b8cdc7d73c1", "THANK_YOU", "long internal hand-detection gap", ""),
    ("1a2e47e4-918e-4a80-90cb-03287fe082ba", "THANK_YOU", "long internal hand-detection gap", ""),
    ("42aa6968-c854-47f3-b48f-bded6eb372cf", "THANK_YOU", "long internal hand-detection gap", ""),
    ("19f1125c-3565-4be5-ad63-317d90b9feec", "THANK_YOU", "long internal hand-detection gap", ""),
    ("e0e771d5-fdc7-4d33-bf16-ca4250fc9843", "WAVE_GREETING", "long internal hand-detection gap", "341650ea-05e9-4044-9bbe-4ce10b6fe88b"),
]


def read_existing_rows(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    rows = {}
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            sequence_id = row.get("sequence_id")
            if not sequence_id or sequence_id in rows:
                raise ValueError(f"{path}: missing or duplicate sequence ID")
            rows[sequence_id] = row
    return rows


def recording_date(created_at: str) -> str:
    return created_at[:10] if created_at else ""


def main() -> None:
    existing = read_existing_rows(SAMPLES_PATH)
    excluded = read_existing_rows(EXCLUDED_PATH)
    rows: list[dict[str, str]] = []
    selected_ids: set[str] = set()

    for participant_id, dataset_path in PARTICIPANT_DATASETS.items():
        with dataset_path.open("r", encoding="utf-8") as file:
            dataset = json.load(file)

        for sequence in dataset["sequences"]:
            if not sequence.get("id") or sequence["id"] in selected_ids:
                raise ValueError("Missing or duplicate selected sequence ID")
            selected_ids.add(sequence["id"])
            old = existing.get(sequence["id"], {})
            if old and (old.get("participant_id") != participant_id or old.get("label") != sequence["label"]):
                raise ValueError(f"Identity changed for {sequence['id']}; review before regenerating")
            notes = old.get("notes", "")
            source_file = old.get("source_file", "")

            rows.append(
                {
                    **old,
                    "sequence_id": sequence["id"],
                    "label": sequence["label"],
                    "participant_id": participant_id,
                    "recording_session": old.get("recording_session", recording_date(sequence.get("createdAt", ""))),
                    "source_file": source_file,
                    "technical_status": old.get("technical_status", "passed"),
                    "variant": old.get("variant", "UNKNOWN"),
                    "fsl_verified": old.get("fsl_verified", "pending"),
                    "notes": notes,
                }
            )

    rows.sort(
        key=lambda row: (
            row["participant_id"],
            row["label"],
            row["recording_session"],
            row["sequence_id"],
        )
    )

    for sequence_id, label, reason, replacement_id in EXCLUDED_SAMPLES:
        excluded.setdefault(sequence_id, {
            "sequence_id": sequence_id, "label": label,
            "participant_id": "participant_01", "reason": reason,
            "replacement_sequence_id": replacement_id, "status": "replaced",
        })
    # Private exclusion decisions stay with the dataset, outside the repository.
    for path in sorted((DATASET_FOLDER / "documentation").glob("participant_*-*-exclusion-*/exclusion.json")):
        decision = json.loads(path.read_text(encoding="utf-8-sig"))
        sequence_id = decision["sequence_id"]
        excluded.setdefault(sequence_id, {
            "sequence_id": sequence_id, "label": decision["label"],
            "participant_id": decision["participant_id"], "reason": decision["reason"],
            "replacement_sequence_id": decision.get("replacement_sequence_id") or "",
            "status": decision["status"],
        })
    if selected_ids & excluded.keys():
        raise ValueError("Excluded sequences are still in a selected dataset")
    if existing.keys() - selected_ids - excluded.keys():
        raise ValueError("Previously selected sequences disappeared without an exclusion record")

    MANIFEST_FOLDER.mkdir(parents=True, exist_ok=True)
    sample_fields = [
        "sequence_id",
        "label",
        "participant_id",
        "recording_session",
        "source_file",
        "technical_status",
        "variant",
        "fsl_verified",
        "notes",
    ]
    exclusion_fields = [
        "sequence_id",
        "label",
        "participant_id",
        "reason",
        "replacement_sequence_id",
        "status",
    ]
    backup = MANIFEST_FOLDER / "backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True)
    for path in (SAMPLES_PATH, EXCLUDED_PATH):
        if path.exists():
            shutil.copy2(path, backup / path.name)
    for path, fields, output_rows in (
        (SAMPLES_PATH, sample_fields, rows),
        (EXCLUDED_PATH, exclusion_fields, list(excluded.values())),
    ):
        fields = fields + sorted({key for row in output_rows for key in row} - set(fields))
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as file:
                temporary = Path(file.name)
                writer = csv.DictWriter(file, fieldnames=fields)
                writer.writeheader()
                writer.writerows(output_rows)
            temporary.replace(path)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()

    print(f"Wrote {len(rows)} selected rows to {SAMPLES_PATH}")
    print(f"Wrote {len(excluded)} excluded rows to {EXCLUDED_PATH}")
    print(f"Previous manifests backed up to {backup}")


if __name__ == "__main__":
    main()
