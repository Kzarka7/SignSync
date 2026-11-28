# 32 Signs motion recipe retraining

**What was asked:** check how many samples per sign 32 Signs (standalone v3) was trained on. Then compare a retrain with the motion recipe (motion only, and motion + augmentation) against the current v3 recipe, and train the winner.

**What changed**
- Dataset vault work note: `SignSync Dataset/documentation/2026-11-24 32 Signs Motion Recipe Retraining.md`, linked from `Dataset Guide.md`.
- New experiment `SignSync Dataset/experiments/samples_32_signs_motion_v1/`:
  - `run_batches.py` (unseen-batch folds) and `features.py` (two-hand sign-motion-v1, copied from the 43-sign experiment);
  - `summarize.py`, `train_final.py`, `run_all.sh`, `REPORT.md`, `summary.json`;
  - `results/` (18 runs) and `logs/`.
- New candidate `SignSync Dataset/models/candidates/samples_32_signs_motion_v1/sign_motion_v1_aug_all_clips_seed42/`: all 1,299 clips, 12 epochs, threshold 0.53.
- No changes to the repo code, the backend or Recognition Lab.

**Results (tested on a batch the model never trained on; 3 seeds × 2 folds)**
- v3 features: 32.7%.
- Motion: 53.8%.
- Motion + augmentation: 55.3% (macro F1 0.527).
- All three score about 99% on new clips from batches they trained on.

**Decisions and caveats**
- **Samples:** v3 has 40 clips per sign (BAD 59), and only about 28 per sign were in its training split.
- **Why the gap:** each sign's two batches are two recording setups (numbered 2560×1440 uploads vs Windows Camera 1920×1080). So each fold trains on one setup and is tested on the other. v3's 95% came from mixing both setups into its training and test sets.
- **Hand folding:** half of each one-handed batch is left-hand takes. The motion features fold these to the dominant hand, so mirrored clips score the same as the originals.
- **Weakest signs:** the main remaining confusions are face-location pairs (FATHER/MOTHER, GRANDMOTHER/GRANDFATHER→MOTHER, PERSON/STUDENT, ROOM/HAPPY).
- **Shared CPU:** runs went one at a time on 2 threads because the 43-sign motion runs were using the CPU at the same time.

**Not done / open**
- The candidate is not wired into the app and v3 stays active. Next options:
  - record a third setup per sign;
  - add face-relative hand position to the features;
  - check the candidate on real camera clips.

Related: [[Project Home]]

## Plain train_gru.py retrain (same day)

**What was asked:** retrain 32 Signs through `train_gru.py` like previous models, without motion features or augmentation.

**What changed**
- Ran `scripts/train_gru.py --prepared` on `processed/candidates/samples_32_signs_standalone_v3` (v3 features, v3 split and scaler, no augmentation: 910 training rows).
- Output: `SignSync Dataset/models/candidates/samples_32_signs_standalone_v3_train_gru/seed42/`. The dataset work note was updated.

**Results:** test 98.5% (191/194), macro F1 0.985, best epoch 38, threshold 0.23. For comparison, v3 scored 99.0% (192/194) with threshold 0.71.

**Decisions and caveats**
- v3 was trained by a custom trainer (`samples_32_signs_standalone_v1/train_standalone.py`), not `train_gru.py`.
- The split still mixes both recording setups. The same recipe scored 32.7% when tested on an unseen setup.
- The 0.23 threshold is very low.

**Not done / open:** the motion + augmentation version through the same pipeline; nothing is wired into the app.

## Archive and 60-clip preparation (same day)

**What was asked:** archive and compress the 40-clip `train_gru.py` model, then prepare a 32-sign candidate from all 1,920 clips, including the 621 newer ones. No training.

**What changed**
- **Archive:** `models/candidates/samples_32_signs_standalone_v3_train_gru/` became `models/archive/samples_32_signs_standalone_v3_train_gru.zip`.
  - It is recorded in `documentation/model-candidates-archive-20261110/manifest.json`, and `archive.py --verify` passes.
- **Approvals:** 621 pending clips approved in `manifests/training-samples.csv`, with notes. The backup is `manifests/backups/20261124T081948519597Z/`. `index --write` reports 6,609 approved and 1 pending (an unrelated SEVEN clip).
- **Config:** `SignSync Dataset/experiments/samples_32_signs_standalone_v4/config.json` (made by `make_config.py`).
- **Prepared:** `processed/candidates/samples_32_signs_standalone_v4` (1,345 / 288 / 287).

**Decisions and caveats**
- The v3 clips keep their split, so v3's test clips stay test clips. The new clips are split 14/3/3 per sign. Recording setups still cross splits.
- The HELLO-named BAD webcam clip is kept as BAD. Its features are nearest an approved BAD clip.

**Not done / open:** training v4 (plain, then motion + augmentation); integrating a model into Recognition Lab.

## v4 trained (same day)

**What was asked:** train the prepared 60-clip candidate (v4) through `train_gru.py`. Run `graphify update` only when the user says.

