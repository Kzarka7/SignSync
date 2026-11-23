# Number vs word motion gate build

**What was asked**
Build steps 1–3 of [[2026-11-22 Number vs word motion gate plan]], then make MOTHER + FATHER compose into PARENTS as well as FATHER + MOTHER.

**What changed**
- `Frontend/src/services/landmarks/signMotionEvidence.ts`:
  - Static numbers are now judged on a recent window. If the window shows earlier motion, the number needs an 800 ms settled, motion-free hold, so a twitch delays it instead of blocking it.
  - Every static number (ZERO–NINE, not TEN) gets a hand-path cue: wrist reversal in x or y, threshold 0.25.
  - WEDNESDAY now needs that hand motion (`awaiting_hand_motion`).
  - New `resolveSignByMotion`: a number blocked by `motion_conflicts_with_number` becomes its paired word (ONE→WHAT, TWO/THREE→NO, SIX→WEDNESDAY). This needs the word to have model score ≥ 0.1 and the word's motion check to pass. The word then takes the combined pair score, and counts as accepted at ≥ 0.8. Words are never relabeled to numbers.
- `recognitionDiagnostics.ts`: calls `resolveSignByMotion`. The row's `signMotion` now has `pathTurn`, `recentTurn`, `recentPathTurn`, `resolvedFrom` and `pairScore`.
- `Frontend/tests/continuousRecognition.test.cjs`: new tests for twitch-then-settle, circling numbers, the pair fallback, and PARENTS in both orders through a full session.
- PARENTS: `composedSigns.ts` already composed in either order. Its unit test and the new end-to-end session test both pass, so no product code changed for it.

**Verification**
- Dataset clips, scored on growing windows (scratchpad `calibrate.cjs`):
  - WEDNESDAY judged as SIX passes in 17/80 clips (was 80/80).
  - WHAT/NO judged as numbers: unchanged (6/80, 19/80).
  - Numbers still pass in all but 1–4 of ~120 clips each. FOUR–NINE now wait for a steady hold: median first pass ~700–850 ms into the clip, was 400.
- Capture replay with the recorded predictions (scratchpad `replay.cjs`):
  - 15:11: ONE, ONE (was ONE). The twitched ONE confirms at 5.2 s.
  - 15:19: WEDNESDAY, SIX, WEDNESDAY, WEDNESDAY (was WEDNESDAY, SIX, SIX).
- 355/355 frontend tests passed. `npm run build` passed.

**Decisions and caveats**
- Path threshold 0.25, not the clips' 0.3: the live circle only reached 0.23–0.28.
- Applying the steady check to FOUR–NINE is new, so those numbers confirm a little later than before.
- `useContinuousLiveRecognition` sends entries by index, so a composed replacement would never reach Live Conversation. This is latent: the live model doesn't compose today.

**Not done / open**
- No live camera trial of the new gate or of MOTHER→FATHER.
- Step 4 (velocity input and retraining) not started. Nothing committed.
- `graphify update .` was started, then stopped at the user's request after running over 10 minutes. The graph does not include these changes.

Related: [[Project Home]]
