# 74-sign live-crop v2 model

**What was asked**
Improve the 74-sign model (`sign_motion_cues_v1_74_aug_all_clips_seed42`) using 8 camera diagnostics from 2026-11-25. Reported problems: MONDAY reads as YES/YESTERDAY/SATURDAY, TUESDAY and slow THURSDAY read as FAST, STAY reads as SATURDAY, and ROOM reads as HAPPY.

**What changed**
- Diagnosis:
  - Training clips (median 1.9–2.4 s) include the hand rising and dropping; live Lab segments are about 1.1 s.
  - v1 relied on path-length and displacement channels, which break on short segments.
- New experiment `SignSync Dataset/experiments/samples_74_signs_motion_e_v2/`:
  - `core_crop.py`: adds 3 live-crop training views per clip.
  - Also added: `build_cache.py`, `probe_crop.py`, `run_folds_v2.py`, `summarize_v2.py`, `train_final_v2.py`, `live_eval.py`, `live_labels.json`.
  - `features.py` and `data74.py` are byte-identical copies from v1.
- 4 held-out-person folds (`results/crop3`, live-style crops, v1 → v2):
  - 43 signs: 81.7% → 88.4%; 31 signs: 73.4% → 80.3%.
  - Full clips held steady: 43 signs 89.7% → 89.5%; 31 signs 76.9% → 78.6%.
  - All 5 gates passed.
- Final model: `models/candidates/samples_74_signs_motion_e_v2/sign_motion_cues_v1_74_livecrop_all_clips_seed42`, threshold 0.61. The log is at `logs/final_v2.log`.
- Live replay on 429 labelled diagnostic segments (evaluation only, never trained on):
  - v1: 72.7%; v2: 75.8%; Motion E (43 signs only): 84.7%.
  - v2 vs v1:
    - THURSDAY 4 → 7/7
    - MONDAY 0 → 4/7
    - AGAIN 3 → 10/17
    - SCHOOL 7 → 10/10
    - TUESDAY still 0/7 (read as FAST)
    - ROOM 1/5
    - STAY 5/10
    - THANK_YOU worse: 6 → 2/9
- Started `graphify update .`.

**Decisions and caveats**
- v2 is a candidate only. The backend (`sign_motion_e74_recognition.py`) still points at v1.
- AGAIN regressed in the held-out folds but improved live.

**Not done / open**
- TUESDAY → FAST is unsolved.
- ROOM and STAY are signed lower live than in training.
- THANK_YOU regressed live.
- Decide whether to switch the Lab to v2. Related: [[2026-11-25 Promote motion E live model]]

## Follow-up: report and Lab integration
- **Report:** wrote `SignSync Dataset/experiments/samples_74_signs_motion_e_v2/REPORT.md`, covering the root cause and both comparisons (held-out folds; 429 live segments).
- **New Lab mode** `lab-signs74-motion-e-v2`, shown as "74 Signs + PARENTS (combined motion E v2, live-crop)". v1 (`lab-signs74-motion-e`) is unchanged and still selectable.
  - Backend:
    - `SignMotionE74V2Recognizer` in `Backend/app/sign_motion_e74_recognition.py`
    - routing in `Backend/app/recognition.py` and `Backend/app/ws/translate.py`
    - a test in `Backend/tests/test_diagnostic_recognition.py`
  - Frontend:
    - `Frontend/src/types/message.ts`
    - `Frontend/src/services/landmarks/recognitionDiagnostics.ts` (PARENTS composition)
    - `Frontend/src/pages/RecognitionLabPage.tsx` (option, motion evidence, live motion profile)
- **Verified:**
  - `python -m unittest tests.test_diagnostic_recognition` (.venv-gru): 29 OK.
  - Both real checkpoints load, with thresholds 0.55 (v1) and 0.61 (v2).
  - `tsc --noEmit` is clean.
  - Not yet checked in the running Lab UI.

## Follow-up: MONDAY/TUESDAY diagnosis and v2 + Motion E fusion (step 1)
- **Diagnosis** (read-only scripts, not kept):
  - MONDAY: the 74 models lean on whole-clip length/range channels. Live segments are short, so they look like YES/YESTERDAY. Motion E does not rely on these channels.
  - TUESDAY: the live palm faces sideways and the circle is small, which matches FAST. Only 3 signers recorded TUESDAY, and Motion E has no FAST class. The plan is new TUESDAY/FAST recordings.
- **New Lab mode** `lab-signs74-motion-e-v2-fusion` ("74 Signs + PARENTS (v2 + Motion E fusion)"). v2 decides whether a segment is one of the 43 signs; Motion E picks the sign inside the 43. v1 and v2 modes are unchanged.
  - New file `Backend/app/sign_motion_e74_fusion_recognition.py`.
  - Routing in `Backend/app/recognition.py` and `Backend/app/ws/translate.py`.
  - Frontend: `message.ts`, `recognitionDiagnostics.ts`, `RecognitionLabPage.tsx`.
  - 2 tests in `Backend/tests/test_diagnostic_recognition.py`.
- **Verified:**
  - unittest: 31 OK; `tsc --noEmit` is clean.
  - Real predict() replay on 445 labelled live segments (2026-11-25 + 2026-11-26 13:48 MONDAY session):
    - top-1: v2 74.8% → fusion 75.3%
    - MONDAY 12 → 17/23, STAY 5 → 7/10, GOOD_AFTERNOON 4 → 6/9
    - **GOOD_EVENING 8 → 5/10**
    - TUESDAY 0/7 and THANK_YOU 2/9 unchanged
    - wrong-but-accepted 99 → 90; correct-and-accepted .730 → .724
    - inference 12 → 16 ms
- **Not done:** graph not updated (per request); not tried in the running Lab. Steps 2 (retrain without the length shortcut) and 3 (TUESDAY recordings) are pending.

## Follow-up: step 2, v3 (whole-clip channels blocked), stopped early
- **New scripts** in `SignSync Dataset/experiments/samples_74_signs_motion_e_v2/`:
  - `build_views.py`: shared training views in `cache/views.npy`, 1.6 GB, built in about 10 min.
  - `run_folds_v3.py`: v2 recipe plus a frozen layer that zeroes the 4 `clip.*` inputs. Verified that the model ignores them.
  - `summarize_v3.py`: gates written before any results.
- **Folds 0 and 1** (`results/clipmask`, logs `logs/folds_v3_f*.log`, about 46–54 min each).
  - Held-out people, v2 → v3:
    - live-crop 43: 0.905 → 0.876; live-crop 31: 0.800 → 0.757
    - full 43: 0.916 → 0.900; full 31: 0.814 → 0.790
  - Per sign:
    - MONDAY crop 25 → 17/40, now read as TUESDAY
    - DRINK, GRANDMOTHER and CORRECT down sharply
    - HELP, AGAIN and THANK_YOU up
  - The early-stop rule triggered (both crop scores more than 1 point below v2). Folds 2 and 3 were not run.
- **Extra check**, fold models on 429 live segments (v2 → v3):
  - fold 0: 286 → 297; fold 1: 321 → 326
  - MONDAY unchanged (6/7 and 3/7)
- **Decision:** v3 is not pursued. The v2 + Motion E fusion stays the MONDAY fix. Graph not updated (per request).
