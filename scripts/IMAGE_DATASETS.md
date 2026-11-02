# Image dataset collector and processor

This is a standalone, catalog-based importer. The reserved dataset can stay in
its current location, outside both SignSync folders. `index --source` only reads
it. A separate processing workspace holds settings, catalogs, model assets,
landmarks, manifests and reports. No participant folders are required. No model
training, deployment, recognition-page changes or Git publication occurs.

## Existing pipeline inspected

- `Frontend/src/services/landmarks/visionRuntime.ts`: Tasks Vision 0.10.35,
  Hand Landmarker (two hands) and Pose Lite (one pose); hand detection/presence/
  tracking thresholds 0.5/0.4/0.4, pose thresholds 0.5/0.5/0.5. Highest-confidence
  detection wins if two hands receive the same category.
- `types/landmarks.ts` and `services/landmarks/normalize.ts`: nine pose points
  in nose, left/right shoulder, elbow, wrist, hip order; pose xyz + visibility,
  then left presence + 21 xyz points, then right presence + 21 xyz points = 164.
  XY is translated by the shoulder midpoint; xyz is divided by 3D shoulder
  distance. Z is not translated. No pose or shoulder distance below 0.02 makes
  the frame invalid and zero-filled. Missing hands remain null with zero
  feature blocks and explicit presence flags.
- `services/dataset/datasetExport.ts`: schemaVersion 1, one or more sequences,
  with timestamp, features, valid and raw landmarks in every frame.
- `scripts/preprocess_dataset.py`: baseline 40 x 164, linear index resampling,
  participant-based splitting, normalization fit on training data only. Its
  legacy one-frame repetition branch is never reached by this importer.
- `scripts/sample_pipeline.py`, `prepare_handshape_experiments.py` and
  `gesture_geometry.py`: current preparation is 40 x 238 (164 base, 26 handshape,
  48 geometry/first-observed channels), with reviewed per-sample files and
  connected provenance groups. The image processor reuses these feature
  functions and resamplers. It does not change the current training manifest.

The Python adapter uses the same model families and coordinate math. Its
MediaPipe runtime differs from the browser runtime; identical detection output
is **not** assumed. Runtime/package versions, asset hashes and options are saved.
The automated parity check executes the collector's actual TypeScript against
ten existing landmark fixture frames and compares its schema and conversion to
the Python implementation. This checks conversion, not detector equivalence.

## Where images go

Preferred: leave them in your reserved dataset folder and pass that folder as
`--source`. Choose its layout explicitly:

```text
External mixed dataset (--layout mixed):
<reserved-folder>/
  static/<SIGN>/image-001.jpg                 # one image = one sample
  sequences/<SIGN>/recording-001/frame-001.jpg # whole directory = one sample
                                      /frame-002.jpg

External static dataset (--layout static):
<reserved-folder>/<SIGN>/image-001.jpg

External sequence dataset (--layout sequences):
<reserved-folder>/<SIGN>/recording-001/frame-001.jpg
                                   /frame-002.jpg
```

If you prefer a managed inbox, these exact directories have been created:

```text
C:\Users\johng\OneDrive\Documents\Softwares\SignSync Dataset\image-import\
  inputs/static/<SIGN>/<image>.jpg
  inputs/sequences/<SIGN>/<recording-or-sample>/<frame>.jpg
  settings.json
  catalog.json                         # initial empty catalog; retained
  extractor/hand.task
  extractor/pose.task
  prepared/<run-version>/
```

For an external dataset with a different organization, create/edit the JSON
catalog: `source_root` is the absolute original dataset directory; each frame
path is relative to it. No copying or renaming of original files is necessary.
Symlinks or paths escaping `source_root` are refused. Sign folder names are
labels; safe folder characters are required. Nested static files and unsupported
files are reported as unindexed; list nested image paths explicitly in a catalog.

## Commands (PowerShell, from the project directory)

For a fresh image-processing environment, independently of training:

```powershell
Set-Location 'C:\Users\johng\OneDrive\Documents\Softwares\SignSync'
py -3.12 -m venv .venv-images
.\.venv-images\Scripts\python.exe -m pip install -r scripts/requirements-images.txt
.\.venv-images\Scripts\python.exe scripts/prepare_image_dataset.py init
.\.venv-images\Scripts\python.exe scripts/prepare_image_dataset.py models
```

