# Live hand tracking speed and lag

**What was asked**
- Improve live FPS, latency, hand tracking and hand assignment, based on two Recognition Lab landmark benchmarks (Ryzen 5 3500U, Vega 8 integrated GPU).
- Symptom: open/closed palm tracks well while circling the hand; a held finger shape gets left behind.

**Benchmark reading**
- Camera delivered ~20 fps at 1280x720 (browser-presented 20.0), so processing (19.4 fps) was capped by the camera, not the models.
- Hand model ~33 ms median on GPU; 640 px input only saved ~4 ms. Pose ~20 ms every 4th frame.
- Fresh-hand gaps p95 ~95-120 ms: the hand drops out during motion.

**What changed** (all in `SignSync/Frontend`)
- `src/services/landmarks/visionRuntime.ts`: `HAND_LANDMARKER_THRESHOLDS` with palm detection confidence 0.5 -> 0.35 (presence and tracking stay 0.5); `createHandLandmarker` takes a `"GPU" | "CPU"` preference.
- `src/hooks/useCameraFeed.ts`: new options `handDelegate` and `captureProfile` (`"720p"` or `"fast"` = 640x360 at 30 fps); the hand landmarker is recreated when the processor changes; the benchmark JSON now reports `requestedHandDelegate`, `captureProfile` and `handThresholds`; during the 150 ms overlay hold, a missing hand now follows its last palm motion (up to 80 ms, max shift 0.12) instead of freezing. Display only.
- `src/services/dataset/videoHandAssignment.ts`: `isDuplicateHand`; live assignment drops a second detection of the same hand (keeps the higher score). Touching hands are kept.
- `src/pages/RecognitionLabPage.tsx`: "Hand model processor" and "Camera capture" selects in Landmark settings.
- Tests: `tests/visionRuntime.test.cjs` (0.35 threshold, CPU preference), `tests/videoImport.test.cjs` (duplicate vs touching hands).
- `npx tsc -b` clean; `node --test tests/*.test.cjs`: 351 pass, 0 fail.

**Decisions and caveats**
- No change was measured on the device yet; the lab A/B selects exist so the user can benchmark CPU vs GPU and 640x360 vs 720p.
- Running pose off the hand's critical path and moving inference to a Worker were considered and not done.
- Lower palm threshold may add false palm detections; watch the benchmark's hand count and handMs.

**Not done / open**
- Re-run the lab benchmark with the new options and in brighter light.
- `graphify update .` was started for `SignSync/` and the workspace root (ran in background).

## Follow-up: lab-only speed options

**What was asked**
- Raise FPS / lower ms without breaking the recognition model; change only the Recognition Lab page's behaviour.

**Benchmark reading**
- Nov 18 runs (before this work): camera 30 fps, hand ~26 ms, 28-29 fps processed, ~28 ms to landmarks.
- Today, already before any of today's changes: camera 20-25 fps (still 20 at 640x360 capture), hand 31-37 ms, ~19 fps. Likely camera exposure/lighting and possibly power mode; low-light assist (added after Nov 18) adds ~1.5 ms resize and more hand time while active.

**What changed**
- `visionRuntime.ts`: global palm detection threshold back to 0.5; `createHandLandmarker` takes an optional threshold.
- `useCameraFeed.ts`: opt-in `handDetectionConfidence` and `deferPose` options (defaults unchanged for other pages). With `deferPose`, pose runs in its own task after the frame's hands are delivered, or at the start of the next frame before input canvases are reused; benchmark reports `poseScheduling` and attributes pose ms to the next frame (not in totalMs).
- `RecognitionLabPage.tsx`: defaults to 640 px landmark input, deferred pose (checkbox "Run pose after hand landmarks"), palm threshold 0.35.
- Tests: `tests/cameraLandmarkMode.test.cjs` (mock thresholds, new deferred-pose test), `tests/visionRuntime.test.cjs` back to 0.5. `npx tsc -b` clean; 352 tests pass.

**Decisions and caveats**
- Overlay motion hold and duplicate-hand removal from the first round still apply on all pages.
- Not measured on the device yet.

**Not done / open**
- Benchmark the lab with the new defaults; try CPU hand processor and low-light assist off; check lighting and plugged-in power mode.
- `graphify update .` run in `SignSync/` after this round.
