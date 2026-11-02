# Review an extracted static image dataset

`review_image_dataset.py` reuses a completed image preparation run. It produces
technical proposals and visual review materials, not sign-correctness approvals
or trained models. Original images, the original catalog and extracted run are
never edited. The reviewer supports static images only.

## Open the generated alphabet review

The real alphabet package is in:

```text
C:\Users\johng\OneDrive\Documents\Softwares\SignSync Dataset\image-import\review\alphabet-v1-review-v1\
```

Open `index.html` in a browser. It links to all letter sheets and exception
sheets. Each sheet contains at most 80 thumbnails; all 450 images of each letter
are available, not just selected examples. Red borders mean proposed exclusion,
amber means unresolved technical review, and green means a technical candidate.
**None of these colors verifies sign correctness.**

Files:

- `summary.json` and `REPORT.md`: counts, candidate balance, pending findings and
  evaluation limitations.
- `proposed-catalog.json`: the automatically updated copy, with proposed
  exclusions and deterministic exact-copy representatives. The active catalog
  remains unchanged.
- `decisions.json`: per-sample actions, reasons, similarity IDs and outlier scores.
- `exact-groups.json`: exact-copy groups, representative IDs and label conflicts.
- `similarity-pairs.csv`: pairs flagged by the existing visual similarity check.
- `batches.json`: full IDs belonging to each letter review batch.
- `review-decisions.json`: the small editable file for your actual approvals.
- `package.json` and `review-script.py`: input hashes, reproducible policy and a
  snapshot of the reviewer implementation.

## What is automatic

The reviewer checks that current source bytes still match their extraction
checksums. Changed or missing files are excluded from the proposal until they
are re-extracted. It proposes excluding unreadable images and unusable hand
detections; it does not invent landmarks for them. These exclusions apply to
this landmark-based experiment, not to every possible future image classifier.

Exact-copy groups use **byte equality or oriented decoded RGB pixel equality**,
never filenames. Within a same-label group, keep one technically usable
representative, preferring decoded resolution and then stable ID. Other records
get `include: false` with an explicit redundant-copy reason. All originals and
their sample records remain available. Identical pixels assigned different
letters are flagged as label conflicts instead of guessing a correct label.

Similar but unequal images stay separate. Similarity flags do not exclude them.
Similarity links already covered by exact equality are omitted from the human
similarity queue. Within each letter/hand-side group, robust median/MAD distances
flag unusual 128-channel hand features. These outliers are review hints, not
proof of wrong signs; the source image and detected geometry can both be unusual.
No model is trained to score or validate the labels.

Source, language, alphabet variant, mirroring, signer identity and semantic
correctness are not inferred from letter names, filenames or feature clusters.

## Review once per batch, with individual overrides only for exceptions

Edit `review-decisions.json`, not 11,700 catalog entries. Leave unknown fields
null and leave approval flags false until reviewed. First fill shared metadata:

The current alphabet decision file contains only the 24 static letter batches
(A-Z except J/Z), shared source metadata and an empty optional `samples` map.
Its small `managed_decisions` reference loads `review-managed.json`, which holds
the already-decided invalid I/1.jpg-I/208.jpg exclusions, J/Z exclusions and
verified filename mappings. The sidecar's SHA256 is checked before application;
do not edit it manually or delete it. The editable file is about 10 KB rather
than listing thousands of machine-managed records. Existing apply commands work
unchanged. Explicit exclusions are applied before batch approvals, so approving
I does not mark the rejected thumb-placement samples as correct. Original images
remain preserved in the source archive.

```json
"dataset_metadata": {
  "confirmed": true,
  "source_dataset": "alphabet-v1",
  "original_source_name": "actual original dataset/release, if known",
  "sign_language": "the documented sign language",
  "alphabet_variant": "the documented alphabet/region",
  "mirrored": null,
  "notes": "Evidence or source documentation supporting these fields"
}
```

`confirmed` means you have checked the metadata; it does not approve every image.
Dataset-wide `mirrored` must remain null if flips differ or documentation is
unclear. Per-letter or per-sample `mirrored: true/false` can override the default.
Do not equate MediaPipe's detected Left/Right category with source mirroring.

After checking a letter's pages, its batch can be approved:

