# Live tracking diagnosis

**What was asked**
Find why live hand tracking does poorly on complex handshapes, why FPS is about 19 with recognition off and about 15 with it on, why one moving hand sometimes shows up as both left and right, and how to make tracking hold up in low light. Plan only, with no code changes.

**What changed**
- No source files changed. Read-only review of `Frontend/src/hooks/useCameraFeed.ts`, `services/landmarks/visionRuntime.ts`, `lowLightAssist.ts`, `handCapacity.ts`, `services/dataset/videoHandAssignment.ts`, `services/detectionInput.ts`, `services/landmarks/recognitionDiagnostics.ts`, `services/ws/diagnosticPredictor.ts`, `hooks/useContinuousLiveRecognition.ts`, `pages/RecognitionLabPage.tsx`, `Backend/app/sign_motion_e_recognition.py`.
- Commands: `graphify query`, directory listings, and pattern searches.

**Decisions and caveats (likely causes, not yet measured)**
- Ghost second hand: adaptive hand capacity runs the two-hand landmarker only every 3rd frame, so its saved hand region is stale during motion and can come back as a second hand. `isDuplicateHand` only catches ghosts whose 21 joints closely match.
- Camera-bound FPS: live capture defaults to 720p, but the models only see a 640 px copy. The code's own comment says many webcams cap 720p at 15-20 fps, and low light lowers that further.
- Recognition cost: per-frame segmentation and feature work, a Lab re-render every 125 ms, building a window every 150 ms, and TensorFlow on the same machine with default all-core threading.
- Low light: the assist is a linear `brightness()` gain up to 2.4x, which boosts noise and clips highlights.
- Complex handshapes: the 640 px input leaves few pixels per hand, and nothing checks whether landmarks are plausible.
- Any tracking change shifts collected and recognized data, so it needs re-validation against Lab baselines.

**Not done / open**
- Measurement phase (Lab benchmark with recognition off vs on, adaptive capacity off, Chrome performance trace).
- All implementation phases are pending the user's go-ahead.

## Update: landmark benchmark (recognition off)

Source: the user's `signsync-landmark-benchmark-2026-11-26T04-10-03-126Z.json` (720p capture, 640 px input, GPU hands and pose, adaptive capacity on).
- The camera presents 29.9 fps but only 16.45 fps are processed, so the camera-bound theory is ruled out. Frame copy (0.4 ms) and resize (2 ms) are negligible.
- The hand model is the bottleneck: 43 ms median, 69 ms at p95. Pose takes 25.7 ms every 4th frame. Together they keep the main thread busy about 93% of each 61 ms frame interval, which gives a ceiling of about 17.6 fps.
- Callback to overlay paint is 117 ms median, because the deferred pose task and the next detection run before the browser can paint.
- The gap between fresh hand updates is 60 ms median and 119 ms at p95. The two-hand model's saved hand region is therefore about 180 ms old when it runs, which supports the stale-tracker ghost theory.
- The low-light assist was barely active (5 of 795 frames, max gain 1.7), so this run says nothing about dim light.
- A 2-4 fps drop from recognition means about 8-20 ms of extra main-thread time per frame.
- Revised priorities: an A/B test of CPU vs GPU hand delegate, then moving MediaPipe into a Web Worker, then the ghost-hand fix. Keep 720p capture, since the higher-resolution hand crops planned later need it.
- Still to measure: the recognition-on Lab diagnostics export (its `cameraPerformance` block), a CPU delegate run, a run with adaptive capacity off, and a dim-light run.

## Update: recognition-run analysis and hand-slot fix

Source: 8 Lab camera exports from 2026-11-25 (`signsync-camera-diagnostics-2026-11-25T15-*.json`, model `lab-signs74-motion-e`), analysed with scratch Python scripts.
- Camera timing: the camera presented 20 fps (low light; the assist was at its 2.4x maximum). Processing ran at 14-16 fps, with hand time 41-50 ms, the same as with recognition off.
- Each run repeats one sign about 5 times, alternating hands by design (the model handles both slots). A sign that differs from both neighbouring repeats was counted as likely wrong: 23 of 331 accepted signs.
- Faults: a slot swap or an in-slot jump of more than 0.8 shoulder widths appears in 26% of likely-wrong signs, against 9% of agreeing ones.
- Root cause: 104 of 396 new lone hands started in the opposite side's slot. When the hand is more than 0.3 shoulder widths off the midline, 47 of 85 switched slot within 1 s. Every such case with pose evidence (31 of 31) was a wrong slot, not a real crossing.
- There were also 137 frames with two "hands" about 0.23 shoulder widths apart at one pose wrist while the other wrist was far away (duplicates).
- Change in `Frontend/src/services/dataset/videoHandAssignment.ts` (`createStreamingHandAssignment`, used by live recognition, the Dataset Collector and Lab replay):
  - A hand with no track leans to its side of the body, from the cached pose shoulders (dead zone 0.15, full at 0.5 shoulder widths, weight 1.5).
  - A tracked hand that stays clearly on its side can't be released by the handedness label alone.
  - New `isPoseConfirmedDuplicate` drops a second copy at the same pose wrist when the other wrist is confidently far.
  - The offline `assignVideoHands` is unchanged.
