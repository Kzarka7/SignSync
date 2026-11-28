# Low-light hand tracking and handedness

**What was asked**
Improve Recognition Lab hand landmark tracking in backlit/dark scenes (landmarks lag behind a moving hand, then jump) and stop left/right flicker for a single fast-moving hand, without making recognition worse. Related: [[2026-11-19 Recognition Lab Live Accuracy Plan]], [[Project Home]].

**What changed**
- `Frontend/src/services/landmarks/lowLightAssist.ts` (new): measures brightness on the last tracked hands (else visible pose wrists, else frame centre) every 100 ms and, only when that region is dark (level < 80, release > 95), gives both detectors a brightened copy (gain up to 2.4). Preview, overlay and coordinates unchanged; falls back to the original frame if canvas filters are missing.
- `Frontend/src/hooks/useCameraFeed.ts`: applies the assist before hand and pose detection; new `lowLightAssist` option (default on), `lowLightAssistActive` state, `lowLightGain` in live timing, assist fields in performance/benchmark reports.
- `Frontend/src/services/dataset/videoHandAssignment.ts`: `createStreamingHandAssignment` (live camera + Lab video replay) now keeps per-side tracks with palm-centre velocity prediction, a 500 ms dropout hold and a smoothed handedness vote. A vote that settles against a side releases its track. Offline `assignVideoHands` (video import / training data) unchanged.
- `Frontend/src/pages/RecognitionLabPage.tsx`: "Low-light assist" checkbox in Landmark settings, "Low-light assist on" pill, lift shown in live timing.
- Tests: `tests/lowLightAssist.test.cjs` (new, 5), `tests/videoImport.test.cjs` (2 new, 1 updated: a hand returning 234 ms after a dropout keeps its side; after 900 ms the label decides). `node --test tests/*.test.cjs`: 344/344 pass. `tsc -b` and `vite build` pass.

**Verification (offline replay of recorded clips)**
Replayed 340 training packages (5,636 clips, ~375k frames) through the old and new live assigner, scored against confident pose wrists. Wrong-side hands old → new: bad light + live pose cadence 25,394 → 3,248 (one-hand side switches 3,836 → 818); clean live cadence 3,265 → 113; clean every-frame pose 1,574 → 112; bad light every-frame pose 2,372 → 341. Scripts were in the session scratchpad (`compareAssign2.cjs`, `compareAssign3.cjs`).

**Decisions and caveats**
- Tried and removed a "stuck landmark" filter based on pose wrists: on real AGAIN clips the pose wrist jumped while the base hand was still, so it would have dropped real hands.
- Feature vector, normalization and left/right slot convention unchanged; no retraining needed.
- Low-light assist is not tested with a real camera in a dark room yet; bad-light figures use simulated label flips and dropouts.

**Not done / open**
- 1,736 of 7,372 stored clips (whole labels such as DAY, DEAF, DRINK, GOOD, MAYBE, PERSON, SCHOOL, SICK, SLOW) have hand slots on the opposite side from their pose wrists (hands swapped on import, pose not). Likely hurts training; needs review.
- Live test in the user's backlit setup, and a recognition-accuracy comparison on an annotated session.
- Low-light assist not applied to Lab video replay or video import.