```json
"letter-A": {
  "approve": true,
  "mapping_verified": true,
  "sign_correctness_verified": true,
  "static_suitability_verified": true,
  "accept_similarity": true,
  "accept_outliers": false,
  "quality_findings_accepted": false,
  "notes": "What was checked and why these images match the intended static target"
}
```

Approval applies only to the surviving candidate records in that letter. It
does not re-include automatic exclusions. `accept_similarity` accepts similarity
findings for that reviewed batch without merging or deleting the different
images. Leave `accept_outliers` false if those samples still need individual
review. Set `quality_findings_accepted` only after reviewing tracking findings
or mirrored-source semantics; this is optional and separate from sign approval.
Motion-dependent letters require a suitable **static handshape target**, not a
claim that one image captures their whole movement.

For exceptions, add full sample IDs under `samples`:

```json
"samples": {
  "img-REPLACE_WITH_FULL_ID": {
    "action": "exclude",
    "notes": "Incorrect or ambiguous handshape; kept in source archive"
  }
}
```

An individual `keep` can accept `accept_similarity`, `accept_outlier`, and
`quality_findings_accepted`, with evidence in `notes`. It cannot override a
technical failure without fixing/re-extracting it first. To correct a label,
provide `label`; prior semantic approvals for that entry are reset. Explicit
per-entry semantic approvals may then be supplied with confirmed source metadata
and notes. Source labels and original paths remain preserved. Label conflicts
stay pending until the retained exact copies agree on the corrected label or
the conflicting records are excluded.

## Commands

Generate another version when extraction/source data changes:

```powershell
Set-Location 'C:\Users\johng\OneDrive\Documents\Softwares\SignSync'
$dataset = 'C:\Users\johng\OneDrive\Documents\Softwares\SignSync Dataset'
.\.venv-gru\Scripts\python.exe scripts/review_image_dataset.py generate --prepared "$dataset\processed\image-datasets\alphabet-v1" --output "$dataset\image-import\review\alphabet-v1-review-v2"
```

After editing the decisions in the existing package, create a NEW reviewed
catalog (no extraction or training occurs):

```powershell
$review = "$dataset\image-import\review\alphabet-v1-review-v1"
.\.venv-gru\Scripts\python.exe scripts/review_image_dataset.py apply --package $review --decisions "$review\review-decisions.json" --output "$dataset\image-import\alphabet-reviewed-v1.json"
```

The apply command verifies frozen package/extraction hashes, checks source bytes
again for retained samples, requires explicit review notes, and writes a paired
`alphabet-reviewed-v1.changes.json` audit. It refuses to overwrite catalogs.
It does not replace the active catalog or start preparation/training.

For verified filename-only renames, `review-decisions.json` may contain
`source_path_updates`, keyed by the original sample ID. Each entry specifies
`from`, `to` and `sha256`. Application checks the old path/checksum against the
frozen extraction and checks the new file's bytes before updating `frames`.
The original `id` and `original_path` remain unchanged, and `sourcePathHistory`
records the rename. Frozen review packages and source images are not modified.

Only after review, a separate preparation command can consume the reviewed
catalog and create an independent new version. Unresolved custom findings are
enforced by `prepare_image_dataset.py` alongside its existing quality and
semantic gates. This prevents similarity, outlier or label conflicts from being
ignored simply because other approval flags are true.

## Evaluation limitation

The existing imported alphabet has no reliable signer/session/recording IDs.
The importer conservatively links unknown identities from the same source.
Source grouping alone cannot establish unseen-person performance. Randomly
splitting visually related files to create validation/test scores is not a fix.
Collect reliable provenance or an independent evaluation dataset before claiming
generalization. Training-ready arrays are not produced by this review tool.

## Verification

```powershell
.\.venv-gru\Scripts\python.exe -m unittest discover -s scripts -p test_review_image_dataset.py
.\.venv-gru\Scripts\python.exe -m unittest discover -s scripts -p test_prepare_image_dataset.py
```

Synthetic tests cover filename independence, content equality, conflicting
labels, representative selection, similarity preservation, changed sources,
outlier flags, explicit batch approvals, enforced pending findings, generated
contact sheets and preservation of original catalogs.