- Tests: in `Frontend/tests/videoImport.test.cjs`, one test that asserted the old wrong-start behaviour was updated, and 2 tests were added. Results: `node --test tests/*.test.cjs` 376/376 pass, `npx tsc -b` clean, `graphify update .` run.
- Caveat: Dataset Collector samples will now have fewer slot swaps than older training data.
- Not done: live test by the user; low-light camera settings, landmark plausibility check and the worker move remain proposals.

## Update: low-light tone curve

Trigger: the user's benchmark `signsync-landmark-benchmark-2026-11-26T05-59-16-357Z.json` showed 22.6 fps processed, 31 ms hand time, the camera at 29.95 fps, and the low-light assist at its 2.4x maximum. That speed-up is not attributable to these changes.
- `Frontend/src/services/landmarks/lowLightAssist.ts`: the flat `brightness()` lift (which clips everything above 255 / gain) is replaced, where supported, by a shadow-lifting tone curve, `f(x) = kx / (1 + (k - 1)x)`.
  - It is applied as cached SVG `feComponentTransfer` table filters (`createDocumentCurveFilter`), with a one-time pixel self-test and a fallback to brightness.
  - Maximum lift at the hand level is 3x, slope capped at 4.5. A dark frame without hands now gets 2.4x instead of 1.6x, to help find hands again.
- `Frontend/src/hooks/useCameraFeed.ts`: benchmark and profile reports now include `lowLightMethod` and `cameraExposure` (the track's frame-rate and exposure capabilities and settings).
- Tests: 3 new tests in `Frontend/tests/lowLightAssist.test.cjs`. Results: full suite 379/379, `npx tsc -b` clean.
- Browser check in the built-in pane, on the running dev server (localhost:5173), by importing the module: the curve is supported, and output matched the expected curve within 1 level (for example 102 → 178, 229 → 246, where `brightness(2.5)` gives 255). Cost was 0.33 ms per 640x360 draw, against 0.24 ms for `brightness()`.
- Not done: no live camera test of tracking quality yet. Camera exposure control is not changed, only reported.

## Update: left/right assignment uses pose wrists on every frame

Checks on the 2026-11-25 exports (scratch Python):
- Geometric handedness from 3D landmarks reached at most 82% agreement with pose-confirmed slots (89% on the clearest frames), so it was not adopted.
- For hands more than 0.5 shoulder widths to one side, the nearer pose wrist was on that side in 96-99% of frames at every visibility level from <0.2 to >0.65, fresh or 1-3 frames old (median hand-to-wrist distance 0.13-0.19 shoulder widths). The old rule only used fresh wrists with visibility of at least 0.65.

Changes:
- `Frontend/src/services/dataset/videoHandAssignment.ts`:
  - New `poseWristContrast`: evidence is how much closer the hand is to one wrist than the other, scaled by shoulder width. Weight 2.4, full at wrist visibility 0.5 and none below 0.15, fading 40% by 350 ms of pose age, ignored beyond 1 shoulder width of both wrists.
  - The live assignment's fourth argument is now `poseAge` (true, an age in ms, or false).
  - Video import (`assignVideoHands`) now uses the same contrast evidence, plus the body-side rule for hands that appear after a break.
- `Frontend/src/hooks/useCameraFeed.ts` passes the cached pose's age.
- Tests: `tests/cameraLandmarkMode.test.cjs` now expects pose ages (`[0,50,100,150,0,50]` and `[false,50,100,150,200]`) instead of fresh/stale flags. 2 tests were added in `tests/videoImport.test.cjs`. Results: 381/381 pass, `npx tsc -b` clean, `graphify update .` run.
- Caveat: wrist accuracy near the midline could not be checked independently, since the exports have no raw handedness labels. Not live-tested.

Related: [[Project Home]]
