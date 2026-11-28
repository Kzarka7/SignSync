# INDEXING and POSSESSIVES batch check

**What was asked**
Check the new INDEXING and POSSESSIVES samples in `SignSync Dataset/raw/processed-samples/`. Each sign should have 3 batches of 20 samples. Read only, with no dataset or model updates.

**What changed**
- Nothing in the dataset changed. A read-only Python audit (`.venv-ml` interpreter, scripts kept in the session scratchpad) opened all 36 ZIPs.
- 12 signs (IX-1/1pl/2/2pl/3/3pl, POSS-1/1pl/2/2pl/3/3pl), each with 3 ZIPs dated 2026-11-18/19, 2026-11-21 and 2026-11-23.
- Every ZIP holds 20 JSONs: 720 samples in total, with 720 unique IDs and no duplicate video fingerprints.
- The label matches the folder and the review label in every sample. All have 164 features per frame, no invalid frames and no null features. All are marked `completeSign: true` and were processed with `video-import-v5-mp0.10.35-gesture-context`.
- Each batch is split roughly 10 left-hand / 10 right-hand.

**Decisions and caveats**
- Filenames upper-case the `pl` suffix (for example `IX_1PL-<id>.json` for label `IX-1pl`). This affects 360 files across all three batches. It is harmless if loaders use the JSON label.
- The new 2026-11-23 batch differs from the earlier ones:
  - It was recorded at about 20 fps; earlier batches are about 30 fps.
  - Clip lengths are almost fixed: about 1.34–1.46 s for singular signs and about 1.88–1.95 s for `pl` signs.
  - IX-2 is the exception, with 591–1057 ms clips of only 12–21 frames.
- Flagged "Review" samples in the new batch: IX-2pl 3, POSS-2pl 3, POSS-3 1. The 2026-11-21 batch has more, for example IX-2pl 7, POSS-3 7 and IX-1pl/IX-3pl 6 each.

**Not done / open**
- Samples have not been added to training or `samples/`, and the model has not been retrained (the user said not to update yet).
- Whether the 20 fps fixed-length capture and the short IX-2 clips are intended is still open.

## Intake and candidate preparation (same day)

**What was asked:** if the batches are usable, process and prepare them, then propose a training plan without training.

**What changed**
- Scripts are in `SignSync Dataset/experiments/samples_12_signs_ix_poss_batch_holdout_v1/`: `intake.py`, `approve.py`, `make_config.py`. Their outputs `intake.json` and `config.json` are in the same folder.
- `intake.py` copied all 720 ZIP members byte-for-byte to `samples/<LABEL>/<LABEL>-<id>.json` (12 folders × 60). Every file passed `load_sample` and builds 40×238 shape-motion-v1 features. Two files have "internal hand tracking gap ≥5 frames".
- `sample_pipeline.py index --write` reported 0 problems and no duplicates against the existing 6,142 samples. `approve.py` then set the 720 rows to approved, with `collection_batch=collector-zip:<zip sha256>` and the DEAF/MONEY-style note ("Independent FSL review pending").
- After re-indexing, the manifest has 6,860 approved and 2 pending (the existing BAD and SEVEN rows). Backups are in `manifests/backups/`.
- Froze `processed/candidates/samples_12_signs_ix_poss_batch_holdout_v1`: 12 labels, 384/96/240.
  - Test is one whole unseen batch per sign, rotated by date. Training and validation are 16+4 from each of the other two batches.
  - `train_gru.py --check-only` passed. No training was run.

**Not done / open (at that point):** training was waiting for approval. FSL review of the IX/POSS forms is still pending.

## Phase 1 pilot training and Recognition Lab entry (same day)

**What was asked:** run the Phase 1 pilot, add it to Recognition Lab after training, and don't run `graphify update .`.

