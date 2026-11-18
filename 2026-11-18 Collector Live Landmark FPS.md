# Collector live landmark FPS · 2026-11-18

Use Recognition Lab's optimized live landmark configuration for both live Collector views. Share the settings in [useCameraFeed](Frontend/src/hooks/useCameraFeed.ts) and use the existing [MediaPipe runtime](Frontend/src/services/landmarks/visionRuntime.ts). Keep recording progress updates local to the status display and keep exact timestamps in [useDatasetRecorder](Frontend/src/hooks/useDatasetRecorder.ts).

Verify the camera options, capture boundaries, raw and exported frames, and equivalence on the [Lab's wall-clock grid](Frontend/src/services/landmarks/windowResampling.ts) with irregular source timestamps. Run the frontend tests and production build. Webcam throughput requires a live measurement on the target device.

## Implemented and reviewed

- Sign Language Collector and Rest and Idle Collector share the Lab's live preset. The current [Phase 1 hand continuity settings](2026-11-17%20Recognition%20Lab%20FPS%20Plan.md#phase-1-hand-continuity--2026-11-18) use two hands continuously at 0.50, latest-frame scheduling, pose refresh every fourth processed frame, and a per-hand 150 ms canvas hold. The recorder stores the actual detections, including missing hands.
- The recording callback appends each in-clip `LandmarkFrameSample` directly to a ref. The recording status samples its count every 125 ms and measures FPS once per second. A queued frame timestamped before Start is excluded. Saving preserves the original timestamps, hands, and pose in the existing dataset format.
- [Recorder parity test](Frontend/tests/datasetRecorder.test.cjs) verified the JSON round trip and identical 40-frame grids using irregular source timestamps, missing hands, and two-hand samples. [Progress tests](Frontend/tests/collectorFps.test.cjs) verified polling intervals, wall-time FPS, and cleanup. The complete frontend suite and production build passed. Vite emitted its bundle-size warning.
- The collector export provides the input for the Lab's 1,333 ms resampling rule. The default offline training recipe still uses frame-index interpolation. Sustained 19–20 FPS and live tracking quality on the target webcam remain unmeasured.

## Original video downloads · 2026-11-18

The video ZIP has a **Start number** field beside **Download all as video**. The field defaults to 1, and numbering starts at the chosen number for each sign. Verified 20 HELLO files named `HELLO - 21.webm` through `HELLO - 40.webm` in capture order. All 22 focused tests and the production build passed.

Add a video-only archive action to Recorded samples in both live-landmark Collector views. Capture the camera stream during new takes and store each clip with its sample in local IndexedDB. Verify the capture and discard lifecycle, original video bytes in the ZIP, and legacy samples that have no clip.

- **Download all as video** sits at the right of [Recorded samples](Frontend/src/components/collector/SequenceList.tsx). It packages the clips attached to the listed samples as WebM or MP4 files. Legacy landmark-only samples have no clip to archive.
- [Camera capture](Frontend/src/services/dataset/cameraClip.ts) reads the existing camera stream without the landmark canvas. Saving and deleting operate on the sample and clip together. A recorder error leaves the landmark take available for saving.
- The frontend suite and production build passed. Tests exercised countdown, final video data delivery, discard, recorder failure, reload, deletion, and byte-preserving ZIP export. Vite emitted a bundle-size warning. Physical camera playback and FPS with video encoding are unmeasured.
