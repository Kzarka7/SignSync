# 43 signs motion recipe

**What was asked:** apply the motion recipe (step 3) to the 43 Similar Signs v1 data.

**What changed**
- New experiment `SignSync Dataset/experiments/samples_43_signs_motion_v1/`:
  - `features.py`: the two-hand `sign-motion-v1` features, 64 channels;
  - `run_groups.py`: the held-out-participant/batch evaluation;
  - `summarize.py`, `summary.json`, and `results/`.
- `run_groups.py` now stores frames as float64 arrays after four list-based processes ran out of RAM. Features were checked to be identical.
- The project moved from OneDrive to `C:\Users\johng\Documents\Softwares`; the runs used the new path.

**Results** (unseen participant/batch, 4 folds × seeds 42 and 1)
- A, v1 features: 67.8% (macro F1 0.674).
- B, motion features: 75.2% (0.748).
- C, motion + augmentation: 80.5% (0.809).

**Decisions and caveats**
- The v1 similarity fine-tuning stage was not repeated for A.
- C's remaining errors are mostly number handshapes (TWO/THREE, FOUR/FIVE, ONE/WHAT).

**Not done / open:** the combined recipe D (full finger joints + motion), a final model, and a Lab entry. `graphify update .` not run. Nothing committed.

Related: [[Project Home]]

## Graph update and recipe D hand-off (same day)
- Wrote a paste-ready prompt for testing recipe D (full finger joints + motion, with augmentation) in another chat.
- Ran `graphify update .` in `C:\Users\johng\Documents\Softwares`: exit 0. Rebuilt graph.json and GRAPH_REPORT.md: 250,425 nodes, 384,247 edges, 10,409 communities. graph.html was not regenerated (too large).
- Since then `run_groups.py` has changed on disk, probably from the recipe D chat; this session left it alone.

# 43 signs motion recipe D (finger joints)

**What was asked**
Add and test recipe D (sign-motion-v1 + full hand-relative finger joints, with augmentation) on the 43 Similar Signs v1 held-out-group protocol, compare it with A/B/C, and apply the pre-set decision rule. No app, Lab, live-model or v1 changes; no commit.

**What changed**
- `SignSync Dataset/experiments/samples_43_signs_motion_v1/features.py`: added `hand_joint_features` and `sign_motion_joints_features` (variant `sign-motion-joints-v1`, 64 + 126 = 190 channels, `JOINTS_CHANNELS`), plus a docstring note. `sign_motion_features` is unchanged.
- `run_groups.py`: added config `D_joints_aug` (new features, 5 augmented views). A/B/C paths are unchanged.
- Checks before training:
  - all 3,816 clips featurize, finite, 40×190;
  - 1,910 augmented views are fine;
  - the first 64 channels equal `sign_motion_features` exactly;
  - `mirrored()` clips give identical features (max diff 0.0).
- Trained D seeds 42 and 1 (`--threads 3`) one after the other, not in parallel: one process peaks at about 2.4 GB with only about 2.1 GB free. Logs are `logs/D42.log` and `logs/D1.log`; results are in `results/D_joints_aug/`.
- Ran `summarize.py` (`summary.json` updated) and wrote `REPORT.md` in the experiment folder.

**Results** (8 runs per config; accuracy, macro F1, worst-run F1, end-pose probe):
- C: 80.5%, 0.809, 0.691, 61.4%.
- D: 87.1%, 0.865, 0.768, 68.5%.
- D is better on every fold and both seeds.
- D almost removes the number-pair errors: TWO/THREE 116→1, FOUR/FIVE 92→0.
- But ONE/WHAT got worse (108→139) and TEN/TOMORROW regressed (22→39).