**What changed**
- **Training:** `train_gru.py` ran on the candidate with seeds 42, 1 and 2. Logs and `REPORT.md` are in the experiment folder.
  - On the unseen batch, test accuracy was 68.3% / 72.9% / 72.9% and macro F1 0.66 / 0.70 / 0.70. Validation on seen batches was 97.9%.
  - IX and POSS are rarely confused with each other. The failures are within each family: person and singular/plural.
  - IX-1pl, IX-2, IX-3, POSS-1 and POSS-3 fail in every seed.
- **Hand slots:** all 720 clips are in the swapped Collector hand order (measured from the landmarks).
- **Checkpoint:** `verify_checkpoint.py` wrote `checkpoint_verification.json` after reproducing the saved predictions.
- **Backend:** `Backend/app/recognition.py` has a new mode `lab-ix-poss-pilot`. It loads the seed-42 run as a 12-class shape-motion model, swaps hand slots, and treats no hands as idle. `translate.py` gives it a display name.
- **Frontend:** `message.ts`, `RecognitionLabPage.tsx` (option "Indexing + Possessives (12-sign pilot)") and `recognitionDiagnostics.ts` (continuous sign transitions).
- **Tests:** updated `Backend/tests/test_diagnostic_recognition.py` and `Frontend/tests/diagnosticPredictor.test.cjs`.
- **Dev servers:** added a `signsync-backend` entry to `Softwares/.claude/launch.json`.

**Verified**
- Backend unittest: 37 OK (2 skipped). Frontend `node --test`: 365/365. `npm run build` passed.
- Through `predict()` in live hand order, 60 of 60 clips matched the offline predictions (6 of 60 without the swap).
- In the browser, the Lab lists the model, and the WebSocket returned ready with `lab-ix-poss-pilot-seed42-graph-diagnostics`.

**Not done / open**
- `graphify update .` was not run, as the user asked.
- No camera or video run of real IX/POSS signing in the Lab yet.
- Phase 2 (89-label integration) has not started.
- Unseen-batch accuracy of about 70% suggests collecting more varied batches for the five weak signs.
- Nothing was committed.

## Motion-use investigation (same day, no code changes)

**What was asked:** map IX/POSS glosses to English words, and advise on merging models vs fixing how recognition uses motion. No merging.

**Findings**
- **Input ablations (scratchpad script, no training):**
  - On the 75-sign multi-batch test set (816 clips), normal input scores 97.4%. The final pose frozen for 40 frames scores 84.4%, shuffled frame order 85.2%, and speed/rotation channels zeroed 96.1%.
  - 38 of 77 signs show no drop with the end pose alone. ROOM, WEDNESDAY and the weekdays do need motion.
  - On the IX/POSS pilot, the end pose alone scores 69.2% against 68.3% normal.
- **Live camera window:** in the Lab, `resampleLiveWindow` keeps only the last 1,333 ms at 30 Hz (`windowResampling.ts`), while training clips are whole signs (about 1.1–3.0 s) stretched or squeezed to 40 frames. Longer signs are seen only from their tail.

**Not done / open:** the recommendation to fix the windowing and motion recipe before any merge is waiting for the user's decision.

## IX/POSS pilot diagnosis (same day, analysis only)

**What was asked:** find why the 12-sign pilot scores about 70% on unseen batches, how to improve it, and how to test it. No code or graph updates.

**Findings (scratchpad scripts only)**
- **Sweep:** sideways sweep separates singular from plural in every batch (about 0.05 vs 0.5–1.2 shoulder-widths), yet the GRU still confuses those pairs.
- **Simple-feature probe:** a logistic or forest model on 8 handedness-folded numbers (sweep, path, pointing vector, palm normal, end x) scores 80.0% / 80.8% on the same unseen batches, against 68–73% for the GRU.
- **Similar end positions:** IX-2/IX-3 and POSS-2/POSS-3 end in nearly the same place and differ only in depth and palm angle. IX-1pl's pointing direction varies by batch.
- **Ruled out:** hand slot (68% vs 69%), and a ±0.3 hand-height shift (67–70%).

**Not done / open:** the improvement plan (leave-one-batch-out evaluation, motion features, augmentation, separate person/number heads, recording protocol) is waiting for approval.

