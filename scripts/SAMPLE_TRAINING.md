# Training from sign folders

The source for new experiments is `SignSync Dataset/samples/<SIGN>/*.json`.
Each JSON contains one complete sample in the existing collector export format.
No participant folders or collector participant prompts are required.
`clean/` and existing merged exports remain historical provenance.

Run from the SignSync root using the existing GRU environment:

```powershell
.venv-gru/Scripts/python.exe scripts/generate_manifests.py
.venv-gru/Scripts/python.exe scripts/sample_pipeline.py prepare --config scripts/experiments/samples_geometry_v1.json --check-only
.venv-gru/Scripts/python.exe scripts/sample_pipeline.py prepare --config scripts/experiments/samples_geometry_v1.json
.venv-gru/Scripts/python.exe scripts/train_gru.py --prepared "../SignSync Dataset/processed/candidates/samples_geometry_v1" --check-only
```

The final command checks readiness without importing TensorFlow or training.
The starter `samples_geometry_v1` candidate has already been prepared; use its
readiness check directly. Repeating preparation protects that existing version.
To train, omit `--check-only`; optional `--seed` changes training randomness
without changing prepared splits. Outputs go to
`models/candidates/<version>/<version>[_seedN]/`. Existing outputs are protected.
For changed data, labels or splits, copy the experiment config with a new `name`.
All commands accept `--dataset-root`; put it before the subcommand for
`sample_pipeline.py`. The `--prepared` argument takes the actual folder path.
Legacy v5/v6 runners reproduce fixed experiments and do not discover new data.

## Review and approval

1. Add JSONs to `samples/<SIGN>/` and refresh the manifest.
2. Review `manifests/training-samples.csv` and `training-samples-audit.json`.
   New samples default to `pending`; explicitly set `approved` or `excluded`.
   Give exclusions a reason. Check gesture completeness, correct FSL meaning
   and camera framing manually in addition to the automated checks.
3. Keep anonymous `signer_id` where known; otherwise supply `source_recording`,
   `recording_session`, or `collection_batch` in the manifest. Optional sequence
   `metadata` keys are `signerId`, `recordingSession`, `collectionBatch`, and
   `sourceRecording`. Imported video fingerprints are detected automatically.
4. Tracking findings on new samples require a review explanation in `notes`
   before approval survives indexing. REST and IDLE_MOVEMENT may have no hands
   in view. Automatic checks cannot establish linguistic correctness.
5. Update a new config's `splitGroups` to cover every approved group for the
   configured labels. Shared signer, recording, session and batch identities
   are connected and cannot cross splits. Use globally meaningful session and
   batch IDs. Missing group identities or incomplete class coverage block prep.

Approvals are tied to checksums; changed files return to pending. Decisions and
notes survive refreshes, and previous manifests are backed up. Duplicate IDs
block preparation; repeated timestamped landmark content is excluded and
audited even across labels. Malformed files cannot train. Missing or invalid
previously approved files block prep until re-indexing and review. Adding files
never changes a frozen candidate.

The first index bootstraps the 1,753 previously reviewed samples only when ID,
label and checksum match the recorded sign-folder migration. Their previous
quality decisions are retained, with tracking findings visible. Historical
`samples.csv` and `excluded-samples.csv` are preserved; exclusions are respected.
New training uses `training-samples.csv`. `generate_manifests.py --legacy`
exists exclusively to reproduce the old merged-export manifest.

## Baseline and evaluation

```powershell
.venv-gru/Scripts/python.exe scripts/sample_pipeline.py reproduce
```

This writes nothing and checks all three current v5 folds: complete sample and
schema records, ID ordering, labels, original splits, feature tensors and scalers.
Historical validation shares training signers; reproduction preserves that
policy solely to establish parity.

The provided new config uses P1/P2 for training, P3 validation and P4 test:
800/400/400 samples for 20 signs. This is a new grouping of existing development
data, not a newly collected untouched final test. Do not use repeated test
results to choose candidates and call them final unseen-data results.

REST/IDLE samples remain available but are omitted from this config because P4
has no approved background samples. The optional
`scripts/experiments/samples_sign_rest_idle_v1.json` config uses only P1/P2/P3,
one signer each for training, validation and test, with all 22 labels. Check it
with the same preparation command and its own config path. `includeSignerIds`
explicitly selects a subset for an experiment without changing global sample
approvals. Every split must cover all selected labels. Missing signer IDs
limit conclusions to recording/batch grouping, not unseen-person performance.

Preparation retains 40 frames and all 238 geometry-v3 channels (164 landmarks,
26 handshape, 48 geometry), with scalers fitted on training only. Candidates
freeze their config, selected manifest, audit, schema, source checksums, split
IDs, arrays and source snapshots. Training checks these artifacts, uses the
existing GRU and validation early stopping, then selects an acceptance
threshold on validation macro F1 before evaluating test data. It saves per-sign
metrics, common confusions, predictions and REST/IDLE false detections when
those classes exist. Missing background data yields no rate, not zero.

Continuous idle -> sign -> idle testing is still required before promotion;
isolated samples cannot supply that evidence. Evaluate the selected candidate
on separately reviewed continuous recordings before changing live recognition.
The new candidate and offline threshold do not automatically replace the app's
current model or live acceptance settings.
