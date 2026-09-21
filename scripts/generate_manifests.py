#!/usr/bin/env python3
"""Generate SignSync sample and exclusion manifests from merged datasets."""

from __future__ import annotations

import csv
import json
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


def read_existing_rows() -> dict[str, dict[str, str]]:
    if not SAMPLES_PATH.exists():
        return {}
    with SAMPLES_PATH.open("r", encoding="utf-8-sig", newline="") as file:
        return {
            row["sequence_id"]: row
            for row in csv.DictReader(file)
            if row.get("sequence_id")
        }


def recording_date(created_at: str) -> str:
    return created_at[:10] if created_at else ""


def main() -> None:
    existing = read_existing_rows()
    rows: list[dict[str, str]] = []

    for participant_id, dataset_path in PARTICIPANT_DATASETS.items():
        with dataset_path.open("r", encoding="utf-8") as file:
            dataset = json.load(file)

        for sequence in dataset["sequences"]:
            old = existing.get(sequence["id"], {})
            notes = old.get("notes", "")
            source_file = old.get("source_file", "")

            rows.append(
                {
                    "sequence_id": sequence["id"],
                    "label": sequence["label"],
                    "participant_id": participant_id,
                    "recording_session": recording_date(sequence.get("createdAt", "")),
                    "source_file": source_file,
                    "technical_status": "passed",
                    "variant": old.get("variant", "") or "UNKNOWN",
                    "fsl_verified": old.get("fsl_verified", "") or "no",
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
    with SAMPLES_PATH.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=sample_fields)
        writer.writeheader()
        writer.writerows(rows)

    exclusion_fields = [
        "sequence_id",
        "label",
        "participant_id",
        "reason",
        "replacement_sequence_id",
        "status",
    ]
    with EXCLUDED_PATH.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=exclusion_fields)
        writer.writeheader()
        for sequence_id, label, reason, replacement_id in EXCLUDED_SAMPLES:
            writer.writerow(
                {
                    "sequence_id": sequence_id,
                    "label": label,
                    "participant_id": "participant_01",
                    "reason": reason,
                    "replacement_sequence_id": replacement_id,
                    "status": "replaced",
                }
            )

    print(f"Wrote {len(rows)} approved rows to {SAMPLES_PATH}")
    print(f"Wrote {len(EXCLUDED_SAMPLES)} excluded rows to {EXCLUDED_PATH}")


if __name__ == "__main__":
    main()