**Decision and caveats**
- D fails the end-pose criterion (68.5% vs C's 61.4%), so by the rule **C stays the chosen recipe**.
- The end-pose rise is expected because static number handshapes are legitimately visible in the last frame. Revising the rule is the owner's call.
- Caveats:
  - A omits v1's similarity fine-tuning stage.
  - Only 4 real signers; capture batches stand in for the others.
  - Only 2 seeds.
  - Epochs mostly hit the 5-epoch minimum.

**Not done / open**
- No production model trained, nothing added to the Lab, nothing committed.
- `graphify update .` not run.
- Possible follow-ups:
  - a per-sign end-pose probe on the motion-defined signs, to decide whether D's probe rise is a shortcut;
  - then train the chosen recipe on all clips and add it to the Lab next to v1.

# 43 signs: error analysis of recipes C and D

**What was asked**
Find out where the remaining C/D errors come from, as the first step towards higher accuracy. Read-only; no training.

**What changed**
- Added an "Error analysis" section to `SignSync Dataset/experiments/samples_43_signs_motion_v1/REPORT.md`.
- Added the scripts and `d_consistent_errors.json` (171 clips D gets wrong in both seeds) to that folder's `analysis/`.

**Findings**
- **Sign set and source are fully confounded.** The 20 participant signs come only from participants (5–18 fps); the 23 batch signs come only from capture batches (~30 fps). Batch signs are never tested on a new signer.
- **Fold 2's weakness is two odd batches (80 clips, D 0/160 correct):**
  - capture-date-20261101 GOOD_* clips are signed two-handed (second hand tracked about 100% and moving); everywhere else they are one-handed.
  - All 20 clips of the SATURDAY export batch are read as MONDAY (location and movement look like MONDAY).
  - Without them, D fold 2 goes from 80.7% to 89.6%, and D overall from 87.1% to 89.6%.
- **Signer variants:** WHAT→ONE (participant_02 37/40) and WHERE→TODAY (participant_02 36/40); only movement still separates them.
- **Model-side errors:** HOW→TODAY (participant_04), HELLO→WAIT (D doubled it against C), TOMORROW→TEN. The features separate these pairs on average, but the model still confuses them.
- **No face landmarks**, only the nose.

**Not done / open**
- Human review of the SATURDAY export batch and the 20261101 GOOD_* clips (variant or mislabel).
- No relabelling, retraining or Lab change; nothing committed; `graphify update .` not run.

# 43 signs: TOMORROW/TEN quick checks

**What was asked**
Two quick checks: whether augmentation cuts TOMORROW's first gesture, and whether the TOMORROW clips read as TEN are missing that gesture.

**What changed**
- New `analysis/tomorrow_ten_checks.py`, which uses a 2D thumbs-up detector. It is superseded, and a note in the file says so.
- New `analysis/sign_time_profiles.py`.
- New "TOMORROW ↔ TEN" section in `REPORT.md`.

**Findings**
- In the landmarks, TOMORROW's thumb points up for the whole clip. The first part differs mainly by hand height (near the face, then down to chest height) and looser fingers.
- Check 1: the trim removes only about 3.6% of tracked frames at the start, while the first part fills about 3/5 of the span. Trim hypothesis rejected.
- Check 2: the first part is present in failing clips. capture-date-20261029 ends low, at TEN's height, and D reads 18 of its 20 clips as TEN.
- Untested hypothesis: spatial augmentation blurs hand height, which may explain why errors grow from B to C to D.

**Not done / open**
- Hand-tilt and finger open/close oscillation features, a bidirectional or pooled GRU, milder vertical augmentation (recipe E).
- Confirm with the signer what TOMORROW's first gesture is; the data suggests the thumb is up in both parts.
- No training, no Lab change, nothing committed; `graphify update .` not run.

# 43 signs: measuring tilt, height and finger cues

**What was asked**
Measure whether the cues the signer described separate the confused pairs, before building recipe E:
- WHAT = ONE + hand tilt;
- TEN = thumbs-up + the same tilt;
- NO = THREE + fingers opening and closing;
- TOMORROW = high, then low.

**What changed**
- New `analysis/measure_cues.py` (cue measures, AUCs, a 7.5 fps check, a leave-one-source-out logistic regression).
- New "explicit cues" section in `REPORT.md`.

**Findings**
- WHAT vs ONE: tilt swing separates them (roll AUC 0.99, twist 0.95; WHAT 6.6° vs ONE 0.5°).
  participant_02's WHAT has the smallest tilt (3°), which matches D's 37/40 WHAT→ONE errors on that signer.
- TEN vs TOMORROW: tilt size does not separate them. Reversal rate does (AUC 0.75–0.81), and so do start height (TOMORROW higher, AUC 0.08) and height drop (AUC 0.20).
- NO vs THREE/TWO: finger open/close separates them (aperture reversals AUC 1.00).
- Cues alone, on unseen sources: TEN/TOMORROW 91%, NO/THREE 96%, NO/TWO 95%, WHAT/ONE 85% (participant_02 35%).
- AUCs are unchanged at ~7.5 fps, so this is not a frame-rate artefact. Caveat: WHAT/ONE and NO/THREE cross the participant/batch boundary.

**Not done / open**
- Recipe E (D + ~14 cue channels, bidirectional or pooled GRU, milder vertical augmentation) is proposed, not built. Its decision rule needs agreeing first.
- No training, no Lab change, nothing committed; `graphify update .` not run.

# 43 signs: recipe E (cues + BiGRU), seed 42

**What was asked**
Build recipe E, train it with seed 42 only (for speed), and apply the agreed rule against D.

**What changed**
- `features.py`: added `sign_motion_cues_features` (205 channels) and `augment_frames_mild_vertical`.
- `run_groups.py`: added config `E_cues_aug` (BiGRU).
- New analysis scripts: `analysis/verify_e.py`, `analysis/compare_seed42.py`.
- Launcher `logs/run_E_detached.cmd`, run from the Terminal panel.
  The background run died at session restarts, and a WMI-detached launch was killed while loading clips.
- Results are in `results/E_cues_aug/` (seed 42, folds 0–3) and the "Recipe E" section of `REPORT.md`. `summary.json` was refreshed.

**Results (seed 42; macro F1, worst fold, end-pose probe)**
- D: 0.859, 0.776, 69.2%.
- E: 0.908, 0.810, 48.9%.
- Target-pair errors 108 → 45:
  - WHAT/ONE 64 → 26;
  - TEN/TOMORROW 34 → 16;
  - NO/TWO+THREE 9 → 0;
  - WEDNESDAY/SIX 1 → 3.

**Decision and caveats**
- E passes three of four rule criteria by wide margins.
- It fails "no target pair more than 20% worse" only because WEDNESDAY/SIX went from 1 to 3 errors. Whether to accept that is the user's call.
- Caveats: one seed; three changes at once.

**Not done / open**
- Decision on E.
- Training E on all clips and adding it to the Lab.
- Testing E on the 32-sign set.
- Nothing committed; `graphify update .` not run.
- **Decision:** the user accepted E ("Accept E"). It is now the chosen recipe, replacing C. Recorded in `REPORT.md`.

# 43 signs: recipe E candidate model

**What was asked**
Train recipe E on all clips as a candidate model.

**What changed**
- New `experiments/samples_43_signs_motion_v1/train_final_e.py`, dry-run first on 120 clips in the scratchpad.
- Launched with `logs/run_E_final.cmd` from the Terminal panel. Exit 0, about 9 min, peak 2.6 GB.
- Model saved to `models/candidates/samples_43_signs_motion_e_v1/sign_motion_cues_v1_aug_all_clips_seed42/`:
  - 6 epochs, threshold 0.57, 22,896 rows;
  - self-accuracy 99.97%;
  - expected accuracy 91.3% / macro F1 0.908 (held out, seed 42).
- Copied `processed_paths.py` and `model_paths.py` into its `training_source/` so the feature code imports on its own.
- `analysis/verify_final_e.py` passes: checksums, feature hash, and predictions identical using the folder alone.
- New "Recipe E candidate model" section in `REPORT.md`.

**Not done / open**
- Lab integration (205-channel feature port with a parity test).
- Testing E on the 32-sign set.
- Review of the suspect clips.
- Nothing committed; `graphify update .` not run.

# 43 signs: recipe E added to the Recognition Lab

**What was asked**
Add the recipe E candidate model to the Lab next to v1.

**What changed**
- `SignSync/scripts/sign_motion_cues_features.py`: new, a byte-identical copy of the experiment's `features.py`.
- `Backend/app/sign_motion_e_recognition.py`: new recognizer (checksums, feature hash, no hand swap, threshold 0.57).
- `Backend/app/sign_motion_recognition.py`: added a `featurize` hook; v5's behaviour is unchanged.
- `Backend/app/recognition.py`: `LAB_EXPERIMENTS` entry and loader branch for `lab-signs43-motion-e`.
- `Backend/app/ws/translate.py`: display name.
- Frontend:
  - `types/message.ts`: the mode type;
  - `pages/RecognitionLabPage.tsx`: menu entry "43 Similar Signs (motion E candidate)" and gloss suggestions;
  - `services/landmarks/recognitionDiagnostics.ts`: continuous-sign transitions.
- Tests: 5 new backend tests in `tests/test_diagnostic_recognition.py`, E added to its routing test, and a row in `Frontend/tests/diagnosticPredictor.test.cjs`.
- New `analysis/lab_parity_e.py` and a "Recipe E in the Recognition Lab" section in `REPORT.md`.

**Verified**
- Backend unittest: 38 pass (2 skipped, as before). Frontend predictor test 5/5. `tsc` clean.
- Parity: 382 clips through the websocket match the offline pipeline exactly.
- The running backend (`scripts/dev.ps1`) serves E. The Lab menu shows and selects it.

**Not done / open**
- Live camera or video tests of E against v1 in the Lab, by the user.
- Testing E on the 32-sign set.
- Nothing committed; `graphify update .` not run.
- The dev servers were left running in a Terminal tab.

# 43 signs: Lab motion rules for E (FIVE/WAVE_GREETING, TEN → TOMORROW)

**What was asked**
Give FIVE/WAVE_GREETING the same switching behaviour as WHAT/ONE, and fix TEN → TOMORROW being read as TEN. The user supplied a camera diagnostics export.

**What changed** (Frontend, E mode only)
- `signMotionEvidence.ts`: `MotionProfile` (`'v1'` is the default and unchanged; `'motion-e'` has the FIVE/WAVE_GREETING pair with a middle-fingertip wave cue, threshold 0.25, onset 0.12).
- `gestureSegmentation.ts`: `TEN_DEPARTURE` rule. After TEN, the next sign starts on a rise of 0.25, travel of 0.40 or shape change of 0.30, measured against TEN's last 0.3 s; the window starts within 0.18 of TEN's height.
- `recognitionDiagnostics.ts`: `motionProfile` option.
- `RecognitionLabPage.tsx`: the motion check is on with `'motion-e'` for the E mode.
- New test file `tests/motionProfileE.test.cjs`.
- Experiment analysis:
  - `calibrate_lab_motion_e.py`;
  - replay harness `replay_camera_e.cjs` and `replay_predictor_e.py`;
  - `replay_ten_tomorrow_20261124.json`;
  - the trace archived to `logs/`;
  - a new `REPORT.md` section.

**Verified**
- Replay of the user's recording: TEN followed by its TOMORROW 5/5 (before 3/6), no new false signs.
- Frontend 372/372 tests, `tsc` clean. Backend 38 OK (2 skipped).

**Decisions and caveats**
- Diagnosis: E recognised the signs. The Lab opened the next window mid-TEN, because TEN's tilt passed the generic new-sign test.
- The 0.18 start point was tuned on the same recording.
- FIVE/WAVE_GREETING is calibrated on clips only; there is no live recording yet.

**Not done / open**
- User's live test of both pairs, and a FIVE/WAVE_GREETING diagnostics export.
- Nothing committed; `graphify update .` not run.

# 43 signs: motion → static switching check (E mode)

**What was asked**
Find which change made switching from a moving word to a static number bad. TEN → TOMORROW was reported good.

**What was done**
- File dates:
  - only this session's four Lab files changed after the user's good 22:45 run;
  - `windowResampling.ts` dates from 2026-11-23 and is not the cause.
- New `analysis/make_motion_to_static_traces.py`: synthetic sequences of a real WAVE_GREETING/WHAT clip followed by the same hand held still for 2.5 s, camera-like at 30 fps. They were replayed with `replay_camera_e.cjs` before and after the change.

**Findings**
- Real recordings (WEDNESDAY → SIX, WHAT/ONE/TWO/THREE): identical transcripts before and after, so those pairs are not affected by the change.
- Test sequences:
  - WAVE_GREETING → FIVE: 1/12 before, 0/12 after;
  - WHAT → ONE: 1/8 both.
- Cause (older than this session):
  - after a moving word, the Lab either opens the next window mid-motion (E keeps answering the word, which is suppressed as a repeat), or never opens one, because stopping the motion is not a "change";
  - the new FIVE steady-hold rule removed the rare FIVE answers.

**Not done / open**
- Proposed fix: start the next sign when the moving word's motion settles (E mode), and verify it by replay.
- Nothing changed in the app; nothing committed; `graphify update .` not run.

# 43 signs: motion → static fix (E mode)

**What was asked**
Add the proposed "motion settled" start rule so moving word → static number switches (WAVE_GREETING → FIVE, WHAT → ONE) work.

**What changed** (Frontend, E mode only)
- `gestureSegmentation.ts`: `SETTLING_WORDS_E` and `WORD_SETTLE`. After WAVE_GREETING/WHAT/NO/WEDNESDAY, the next sign starts on a departure or after 400 ms still.
- `recognitionDiagnostics.ts`: re-anchors forward while the window still reads as the word, and reports the settings.
- `signMotionEvidence.ts`: `resolveStillWordAfterWord` (a still WAVE_GREETING right after WAVE_GREETING becomes FIVE).
- `tests/motionProfileE.test.cjs`: +2 tests.
- Experiment `analysis/`:
  - `calibrate_settle_rule.py`;
  - `make_motion_to_static_traces.py` (live jitter, a reverse-order option);
  - 3 replay result files;
  - a `REPORT.md` section.

**Verified**
- Test sequences: WAVE_GREETING → FIVE 1/12 → 11/12; WHAT → ONE 3/8 → 7/8. Number → word not worse.
- Real recordings identical; TEN/TOMORROW 5/5.
- Frontend 374/374, `tsc` clean, backend OK.

**Not done / open**
- User's live test.
- Not committed; `graphify update .` not run.
