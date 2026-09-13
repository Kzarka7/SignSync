#!/usr/bin/env python3
"""
merge_dataset.py - Combine multiple SignSync dataset exports into one
training-ready file.

Why this exists: each export from the collector only contains whatever
samples were in the browser at that moment (one sign, one session/member).
By the time all 20 signs are recorded - especially across more than one
signer - you'll have many separate *.json files. This script merges all
of them into a single dataset.json with the same shape as any individual
export, so a training script only ever needs to load one file.

Usage:
    python merge_dataset.py ./exports --output combined-dataset.json
    python merge_dataset.py ./exports --check-only          # just print the report, don't write
    python merge_dataset.py ./my-samples.zip -o combined.json  # merge straight from a downloaded zip

The first argument can be:
  - a folder containing *.json export files (any mix of signs/sessions/
    members - the script figures out which sequences belong where from the
    file contents, not the filenames), or
  - a .zip file (e.g. straight from the collector's "Export as ZIP" button)
    - read directly, no need to extract it first.
"""

import argparse
import json
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def iter_json_sources(path: Path):
    """Yields (display_name, parsed_dict_or_None) for every .json entry
    found at `path` - a folder of loose files, or an unmodified .zip
    export. None means the entry existed but couldn't be parsed (bad JSON)."""
    if path.is_dir():
        for f in sorted(path.glob("*.json")):
            try:
                with f.open("r", encoding="utf-8") as fh:
                    yield f.name, json.load(fh)
            except (json.JSONDecodeError, OSError) as err:
                yield f"{f.name} ({err})", None
    elif path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            names = sorted(n for n in zf.namelist() if n.lower().endswith(".json") and not n.endswith("/"))
            for name in names:
                try:
                    with zf.open(name) as fh:
                        yield name, json.load(fh)
                except (json.JSONDecodeError, OSError) as err:
                    yield f"{name} ({err})", None
    else:
        raise SystemExit(f"{path} is neither a folder nor a .zip file")


def merge(path: Path) -> tuple[dict, list[str], int]:
    """Returns (merged_dataset, warnings, files_scanned)."""
    warnings: list[str] = []
    all_sequences = []
    seen_ids: set[str] = set()
    reference_schema = None
    reference_schema_file = None
    files_scanned = 0

    for name, data in iter_json_sources(path):
        files_scanned += 1

        if data is None:
            warnings.append(f"SKIPPED {name}: couldn't read/parse")
            continue

        if data.get("schemaVersion") != 1:
            warnings.append(
                f"SKIPPED {name}: unexpected schemaVersion "
                f"{data.get('schemaVersion')!r} (expected 1)"
            )
            continue

        schema = data.get("featureSchema")
        if reference_schema is None:
            reference_schema = schema
            reference_schema_file = name
        elif schema != reference_schema:
            warnings.append(
                f"SKIPPED {name}: featureSchema doesn't match "
                f"{reference_schema_file} - likely exported from a different "
                f"version of the pipeline. Re-export or investigate before merging."
            )
            continue

        for seq in data.get("sequences", []):
            seq_id = seq.get("id")
            if seq_id in seen_ids:
                warnings.append(
                    f"Duplicate sequence id {seq_id!r} in {name} - "
                    f"kept the first copy seen, skipped this one."
                )
                continue
            seen_ids.add(seq_id)
            all_sequences.append(seq)

    if reference_schema is None:
        raise SystemExit(
            "No valid export files found - nothing to merge. "
            "Check the path and that files are unmodified SignSync exports."
        )

    merged = {
        "schemaVersion": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "labels": sorted({seq["label"] for seq in all_sequences}),
        "sequenceCount": len(all_sequences),
        "featureSchema": reference_schema,
        "sequences": all_sequences,
    }
    return merged, warnings, files_scanned


def print_report(merged: dict, warnings: list[str], files_scanned: int) -> None:
    print(f"Scanned {files_scanned} file(s).")
    print(f"Merged sequences: {merged['sequenceCount']}")
    print(f"Labels found: {len(merged['labels'])}")
    print()

    counts = Counter(seq["label"] for seq in merged["sequences"])
    print("Samples per label:")
    for label in sorted(counts):
        n = counts[label]
        flag = "" if n == 20 else "  <-- not 20, check this one"
        print(f"  {label:20s} {n:3d}{flag}")

    if warnings:
        print()
        print(f"Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", type=Path, help="Folder of *.json exports, or a .zip export file")
    parser.add_argument("--output", "-o", type=Path, default=Path("combined-dataset.json"), help="Output file path (default: combined-dataset.json)")
    parser.add_argument("--check-only", action="store_true", help="Print the report only, don't write an output file")
    args = parser.parse_args()

    if not args.path.exists():
        raise SystemExit(f"Not found: {args.path}")
    if not args.path.is_dir() and args.path.suffix.lower() != ".zip":
        raise SystemExit(f"{args.path} is neither a folder nor a .zip file")

    merged, warnings, files_scanned = merge(args.path)
    print_report(merged, warnings, files_scanned)

    if args.check_only:
        print()
        print("(--check-only set: no output file written)")
        return

    with args.output.open("w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
    print()
    print(f"Wrote {args.output} ({merged['sequenceCount']} sequences, {len(merged['labels'])} labels)")


if __name__ == "__main__":
    sys.exit(main())