`models` downloads Google's Hand Landmarker and Pose Lite v1 float16 task assets
to the workspace, preserving existing assets. `models --from-directory PATH`
can instead copy existing `hand.task` and `pose.task`. Settings store absolute
asset paths. Official APIs: [Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/python),
[Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python).

Index the reserved folder (replace the example path with its real location):

```powershell
$source = 'D:\ReservedSignImages'
$workspace = 'C:\Users\johng\OneDrive\Documents\Softwares\SignSync Dataset\image-import'
.\.venv-images\Scripts\python.exe scripts/prepare_image_dataset.py index --source $source --layout static --catalog "$workspace\reserved-v1.json"
```

Use `--layout sequences` or `--layout mixed` for those layouts. For the managed
inbox omit `--source` and use `--layout mixed`. `--root OTHER_WORKSPACE` before
the subcommand moves **all processor state** to a chosen location. You can use a
workspace entirely outside the existing dataset. `index` refuses to overwrite
catalogs; index additions to a new catalog, merge entries, and retain old IDs.

Review the generated catalog, then prepare:

```powershell
notepad "$workspace\reserved-v1.json"
.\.venv-images\Scripts\python.exe scripts/prepare_image_dataset.py prepare --catalog "$workspace\reserved-v1.json" --output "$workspace\prepared\reserved-v1"
```

Preparation is also safe before review: it extracts and reports, while unresolved
samples remain pending and do not enter tensors. Each output directory must be
new; change the version for another run. Source folders are read-only, and
external-source outputs must be outside the source tree.

## Catalog review and provenance

Every indexed sample gets a stable ID derived from kind and original relative
path (also external source location when applicable). Retain that ID when moving
or updating entries; checksums identify content changes. Source records include
`source_dataset`, `source_label`, `original_path`, `frames`, optional anonymous
`signer_id` and `signer_namespace`, `recording_id`, `session_id`, and
`related_group`. Null IDs stay null; no participants are invented. Only enter
signer IDs when reliable. Use the same `signer_namespace` across sources only
when there is reliable evidence that identities correspond. `related_group`
links augmentations/trims/adjacent-frame samples to their original recording;
use the same source and group ID for every derivative. Fill this before splitting.

Minimum fields to resolve for intended inclusion:

```json
{
  "source_dataset": "original-dataset-name-and-release",
  "label": "TARGET_SIGN",
  "source_label": "original label, unchanged",
  "mirrored": false,
  "mapping_verified": true,
  "sign_correctness_verified": true,
  "static_suitability_verified": true,
  "review_notes": "Who reviewed the source variant and why this is a static target"
}
```

Do not mechanically set review flags. A matching label string does not establish
the same regional/language/sign variant. Keep mappings unverified or give
different variants distinct target labels until reviewed by someone competent
in those signs. Technical validity and sign correctness are reported separately.
For dynamic signs, a single frame can be labeled as a handshape experiment
only; it is not evidence of a complete sign. For sequences, use
`complete_sign_verified: true` instead of the static suitability flag, only
after reviewing start/end boundaries and the complete movement.

For sequences, the catalog's `frames` must be an explicit ordered list:

```json
{
  "frames": ["HELLO/take-01/001.jpg", "HELLO/take-01/002.jpg", "HELLO/take-01/003.jpg"],
  "timestamps_ms": [0, 80, 160],
  "timing_reference": "original capture timestamp export"
}
```

Alternatively supply `fps` and a nonempty `timing_reference` identifying the
source metadata/documentation. File names, file modification times and guessed
30 FPS are not timing evidence. The indexer deliberately does **not** infer
frame order from file names. Missing order blocks extraction; missing timing
allows per-image extraction in IMAGE mode but blocks temporal export/tensors.
Timestamps must match frame count, be finite, nonnegative and increase by at
least 1 ms (Tasks VIDEO uses integer milliseconds). Timed sequences reset VIDEO
trackers per sample; unknown-timing/static inputs use IMAGE mode.

## Validation and mirroring

Duplicate decisions use content, never the filename alone:

| Case | Processing behavior |
|---|---|
| Same filename in different folders, different pixels | Separate sample IDs and independent extraction; no duplicate rejection based on name |
| Different filenames, identical bytes | Exact-copy warning; retain both original files and their provenance |
| Different filenames/encodings, identical oriented RGB pixels | Exact visual-copy warning; retain separate sample records |
| Similar but different images | Likely-duplicate review flag only; similarity is not proof of duplication |
| Exact copy assigned different labels | Resolve the conflicting labels during review before inclusion |

Every readable input is processed even when a duplicate is found. Only reviewed
samples enter training-ready arrays. For exact copies, normally retain one
representative for training to avoid giving repeated pixels extra weight; keep
other records and mark them excluded with a reason. Distinct images remain valid
sample candidates even if their filenames resemble one another. Augmentations
and adjacent frames remain linked to their source recording for splitting.

Full static imports reuse a stateless IMAGE-mode extractor and cache inference
by decoded pixel checksum. This avoids repeatedly running inference on exact
copies without merging sample identities. VIDEO trackers are still reset per
sequence. `extraction-checkpoint.jsonl` retains each extraction result, while
`progress.json` reports the current stage and completed count. A checkpoint is
an intermediate audit artifact, not an approved manifest or automatic resume.

- JPEG, PNG, WebP, BMP and TIFF: full decoding, dimensions (minimum 32 pixels
  per axis by default), EXIF orientation, actual format and suffix. Multi-frame
  images are blocked until explicitly exported as ordered frames. Originals
  remain untouched; EXIF orientation is applied in memory before detection.
- SHA256 for file bytes and decoded oriented RGB pixels detects exact copies,
  including lossless re-encodings. A 64-bit difference hash with Hamming distance
  <=4 flags likely visual duplicates. This is a heuristic with false positives
  and false negatives; exhaustive pair comparison suits modest imports, not
  millions of frames. Review large imports in deliberate batches with shared
  provenance; do not infer cross-batch isolation without a combined catalog.
- Record each raw hand category/score, absent hand, absent pose, normalization
  validity, shoulder visibility, hand/pose coverage, longest no-hand gap, wrist
  jumps and presence transitions. Default temporal gates require 80% usable
  pose references and 50% hand coverage. Five-frame no-hand gaps and large
  shoulder-normalized wrist jumps require quality review.
- Run an independent horizontally flipped IMAGE probe on every decoded image,
  recording original/flipped handedness categories and scores. Original pixels
  and categories are kept for actual features. The collector consumes MediaPipe
  categories directly on unflipped detector input, so the adapter does too.
  Mirroring can change categories and sign semantics. The probe does not prove
  anatomical hand identity, particularly if detection mode differs or a hand
  is missed. Set `mirrored` only from source documentation or reliable review.
  Mirrored sources require `quality_reviewed` and a review note before inclusion.
- Duplicate candidates require `duplicate_reviewed` plus `review_notes`. Tracking
  findings require `quality_reviewed` plus notes. Reject redundant copies with
  `include: false`; use flags only to retain intentional, reviewed cases. Exact
  duplicate copies with conflicting labels must be resolved manually.

## Features, splits and outputs

Static output is `(N,128)`: for each MediaPipe side, one presence flag and 21
wrist-relative xyz points scaled by wrist-to-middle-MCP distance. It works on
hand-only crops without pose. Missing/degenerate hands are zero-filled. A static
classifier such as a small MLP would need a 128-channel input and its own labels,
normalizer and evaluation. This loses body placement, motion, facial cues and
some two-hand relationships; it cannot replace the temporal recognizer. No
classifier is trained here.

Temporal output defaults to `(N,40,238)`, reusing current handshape/geometry
functions. Set `temporal_feature_set: "baseline164"` in settings for `(N,40,164)`.
Compute nonlinear descriptors on observed frames, interpolate documented time
onto a uniform grid, then use the existing 40-frame resamplers. Raw timestamps
remain in JSON. Uniform source timing follows the existing behavior; irregular
timing is respected. Interpolation is not reconstruction of unseen motion and
baseline channels can soften presence flags across missing detections. Review
gaps before accepting sequences. Model feature counts must match; the prepared
scaler is new and is never substituted into the deployed model.