**What changed**
- Model: `SignSync Dataset/models/candidates/samples_32_signs_standalone_v4/samples_32_signs_standalone_v4/` (best epoch 85 of 100).
- The dataset work note was updated.

**Results**
- Test 97.6% (280/287), macro F1 0.975, threshold 0.78.
- On v3's 194 test clips it got 189 right (v3: 192). On the 93 new-setup test clips it got 91 right.

**Decisions and caveats**
- The first start ended in a duplicate start, with no model written. That partial folder is kept as `_incomplete_start_20261124T163851/`. The rerun used a lock.
- Recording setups still cross splits.

**Not done / open**
- Not in Recognition Lab.
- Motion + augmentation version of v4 not yet prepared or trained.
- graphify update not run (waiting for the user).

## v4 in Recognition Lab (same day)

**What was asked:** add v4 to Recognition Lab and keep v3. Explain how the Lab's v3 differs from the 32.7% result.

**What changed**
- `Backend/app/recognition.py`:
  - new mode `lab-signs32-standalone-v4`, plus a `STANDALONE_MODES` set;
  - hand-slot swap on for v4;
  - `train_gru.py` checkpoint rule extended to v4;
  - recognizer ID `lab-signs32-standalone-v4-seed42-graph-diagnostics`.
- `Backend/app/ws/translate.py`: display name.
- Frontend:
  - `types/message.ts`: the new mode;
  - `RecognitionLabPage.tsx`: menu entry "32 Signs (standalone v4, 60 clips per sign)";
  - `recognitionDiagnostics.ts`: continuous sign transitions, same as v3.
- Tests: `test_diagnostic_recognition.py`, `diagnosticPredictor.test.cjs`.
- Dataset: `experiments/samples_32_signs_standalone_v4/verify_checkpoint.py`, which wrote the model's `checkpoint_verification.json`.

**Verified**
- Backend 41 OK (2 skipped). Frontend 366/366. `tsc -b` passes.
- The real loader loads v3 (0.71) and v4 (0.78).
- A temporary backend on port 8001 returned ready for both, then was stopped.

**Decisions and caveats**
- The 32.7% was config A: v3's features, trained on one recording setup and tested on the other. It was not the Lab model.
- The Lab's v3 scored 57.8% on the 621 new-setup clips it never saw.

**Not done / open**
- No real camera or video test of v4.
- graphify update not run (waiting for the user).
- The motion + augmentation run is still pending.

## v4 leave-one-setup-out comparison (same day)

**What was asked:** run motion + augmentation for v4 using a three-round leave-one-setup-out comparison with seed 42 only. All 1,920 clips must be used.

**What changed**
- New `SignSync Dataset/experiments/samples_32_signs_v4_setup_holdout/` (`setups.py`, `run_setups.py`, `summarize.py`, `REPORT.md`, `summary.json`, `results/`, `logs/`).
- Setups A, B and C have 640 clips each (20 per sign). Every clip is tested once.

**Results (pooled over all 1,920 test clips)**
- Plain v4: 49.1% (A 52.3, B 49.8, C 45.0).
- Motion + augmentation: 64.8% (A 64.8, B 74.7, C 54.8).

**Decisions and caveats**
- FAST has no Windows Camera batch; its 1920×1080 named batch is used as B.
- Practice-run epochs were short (5–7) and the thresholds aren't usable live.
- GOOD is 0% in every round, and several signs fail as whole batches. That points to differences between recording setups or labels; the batches need review.

**Not done / open**
- Final motion + augmentation model on all clips (not to go in the Lab).
- Batch review.
- graphify update not run.

## P4 clips added, v5 prepared (same day)

**What was asked:** check `raw/processed-samples` for the 32 signs (GRANDFATHER has more than 60 clips across 4 batches). Add the missing clips to `samples/`, and prepare a candidate that trains like v4. No training.

**What changed**
- 12 signs had a fourth participant batch (P4, .MOV, 640×360): 222 clips, never in `samples/`. The other 20 signs have no extra clips.
- `SignSync Dataset/experiments/samples_32_signs_standalone_v5/intake.py` copied them byte-for-byte to `samples/<SIGN>/` and wrote `intake.json`.
- Manifest re-indexed; the 222 clips approved with notes. Backup `manifests/backups/20261124T094803151029Z/`. Batch IDs use `collector-zip:<ZIP SHA-256>`.
- `make_config.py` wrote `config.json`: 2,142 clips, split 1,499 / 322 / 321 (v4 split kept; P4 split 70/15/15 per sign).
- `processed/candidates/samples_32_signs_standalone_v5` prepared, and the `train_gru.py --check-only` readiness check passed.
- The dataset work note was updated.

**Decisions and caveats**
- Setups A/B/C are participants P3/P2/P1, so the earlier setup holdout was effectively leave-one-participant-out.
- P4 signed one-handed signs with one consistent hand. P1–P3 used both hands, so the existing data already covers both slots.