## Steps 1–3: fair evaluation, motion features, augmentation (same day)

**What was asked:** implement steps 1–3, then explain the data split used for the earlier pilot.

**What changed**
- New experiment folder `SignSync Dataset/experiments/samples_12_signs_ix_poss_motion_v1/`:
  - `features.py` (`ix-poss-motion-v1`, 32 channels, plus raw-landmark augmentation);
  - `run_lobo.py` (leave-one-batch-out with nested batch-separated validation);
  - `summarize.py`, `REPORT.md`, `summary.json`, and `results/` (36 runs).
- Repo code and Recognition Lab are unchanged.

**Results (unseen recording round, 9 runs each)**
- Current features: 75.4% (macro F1 0.733).
- Current features + augmentation: 78.8%.
- Motion features: 92.5% (0.920).
- Motion features + augmentation: 94.4% (0.943, minimum 0.886).
- With the motion features, end-pose-only accuracy falls to about 46–49% (71% before). Mirrored clips score the same.
- Remaining errors: IX-2↔IX-3 and POSS-2↔POSS-3.

**Not done / open (at that point):** live backend features and a Lab entry.

## Motion v1 added to Recognition Lab (same day)

**What changed**
- **Training:** `train_final.py` trained recipe C on all 720 clips into `models/candidates/samples_12_signs_ix_poss_motion_v1/ix_poss_motion_v1_all_rounds_seed42/`. Threshold 0.52, taken from out-of-sample fold predictions. Expected accuracy is the leave-one-batch-out 94.4%.
- **Repo:**
  - new `scripts/ix_poss_motion.py`;
  - new `Backend/app/ix_poss_recognition.py`;
  - `recognition.py` (`lab-ix-poss-motion` entry and loader branch) and `ws/translate.py` (names);
  - frontend `message.ts`, `RecognitionLabPage.tsx` (option "Indexing + Possessives (motion v1)"; the old one is renamed "(first pilot)") and `recognitionDiagnostics.ts`;
  - tests in `test_diagnostic_recognition.py` (3 new) and `diagnosticPredictor.test.cjs`.

**Verified**
- Repo features match the experiment features exactly.
- 60 of 60 live-order clips matched offline (13 of 60 without the swap).
- Backend 40 OK (2 skipped). Frontend 365/365. Build passed.
- The browser handshake returned ready.

**Not done / open (at that point):** no real camera or video test yet.

## Lab camera: whole-sign model input (same day)

**What was asked:** start step 2, fixing the live camera window.

**Why the 1.33 s window existed:** added on 2026-11-18 (see [[2026-11-17 Recognition Lab FPS Plan]]) to give a steady 30 Hz grid when the camera frame rate varies. It wasn't something any model was trained on.

**Offline check on unseen clips** (current 1.33 s tail → whole sign on a 40-step grid):
- IX/POSS motion v1 fold models: 92.6% → 94.6% (whole clip 94.4%).
- 75-sign multi-batch: 96.5% → 97.4% (whole clip 97.4%).

**What changed**
- `Frontend/src/services/landmarks/windowResampling.ts`: a shared `sampleAt` (same gap and missing-hand rules), plus new `resampleSignWindow` and `SIGN_WINDOW_GRID`.
- `recognitionDiagnostics.ts`: segmented camera windows use the whole-sign grid; rolling windows keep the 1.33 s lookback; the report records `windowSampling.mode`.
- This affects Recognition Lab camera only. Live Conversation and video replay are unchanged.
- `Frontend/tests/continuousRecognition.test.cjs`: the camera test is rewritten for the new rule (and given unique request IDs), and a new resampler unit test is added.

**Verified**
- Frontend 366/366, build passed, backend 40 OK (2 skipped).
- In the served app, a simulated 2.6 s camera gesture produced 40-frame requests spanning up to 2,500 ms from the start of the sign.

**Not done / open:** no real webcam test. `graphify update .` not run. Nothing committed.

Related: [[Project Home]]
