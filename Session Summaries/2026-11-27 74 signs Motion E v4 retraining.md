# 74 signs Motion E v4 retraining

**What was asked**
- Plan the 74-sign retrain with the refreshed TUESDAY/THURSDAY data, then "Start v4".
- Signer mapping: P1 owner (every WEBM), P2 Joem, P3 Almari (`WIN_*`), P4 the 105-sign reference (MOV).

**What changed**
- New folder `SignSync Dataset/experiments/samples_74_signs_motion_e_v4/`:
  - `build_intake.py` writes `intake.json`, which freezes 3,806 43-sign clips with person folds.
  - `data74.py` has person folds for every clip.
  - Also added: `run_folds_v4.py`, `summarize_v4.py`, `train_final_v4.py`, `live_compare.py`, `REPORT.md`.
- Ran 4 held-out person folds (`results/v4/`), the final model, and the live replay against v2.
- New candidate: `models/candidates/samples_74_signs_motion_e_v4/sign_motion_cues_v1_74_livecrop_v4_all_clips_seed42`, threshold 0.53.
- Results:
  - Held-out, pooled: 43 signs 0.878 full / 0.867 crop; 31 signs 0.766 / 0.796.
  - Background accepted 9 full / 11 crop of 153 (v2: 7 / 10).
  - Live replay: top-1 325 → 329 of 429. TUESDAY 0 → 6 of 7. THURSDAY, FAST and MONDAY not worse.
- Work note: [[2026-11-27 74 Signs Motion E v4 Retraining]], linked from Dataset Guide.

**Decisions and caveats**
- Pass conditions were fixed before results. The live gates pass. Both background gates fail, by 2 clips (full) and 1 clip (crop), all IDLE_MOVEMENT from the P1 and P2 folds.
- So v4 is **not passed**: no Lab mode was added and the backend is unchanged.
- The held-out scores are a new person-level baseline and are not directly comparable with v2's partly batch-based folds.

**Follow-up: Lab mode added**
- The owner chose to add v4 anyway, as Lab-only mode `lab-signs74-motion-e-v4` beside v2.
- Backend:
  - `Backend/app/sign_motion_e74_recognition.py` (`SignMotionE74V4Recognizer`)
  - `Backend/app/recognition.py`
  - `Backend/app/ws/translate.py`
  - `Backend/tests/test_diagnostic_recognition.py` (new v4 test)
- Frontend:
  - `Frontend/src/types/message.ts`
  - `Frontend/src/services/landmarks/recognitionDiagnostics.ts`
  - `Frontend/src/pages/RecognitionLabPage.tsx`
- Checks:
  - unittest: 32 tests OK.
  - The real checkpoint loads through `get_diagnostic_recognizer`: 76 labels, threshold 0.53.
  - `tsc --noEmit` exits 0.
  - Not tried in the running app.

**Not done / open**
- The idle false accepts are still higher than v2's. More IDLE_MOVEMENT data from P1 and P2 may help.
- No v4 + Motion E fusion mode was made.

**Follow-up: step 1, REST/IDLE dropped at inference (measurement only)**
- Method: the v4 fold predictions and the final model, with the REST/IDLE columns removed and the rest renormalized.
- Output: `results/v4/step1_mask_background.json`. The scripts are in the session scratchpad.
- Held-out sign clips: full 4595 → 4645, crop 4622 → 4648 (of 5500). DAY 43 → 55 and SLOW 45 → 53 of 60 on crop.
- Live: 329 → 333 of 429. TUESDAY stays 6/7.
- All 153 held-out REST/IDLE clips have hands visible, so the no-hands rule catches none of them. 3 are rejected by the <50% hands rule.
- Of the other 150, those accepted as a sign:

  | Threshold | Masked | v4 with classes |
  |---|---|---|
  | .53 | 137 | 11 |
  | .75 | 113 | 9 |
  | .9 | 86 | 7 |

- Code and models are unchanged. GRANDPARENTS is not added yet.

**Follow-up: GRANDPARENTS composed sign, and ROOM vs HAPPY**
- GRANDPARENTS is added to `COMPOSED_SIGNS` in `Frontend/src/services/landmarks/composedSigns.ts`.
  - GRANDFATHER + GRANDMOTHER, in either order, within 3 s. It applies to the composing 74-sign Lab models.
  - The comment in `recognitionDiagnostics.ts` is updated.
  - 2 new tests in `Frontend/tests/composedSigns.test.cjs`. `node --test` on composedSigns and continuousRecognition: 49/49 pass. `tsc --noEmit` exits 0.
  - Not tried in the running app.