**Not done / open**
- v5 not trained.
- graphify update not run (no repo code changed).

## v5 trained (same day)

**What was asked:** train v5 the same way as v4 (`train_gru.py`, plain).

**What changed**
- Model: `SignSync Dataset/models/candidates/samples_32_signs_standalone_v5/samples_32_signs_standalone_v5/`.
- The dataset work note was updated.

**Results**
- Test 97.2% (312/321), macro F1 0.972, threshold 0.52, best epoch 25 of 40.
- On v4's old test clips: 279 of 287 correct (v4: 280). On the new P4 test clips: 33 of 34.

**Decisions and caveats**
- The Lab's v4 on all 222 unseen P4 clips scored 58.6%. FATHER, GRANDFATHER and PARENTS were 0% for P4.
- A background start ran twice again, and its lock stopped it before training. The run that produced the model was in the foreground.

**Not done / open**
- v5 not in Recognition Lab.
- graphify update not run.

## v5 in Recognition Lab (same day)

**What was asked:** add v5 to Recognition Lab.

**What changed**
- Backend:
  - `Backend/app/recognition.py`: mode `lab-signs32-standalone-v5`, added to `STANDALONE_MODES` and `HAND_SWAPPED_TRAINING` (68% of training clips swapped), plus the `train_gru.py` checkpoint rule and the 32-class entry;
  - `ws/translate.py`: display name.
- Frontend:
  - `types/message.ts`: the new mode;
  - `RecognitionLabPage.tsx`: "32 Signs (standalone v5, adds P4 clips)";
  - `recognitionDiagnostics.ts`: continuous sign transitions, same as v3 and v4.
- Tests: `test_diagnostic_recognition.py`, `diagnosticPredictor.test.cjs`.
- Dataset: `experiments/samples_32_signs_standalone_v5/verify_checkpoint.py`, which wrote `checkpoint_verification.json`.

**Verified**
- Backend 41 OK (2 skipped). Frontend 366/366. `tsc -b` passes.
- The real loader loads v3 (0.71), v4 (0.78) and v5 (0.52).
- A temporary backend on port 8001 returned ready for all three, then was stopped.

**Not done / open**
- No real camera or video test.
- Nothing committed.
- graphify update not run (waiting for the user).

## v5 retrained with motion + augmentation

**What was asked:** retrain 32 Signs standalone v5 with motion + augmentation features.

**What changed:**
- New experiment `SignSync Dataset/experiments/samples_32_signs_standalone_v5_motion/` (`common.py`, `train_candidate.py`, `run_lopo.py`, `summarize.py`, `REPORT.md`).
- New candidate `models/candidates/samples_32_signs_standalone_v5_motion/samples_32_signs_standalone_v5_motion_seed42/`.
- v5 test split: 98.8% (317/321) vs plain v5 97.2%. Leave-one-participant-out pooled: 69.6% vs 49.4%; unseen P4: 58.6% vs 40.1%.
- Dataset work note updated: [[2026-11-24 32 Signs Motion Recipe Retraining]].

**Decisions and caveats:** validation picked threshold 0.00 (not usable live); best epoch 3; one seed; LOPO rounds trained only 5 epochs. No SignSync code changed; plain v5 is still the Lab model.

**Not done / open:** Recognition Lab wiring (sign-motion-v1 recognizer + live threshold); camera test; review of GOOD/BAD/AGAIN/MAYBE/PERSON batches. `graphify update .` was not run.

## v5 motion model added to Recognition Lab

- **What changed:** new `Backend/app/sign_motion_recognition.py` and `scripts/sign_motion_features.py`. Edits to `Backend/app/recognition.py`, `Backend/app/ws/translate.py`, `Backend/tests/test_diagnostic_recognition.py`, `Frontend/src/types/message.ts`, `Frontend/src/pages/RecognitionLabPage.tsx`, `Frontend/src/services/landmarks/recognitionDiagnostics.ts` and `Frontend/tests/diagnosticPredictor.test.cjs`.
- **Verified:** real load reproduces the 321 test predictions; WebSocket returns ready; backend 45 OK, frontend 366/366, `tsc -b` passes.
- **Caveats:** Lab threshold 0.52 (saved 0.00 is unusable). Not camera-tested. Nothing committed. `graphify update .` was not run.

## Lab capture export for the STUDENT bias

- **What changed:** `Frontend/src/services/landmarks/recognitionDiagnostics.ts` stores each segmented prediction's model input (`rows[].modelInputFrames`, capped at 600, 5 decimals) and reports `modelInputExport`. New test in `Frontend/tests/continuousRecognition.test.cjs`. New `scripts/analyze_lab_captures.py`.
- **Verified:** frontend 367/367, `tsc -b` passes, backend OK; the analysis script ran on a synthetic export (exact and fallback paths).
- **Open:** real live exports of PERSON/STUDENT/TEACHER still needed. Nothing committed. `graphify update .` was run afterwards at the user's request (2,610 nodes, 7,292 edges).
