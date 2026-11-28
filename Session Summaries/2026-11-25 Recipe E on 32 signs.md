# Recipe E on 32 signs (merge step 1)

**What was asked**
How to merge 43 Signs Motion E with 32 Signs standalone v5 (adds P4). Recommendation: one new model trained from scratch with recipe E on both datasets, not a change to E's weights. Then: run step 1, checking recipe E on the 32 signs (leave-one-participant-out).

**What changed**
- New `SignSync Dataset/experiments/samples_32_signs_motion_e_lopo/`: `run_lopo_e.py` (v5-motion LOPO protocol, recipe E, `--hands recorded|live`), `compare.py`, `handedness_check.py`, `features.py` (copy of the 43-sign E features, SHA `45dd8e43…`), `REPORT.md`, `summary.json`, `results/E_recorded|E_live/`, `logs/`.
- New doc `SignSync Dataset/documentation/2026-11-25 Recipe E on 32 Signs.md`.
- Ran both arms with `SignSync/.venv-gru` (about 54 min each, in parallel). Ran `graphify update .`.

**Results (pooled, 2,142 clips)**
- v5 motion + augmentation 69.6%; E stored order 68.7%; **E live order 78.3%** (P1 85.6, P2 78.9, P3 79.8, P4 51.4).
- The stored data mixes hand conventions by participant (swapped: P1 280/640, P2 520/640, P3 640/640, P4 21/222). Live order fixes this, and it accounts for most of the gain.

**Decisions and caveats**
- Gate (beat 69.6%) met only in live order. Use recipe E in live order for the merged model, with no inference swap.
- P4 dropped (face-location signs). Image mirroring and handedness were ruled out; the cause is open.
- One seed; every round stopped at the 5-epoch floor; calibrated thresholds 0.14–0.31 are not usable live.
- No app, Lab or model folder changed.

**Not done / open**
- Explaining the P4 drop.

## Follow-up: step 2, combined 74-sign recipe-E model

**What was asked**
Build the combined model (43 + 31 signs + REST/IDLE; PARENTS composed in the Lab).

**What changed**
- New `SignSync Dataset/experiments/samples_74_signs_motion_e_v1/`: `data74.py`, `run_folds.py` (`--epoch-select loss|accuracy`), `compare74.py`, `train_final74.py` (not run), `features.py` copy, `REPORT.md`, `results/` and `results/acc_select/` (with `summary.json`), `logs/`.
- New doc `SignSync Dataset/documentation/2026-11-25 Combined 74 Signs Recipe E.md`.
- Ran 4 person-level folds twice (about 2 h and 5 h). The user confirmed participant_0k = Pk.

**Results (pooled, clip for clip against the baselines)**
- 43 signs: Motion E 91.3%; combined 87.2% (val-loss epochs), 89.7% (val-accuracy epochs).
- 31 signs: step 1 78.0%; combined 75.5%, 76.9%. Background accepted at 0.75: 9/153 in both runs.

**Decisions and caveats**
- No gate met, so no final model was trained. Motion E stays live, and nothing in the app changed.
- The main losses are pairs that only exist in the combined vocabulary: MAYBE↔WHERE/TODAY, GOOD→THANK_YOU, FAST→TUESDAY.
- The baselines used loss-selected epochs, so the comparison is not fully like for like. One seed.

**Not done / open**
- PARENTS composition check.
- Review of the cross-vocabulary pairs, background rejection, and like-for-like baselines.

## Follow-up: combined model in the Recognition Lab + problem list

**What was asked**
Add the combined model to the Recognition Lab as a replaceable model, then list the problem signs and pairs.

**What changed**
- Trained `SignSync Dataset/models/candidates/samples_74_signs_motion_e_v1/sign_motion_cues_v1_74_aug_all_clips_seed42/` (22 epochs, threshold 0.55).
- Backend:
  - new `Backend/app/sign_motion_e74_recognition.py`;
  - `sign_motion_e_recognition.py` takes its folder, labels and name from class attributes (Motion E unchanged);
  - mode `lab-signs74-motion-e` added in `recognition.py` and `ws/translate.py`;
  - 5 new tests in `tests/test_diagnostic_recognition.py`.
- Frontend: `types/message.ts`, `RecognitionLabPage.tsx` (menu entry, motion-e profile), `recognitionDiagnostics.ts` (`COMPOSING_MODELS`), `tests/diagnosticPredictor.test.cjs`, `tests/composedSigns.test.cjs`.
- New `verify_final74.py` and `problem_signs.py`, writing `results/acc_select/problem_signs.md`. Updated the README Lab table, REPORT.md and the dated doc.
- Checks: backend tests 43 OK (2 skipped); all frontend tests pass; `tsc -b` clean; loader parity on 558 clips (0 mismatches). The menu entry appeared in the dev-server Lab.

**Decisions and caveats**
- Motion E stays the default and the live model. The candidate misses its gates.
- Not tried on a real camera or video. The user stopped the dev servers before a run.

**Not done / open**
- Live camera trial, PARENTS composition check, fixes for the listed pairs.
