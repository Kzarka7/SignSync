# Collector low FPS diagnosis

**What was asked**
Find why live-landmark recordings in the collector save at ~9.5–14 FPS (IX-1 takes, ~2 s each) and list fixes. Diagnosis only, no code changes.

**What changed**
- No source files changed. Read-only review of `Frontend/src/hooks/useDatasetRecorder.ts`, `hooks/useCameraFeed.ts`, `services/dataset/cameraClip.ts`, `services/detectionInput.ts`, `services/landmarks/lowLightAssist.ts`, `services/dataset/datasetStorage.ts`, `components/collector/{BoundarySampleCollector,RecordingControls,SequenceList,CameraDiagnostics}.tsx`.
- `graphify update .` not run (no code changed).

**Findings (suspected causes, not measured)**
1. Training-scope takes start a MediaRecorder (VP8, 8 Mbps, 720p) at the same instant as landmark capture (`beginActualRecording`) — encoder start-up stall plus CPU contention with MediaPipe.
2. Collector always captures at 720p (`captureProfile` default); many webcams give 15–20 fps at 720p, less in dim light. Collector never uses the `fast` 640x360 profile.
3. Whole per-frame pipeline is serial on the main thread (bitmap copy, downscale, low-light probe/filter, hand + pose every 4th frame, 1280x720 overlay redraw, React setState); latest-frame mode drops frames when a frame takes >33 ms.
4. 2 s takes make the start-up stall a large share of the clip.
5. After Stop: `saveSequence` then `refreshSequences()` reloads every training sample with all frames via `getAll()` on the main thread, stalling the camera loop; grows with dataset size.

**Decisions and caveats**
- FPS figure in `SequenceList` is correct (processed frames / first-to-last span); the problem is real throughput, not the formula.
- Ranking needs confirmation with Camera diagnostics → "Copy performance report" from one take.

**Not done / open (diagnosis pass)**
- Proposed: delay/decouple clip recorder, lower clip bitrate or resolution, `fast` capture profile for collector, skip overlay redraw/limit setState per frame, incremental list update instead of full reload, warm-up/pre-roll before buffering. See [[Project Home]].

## Follow-up: fixes 1–3 applied

**What changed**
- `Frontend/src/services/dataset/cameraClip.ts`: live clips now 2.5 Mbps (`LIVE_CLIP_BITS_PER_SECOND`); `startCameraClip` takes an `onStarted` callback fired on the recorder `start` event (or error). Phone/video recorder path still 8 Mbps.
- `Frontend/src/hooks/useDatasetRecorder.ts`: frames and the duration limit start only once the clip encoder reports started (fallback 750 ms); take token guards stale callbacks. Capture profile state, default `fast` (640x360). Save and delete update the list in memory instead of `refreshSequences()` (save normalizes via `normalizeIdleSequence`).
- `CameraDiagnostics.tsx`: detection-size picker replaced by camera-size picker (640x360 default / 1280x720); callers in `SignSampleCollector.tsx`, `BoundarySampleCollector.tsx` updated.
- `Frontend/tests/datasetRecorder.test.cjs`: mock fires `onstart`; 4 new tests (encoder-start gating, fallback, capture profile, no reload after save/delete).
- `node --test tests/*.test.cjs`: 359 pass, 0 fail. `npx tsc -b`: exit 0. `graphify update .` started (long run).

**Caveats**
- Not measured on a real camera; FPS gain unverified.
- Clips are now 640x360 by default (lower-resolution original videos in the ZIP); 720p still selectable.
- `scripts/compare_landmarks.py` was already modified before this work; untouched.
- Fixes 4–6 (overlay/per-frame work, pre-roll, low-FPS warning) not done.
- The first `graphify update .` run was stopped before finishing.

## Follow-up: Recognition Lab camera settings in the collector

**What was asked**
Apply the Lab's live-camera FPS logic to the collector camera; plan in-recording FPS later.

**What changed**
- `Frontend/src/hooks/useCameraFeed.ts`: `OPTIMIZED_LIVE_CAMERA_OPTIONS` now includes `deferPose: true` (pose runs after hand landmarks; hands do not wait for pose) and `handDetectionConfidence: LIVE_HAND_DETECTION_CONFIDENCE` (0.35, new export). Collector picks both up through the shared options.
- `Frontend/src/pages/RecognitionLabPage.tsx`: local `LAB_HAND_DETECTION_CONFIDENCE` removed; Lab uses the shared value (same 0.35) and still overrides `deferPose` with its checkbox.
- `Frontend/tests/datasetRecorder.test.cjs`: asserts the collector camera uses `deferPose` and 0.35.
- `node --test tests/*.test.cjs`: 359 pass. `npx tsc -b`: exit 0. `graphify update .` rerun in background.

**Decisions and caveats**
- Settings apply to the collector camera as a whole (preview and takes); one feed serves both.
- Pose in each sample is now the cached pose, at most one processed frame older, matching Lab samples.
- Collector capture stays 640x360 by default (Lab defaults to 720p).
- Not measured on a real camera.

**Not done / open**
- Plan for raising FPS during recording.

## Follow-up: all Recognition Lab camera defaults in the collector

