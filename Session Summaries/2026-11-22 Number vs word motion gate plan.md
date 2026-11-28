# Number vs word motion gate plan

**What was asked**
Plan how recognition should tell static numbers from motion words that share a handshape (ONE/WHAT, TWO/NO, THREE/NO, SIX/WEDNESDAY). Two camera captures showed ONE stuck on `motion_conflicts_with_number` after a twitch, and SIX confirmed while circling.

**What changed**
- No source files changed. Planning only.
- Read `Frontend/src/services/landmarks/signMotionEvidence.ts`, `numberHold.ts` (`holdMotion`) and `recognitionDiagnostics.ts` (call site near line 189).
- Ran throwaway Node scripts (session scratchpad) over the two diagnostics exports in Downloads (`...15-11-50-862Z.json`, `...15-19-19-555Z.json`).

**Findings (verified from the captures)**
- ONE: segment 2 reached `turn=0.174` (threshold 0.12) from a twitch near 4.3 s. After that the hand was steady (`displacement` 0.009–0.035, under the 0.07 limit), but `turn` stayed 0.174 on every row until the segment was discarded at 7.9 s (`gesture_duration_limit`). Cause: `assessSignMotion` takes the maximum reversal over the whole growing segment window, so one old twitch blocks the number for good.
- SIX: `signMotion` was empty on every row. `assessSignMotion` only covers ONE/WHAT/TWO/THREE/NO, so SIX has no static check. In segment 3 the wrist travelled about 2 shoulder-widths per second in a loop, the model swung between SIX and WEDNESDAY, and SIX was confirmed at 15.8 s. WEDNESDAY is also missing from `PREVIEW_MOTION_REQUIRED`.

**Plan (proposed, not built)**
1. Judge number steadiness on a recent window: a number is accepted only after a steady hold following the last motion, so an earlier twitch delays it but doesn't block it.
2. Apply one generic static check to every static number (ZERO–NINE, not TEN), using hand travel as well as the existing handshape cues.
3. When a number is blocked for motion and its paired word is in top-3, let the paired word's motion rule decide.
4. Later: give the model velocity input and train with jitter and circling examples.

**Not done / open**
- No code, tests or `graphify update .` (nothing changed).
- Thresholds still need checking against the validation clips.

Related: [[Project Home]]
