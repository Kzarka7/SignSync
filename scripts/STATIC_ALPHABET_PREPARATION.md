# Reviewed 24-letter static alphabet preparation

Entry point: `scripts/prepare_reviewed_static_dataset.py`. This reuses verified
landmarks from the completed image import. It does not call landmark detectors,
fit a classifier, train a model, deploy anything, or change recognition pages.
Dataset evaluation here means data quality, balance, duplicate and leakage
checks. It does not mean measured recognition accuracy.

## Current output

```text
C:\Users\johng\OneDrive\Documents\Softwares\SignSync Dataset\
  processed\image-datasets\alphabet-24-static-v1\
```

Inputs are the completed `processed/image-datasets/alphabet-v1` extraction,
`image-import/alphabet-24-static-review-v4.json` and its approval receipt, plus
the current compact review decisions and their verified managed sidecar.
The original extraction, raw images, sample IDs and review decisions remain
unchanged. Source files renamed to numbers are resolved through the reviewed
catalog's current frame paths and validated against the original extraction
checksums. Original source paths remain in provenance.

The retained target is A-Z excluding J and Z. I/1.jpg-I/208.jpg stay excluded for
incorrect thumb placement; only reviewed, technically usable remaining I samples
are retained. Earlier technical and redundant-copy exclusions also stay in force.

## Reproduce into a new directory

Run from the SignSync project root. No MediaPipe import/runtime setup is needed
because this step reuses cached raw landmarks:

```powershell
Set-Location 'C:\Users\johng\OneDrive\Documents\Softwares\SignSync'
$dataset = 'C:\Users\johng\OneDrive\Documents\Softwares\SignSync Dataset'
.\.venv-gru\Scripts\python.exe scripts/prepare_reviewed_static_dataset.py --extracted "$dataset\processed\image-datasets\alphabet-v1" --catalog "$dataset\image-import\alphabet-24-static-review-v4.json" --review-decisions "$dataset\image-import\review\alphabet-v1-review-v1\review-decisions.json" --output "$dataset\processed\image-datasets\alphabet-24-static-v2"
```

The output directory must be new. If review decisions change, apply them to a
new reviewed catalog first and pass that catalog instead. Its receipt must match
the catalog, current review decisions and managed decisions hashes.

The extraction's saved checksums validate the checkpoint, original manifest,
catalog, extractor environment and settings. Every included image's current
bytes are compared to its original SHA256. All selected 128-channel feature
vectors are recomputed from the cached raw landmarks and compared to the cache;
malformed/non-finite vectors, invalid presence masks and nonzero missing-hand
blocks are rejected. Changed source images require a new extraction, not silent
reuse of old landmarks.

## Unknown mirroring policy

Source mirroring remains **unknown**, recorded as `null`. A mirror probe or a
MediaPipe Left/Right category does not establish the original capture convention.
This preparer keeps the decoded source orientation, raw coordinates and detector
hand categories unchanged. It does not guess a mirror value or flip images.

For this reviewed static experiment, unknown mirroring is permitted only when
mapping, sign correctness, static suitability and quality have all been
explicitly approved. The policy and warning counts are saved with the output.
This permits preparation of visually accepted handshapes while retaining the
uncertainty for later robustness evaluation. It does not prove anatomical hand
identity or equivalent accuracy across mirrored and unmirrored real inputs.

The general image preparer's default mirroring gate is unchanged; this is an
explicit policy for the reviewed static preparation step. Temporal samples and
unreviewed static samples do not gain this exception. No approval is invented.

## Artifacts

- `static_data.npz`: `X_train`, `X_validation`, `X_test`, corresponding integer
  labels, `feature_mean` and `feature_std`. Input width is 128. Statistics use
  float64 accumulation and **training data only**. Constant-feature scales are
  set to one. No parameters of a recognition model are fitted.
- `raw_static_features.npz`: selected wrist-relative, palm-scaled 128-channel
  vectors before dataset standardization, with stable IDs, labels and label map.
  "Raw" here does not mean image pixels or unnormalized MediaPipe landmarks.
- `feature_schema.json`: exact column names, coordinate/normalization rules and
  missing-hand convention. One presence flag plus 21 xyz points per hand. This
  is a static classifier input, separate from the temporal 40-frame models.
- `labels.json`, `splits.json`, `class_counts.csv`: fixed target order, per-split
  sample IDs, per-letter retained counts and detected hand usage.
- `manifest.jsonl`: current image paths/checksums, original extraction paths,
  stable IDs, inclusion/exclusion reasons, review state and connected split
  groups. Existing per-sample landmark JSON files are referenced rather than
  copied into another 9,000-file tree.
- `evaluation.json` and `REPORT.md`: data-quality evaluation, class balance,
  missing metadata, warnings, readiness distinctions and remaining requirements.
  `retained_warning_counts` counts historical warning occurrences, including
  separate similarity links from one image to several peers. Some peers are now
  excluded. These accepted audit flags are not counts of remaining exact copies;
  `included_exact_duplicates` is the fresh audit of the retained pool.
- `catalog.snapshot.json`, `approval_receipt.json`, `review_inputs/`,
  `extraction_environment.json`, `settings.json`, `preparation_source/`,
  `reproduction.json`, `artifact_checksums.json`: approval, extraction, feature
  and script provenance needed to reproduce the preparation.

After writing, the preparer reopens the arrays and checks shapes, finiteness,
exact ID/label alignment, group isolation, training-fitted statistics and every
standardized value against the source feature vectors.

## Evaluation outcome and next data needed

The imported alphabet has no reliable signer, recording or session IDs.
Related frames and augmentations cannot be reliably separated. Existing
conservative grouping links this source together; the preparation does not
invent identities or split by individual file/letter to make a test set.

For the current data, all retained images therefore form a **training pool**.
Validation and test arrays are intentionally empty. `training_pool_prepared`
can be true while `evaluation_ready` remains false. An empty evaluation split
is not a failed extraction and is not evidence of model accuracy.

Before model selection and recognition evaluation:

1. Obtain independently recorded validation and test samples for all 24 target
   letters, with correct thumb placement, verified target sign variants and
   reliable anonymous signer/recording/session IDs.
2. Keep every frame, trim, augmentation and derivative of an original recording
   in the same split. Preserve source capture orientation and mirroring metadata
   where known. Reflect actual intended camera conditions in the new data.
3. Document the separation from training. If the imported source's signer
   identities remain unknown, a separately collected source is useful but does
   not by itself prove that every test person is unseen. State that limit.
4. Fit preprocessing on the training partition only, freeze the evaluation sets,
   then train and evaluate only when explicitly requested.

J and Z need complete videos or ordered sequences with documented timing for
complete-letter temporal recognition; their still images are not substitutes.
No recognition accuracy, F1, confusion matrix or model comparison is produced
without a compatible trained model and a valid evaluation set.

## Tests

```powershell
.\.venv-gru\Scripts\python.exe -m unittest discover -s scripts -p test_prepare_reviewed_static_dataset.py
.\.venv-gru\Scripts\python.exe -m unittest discover -s scripts -p test_prepare_image_dataset.py
.\.venv-gru\Scripts\python.exe -m unittest discover -s scripts -p test_review_image_dataset.py
```

Tests use clearly synthetic images and injected landmarks. They check cache and
source integrity, deterministic arrays, conservative grouping, empty evaluation
splits when provenance is insufficient, unknown-mirroring policy boundaries,
exclusion enforcement and training-only scaling despite extreme held-out values.