**What changed**
- `useCameraFeed.ts`: new `DEFAULT_LIVE_CAPTURE_PROFILE = "720p"`, used by both `RecognitionLabPage.tsx` and `useDatasetRecorder.ts` (collector default back to 720p from 640x360).
- `useDatasetRecorder.ts`: camera also gets `trackOverlayPaint: true` like the Lab.
- `CameraDiagnostics.tsx`: camera-size picker now lists 1280x720 as the Recognition Lab default; 640x360 still selectable.
- `cameraClip.ts`: comment corrected (clip rate 2.5 Mbps no longer assumes 640x360).
- `tests/datasetRecorder.test.cjs`: test asserts every Lab default (720p, 640 detection width, both landmarks, pose overlay, low-light assist, GPU hands, live timing, overlay paint).
- Tests 359 pass; `npx tsc -b` exit 0.

**Caveats**
- Collector clips are 720p again but at 2.5 Mbps (was 8 Mbps before today), so clips may look softer.
- Graph update still running at time of writing; needs one more run afterwards.

## Follow-up: re-diagnosis of FPS drop after Start

- Tried to measure preview vs recording FPS in the built-in browser (added `.claude/launch.json` at the Softwares root for the frontend dev server, ran it on port 5174); camera access is blocked there, so no measurement. Server stopped.
- Code finding: the only continuous work Start adds is the camera-clip MediaRecorder (`cameraClip.ts`, VP8 first in the MIME list, 720p again). VP8 usually has no hardware encoder on Windows, so it encodes in software and also needs each camera frame copied back from the GPU. One-time costs at Start: full collector re-render (`isRecording`, `locked`, unmemoized 868-line `VideoUploadCollector`) and encoder spin-up.
- Not causes: profile accumulators, `LiveRecordingProgress` timers, frame buffering.
- Lab vs collector comparison (read-only): camera settings now identical; collector adds the clip encoder, start-up re-render and per-take restarts, and reports whole-take average FPS, while the Lab shows a rolling 48-frame FPS over a continuous run and does more per-frame work (`session.observe` + backend socket).
- Applied (user approved): `cameraClip.ts` live clips now try `video/mp4;codecs=avc1.42E01F`, then `video/webm;codecs=h264`, then the old VP8 list (`LIVE_CLIP_TYPES`). Phone-style `CameraVideoRecorder` keeps VP8 at 8 Mbps. `cameraClipFile` names Matroska clips `.mkv`. New test in `tests/datasetRecorder.test.cjs`; 360 pass, `npx tsc -b` exit 0. Not verified on a real camera (built-in browser blocks camera); whether the browser uses a hardware H.264 encoder depends on the machine.
- User result after H.264: ~17 FPS during takes, ~15 FPS with one hand, same recording or not and same as Recognition Lab. Recording overhead is gone; the remaining ceiling is the shared landmark pipeline on the IdeaPad (hand call ~40–55 ms, pose ~23–28 ms per `2026-11-17 Recognition Lab FPS Plan.md`). One-hand drop: with `numHands: 2`, MediaPipe re-runs the palm detector every frame while fewer than two hands are tracked. A single/dual landmarker switch (`dynamicHandCapacity`) existed and was removed in commit 6a9d69f; worker inference also removed earlier. Suggested next test: Lab hand processor CPU vs GPU, plugged in, Best performance mode.
- User's `about:gpu` export (Brave, Chrome 158, Vega 8): WebGL and video encode hardware accelerated; log shows the Media Foundation H.264 encoder in use.

## Follow-up: one-hand FPS fix in Recognition Lab

**What changed**
- New `Frontend/src/services/landmarks/handCapacity.ts`: after 3 consecutive one-hand results from the two-hand model, a one-hand landmarker runs; the two-hand model still runs every 3rd frame; two hands found or hand lost returns to two-hand at once.
- `visionRuntime.ts`: `createHandLandmarker` takes `numHands` (default 2).
- `useCameraFeed.ts`: opt-in `adaptiveHandCapacity`; second landmarker created at setup (failure falls back to two-hand only), per-frame `detectHands`, timing reports `handCapacity` 1/2, report field `dynamicHandCapacity`.
- `RecognitionLabPage.tsx`: "Faster tracking with one hand" checkbox, default on. Collector not changed.
- New `tests/handCapacity.test.cjs` (5 tests). Full suite 365 pass, `npx tsc -b` exit 0, `vite build` passed (bundle-size warning).

**Caveats**
- Not measured on the IdeaPad. Second-hand pickup can lag up to 2 frames. Earlier pose-guided switch was removed for continuity (see `2026-11-17 Recognition Lab FPS Plan.md`); this one is hand-count driven with frequent searches.
- Graph update started before these edits; needs another run.

## Follow-up: 20+ FPS attempt undone, graph updated

- User measured the one-hand fast path at about 21.1 FPS with one hand and 18.5 with two. A pose worker and direct camera frames were then built for two-hand FPS, and at the user's request ("Only the last build") they were fully reverted. The one-hand fast path (`handCapacity.ts`, Lab checkbox) is kept.
- After the undo, 365 tests pass, `npx tsc -b` exits 0, and `vite build` passes.
- `graphify update .` finished with exit 0: 232,816 nodes, 369,345 edges and 12,004 communities. `graph.json` and `GRAPH_REPORT.md` were updated. `graph.html` was not regenerated because the graph is over the viz limit.
- Not done: nothing is committed, and two-hand FPS is still below 20.