- ROOM vs HAPPY on live replay, scored on the same 227 segments from the 32-sign vocabulary:

  | Model | ROOM | HAPPY | All 227 |
  |---|---|---|---|
  | 32-sign v5 motion | 5/5 | 4/5 | 151 |
  | v4 | 0/5 (all read as HAPPY, about 1.0) | 5/5 | 166 |

- On held-out people it is the other way round: ROOM 49/60 for v5 motion (P1 ROOM read as GOOD 9 times) and 58/60 for v4.
- Cause, from feature ablation on the 5 live ROOM segments:
  - The other hand's 126 hand-relative joint channels (and its palm direction) look like HAPPY. These channels exist only in v4's 205-channel recipe, not in v5's 64 channels.
  - Replacing them with the training-ROOM mean flips 3 of 5 segments to ROOM.
  - In one segment the other hand was untracked in 19 of 40 frames.
  - All 5 segments come from one recording.

**Follow-up: GRANDPARENTS limited to the latest model (v4)**
- `COMPOSED_SIGNS` entries can now list `models`.
  - GRANDPARENTS (GRANDFATHER + GRANDMOTHER, either order, within 3 s) composes only for `lab-signs74-motion-e-v4`.
  - PARENTS still composes for every composing model.
- `appendComposed` takes the model mode; `recognitionDiagnostics.ts` passes it.
- The v4 Lab option now reads "74 Signs + PARENTS + GRANDPARENTS (…)".
- Live Conversation's 43-sign Motion E has no GRANDFATHER/GRANDMOTHER, so it can't compose GRANDPARENTS.
- Tests:
  - New: GRANDPARENTS on v4 only, and a live-session test on v4.
  - Full frontend suite: 386/386 pass. `tsc --noEmit` exits 0.
  - Not tried in the running app.

**Follow-up: why v4 reads live ROOM as HAPPY (analysis only; the owner confirms the ROOM recordings are correct)**
- Ruled out:
  - Hand-slot order: all 120 ROOM/HAPPY training clips are on the same image sides as live after the swap-back.
  - Dominant-hand choice: forcing it either way still gives HAPPY.
  - Joint depth (z).
  - Aspect ratio: every training video and the live camera are 16:9.
- Cause: the other hand's orientation.
  - Live ROOM has the other hand pointing straight across, palm toward the camera axis: other.point.x -0.96, other.palm.z -0.94.
  - That matches HAPPY (-0.79 to -0.91 and -0.68 to -0.95), not the training ROOM clips (-0.47 to -0.75 and -0.41 to -0.75, fingers angled more upward).
  - v4 has 126 hand-relative joint channels plus 6 direction channels. The joint channels are centred and scaled but not rotated, so they also encode orientation, and the other hand's orientation outweighs ROOM's motion.
  - The 32-sign model has only the 6 direction channels, so motion decides.
- Evidence on held-out people: the 205-channel recipe on 32 signs (live order) gets ROOM 60/60. The features separate ROOM/HAPPY for the trained ROOM variant, not this one.
- Fix options:
  - ROOM takes with this other-hand orientation.
  - Other-hand rotation augmentation.
  - Rotation-normalized joint channels.

**Follow-up: v5 orientation fixes for ROOM (no re-recording)**
- New folder `SignSync Dataset/experiments/samples_74_signs_motion_e_v5_orientation/`, containing `orientation.py`, `train_v5.py`, `live_v5.py`, `run_folds_v5.py`, `summarize_v5.py` and `REPORT.md`.
- Two recipes, each trained as a final model, about 65 minutes each:
  - rotaug: ±30° other-hand rotation augmentation.
  - rotnorm: rotation-normalized joint channels.
- Live replay of the 429 segments (`results/live_v5.json`):
  - v4: 329, ROOM 0/5.
  - rotaug: 343, ROOM 1/5, MONDAY 5 → 4.
  - rotnorm: 342, ROOM 2/5, HAPPY 4/5, FAST 7 → 5.
- Neither passed the gates fixed beforehand (ROOM ≥ 4/5 and others). So no person folds, no candidate and no Lab mode.
- Work note: [[2026-11-27 74 Signs Motion E v5 Orientation]], linked from Dataset Guide.
- Open:
  - Direction channels (pointing/palm) still carry the other hand's orientation.
  - Alternatively, record ROOM with the other hand straight across.