Splits are deterministic connected groups: shared reliable signer, recording,
session, related group, exact content or likely visual duplicate links always
stay together, including links through excluded samples. Signer IDs are
namespaced by source unless an explicit reliable namespace is given. If any
sample from a source lacks a signer ID, that entire source is conservatively
linked together. This can produce only one split. **Source grouping alone does
not establish performance on unseen people.** Missing derivative/identity
metadata cannot be inferred reliably; preserve provenance before evaluation.

Groups are assigned toward training/validation/test fractions 70/15/15 with a
saved seed; labels are not guaranteed in every split. `evaluation_ready` is
false unless every split has every target label. Do not report accuracy as a
complete evaluation when it is false. Small datasets require more independent
groups rather than splitting a recording. All mean/std fits use training data
only, with float64 accumulation and zero-variance protection.

Each versioned output contains:

- `manifest.jsonl`: IDs, labels, original paths, source IDs, per-frame checksums,
  dimensions/orientation, mirrored probe findings, coverage, inclusion reasons,
  connected group, split and landmark paths.
- `static_samples/` and `sequence_landmarks/`: extracted raw and feature data,
  including pending samples, separated by target label.
- `compatible_samples/<SIGN>/<ID>.json`: included complete, timed sequences in
  collector schemaVersion 1. `review_samples/` holds technically compatible
  sequences still awaiting review. Static data never enters these folders.
- `static_data.npz` / `temporal_data.npz`: independent experiment arrays,
  labels per split and training-fitted feature_mean/feature_std. No artifact is
  written if that experiment has no included training samples.
- `report.json`: per-sign counts, usable counts, warnings, exclusions, hand
  usage, missing metadata, split IDs/labels/shapes and evaluation readiness.
- `catalog.snapshot.json`, `settings.json`, `environment.json`,
  `preparation_source/`, `artifact_checksums.json`: frozen source catalog,
  parameters, package versions, model hashes, extractor settings and script
  snapshots to reproduce and audit the run.

The compatible JSON files pass `sample_pipeline.load_sample`. Keep the image
processor's frozen splits when using these files. Do not feed them through the
legacy participant splitter or mix them into active manifests automatically:
that would discard the image-specific provenance/grouping decisions. Future
training must explicitly select these independent artifacts and compatible
feature/model settings.

## Verification

```powershell
.\.venv-images\Scripts\python.exe -m unittest discover -s scripts -p test_prepare_image_dataset.py
.\.venv-images\Scripts\python.exe scripts/verify_image_dataset.py --output .tmp/image-verification-new --real-extractor
```

The parity test also requires Node and the project's installed Frontend
dependencies. Tests verify real collector conversion, schema compatibility,
orientation, grouping, frame/timing gates, deterministic reproduction,
preservation of originals, external source reading and training-only statistics.

Saved verification from this implementation:

- `.tmp/image-processor-verification-v4/fixture-report/report.json`: synthetic
  noise images with explicitly injected landmarks, 19 samples (9 usable static,
  9 usable sequences, 1 corrupt image excluded). Synthetic review/identity flags
  exercise the inclusion paths; they are not sign correctness evidence.
- `.tmp/image-processor-verification-v4/real-extractor-report/report.json`:
  real local MediaPipe IMAGE and VIDEO models on clearly labeled blank-image
  negative fixtures (one static and one two-frame sequence); no hands detected,
  both excluded as expected. This validates runtime integration,
  not extraction accuracy on real signs or handedness correctness.
- `../SignSync Dataset/image-import/prepared/empty-workflow-v1/report.json`:
  initialized empty-inbox workflow, zero samples, no training arrays.

At initial implementation, the existing 410 dataset-tree image files were
documentation/review/model artifacts and were not treated as a new sign dataset.
The subsequently added alphabet import has now completed extraction of 11,700
images from `raw/image-datasets/alphabet-v1`. Its output is
`processed/image-datasets/alphabet-v1`. Extraction does not approve sign
correctness. See [IMAGE_REVIEW.md](IMAGE_REVIEW.md) for the review assistant and
generated review package; the active catalog and originals remain preserved.
