# Collector live landmark FPS · 2026-11-18

Use Recognition Lab's optimized live landmark configuration for both live Collector views. Share the settings in [useCameraFeed](Frontend/src/hooks/useCameraFeed.ts) and use the existing [MediaPipe runtime](Frontend/src/services/landmarks/visionRuntime.ts). Keep recording progress updates local to the status display and keep exact timestamps in [useDatasetRecorder](Frontend/src/hooks/useDatasetRecorder.ts).

Verify the camera options, capture boundaries, raw and exported frames, and equivalence on the [Lab's wall-clock grid](Frontend/src/services/landmarks/windowResampling.ts) with irregular source timestamps. Run the frontend tests and production build. Webcam throughput requires a live measurement on the target device.

## Implemented and reviewed

- Sign Language Collector and Rest and Idle Collector now share the Lab's live preset. It enables latest-frame scheduling, pose refresh every fourth processed frame with the existing pose cache, pose-guided one- and two-hand tracking, and the Lab's filtering and hand assignment. Collector hand inference also runs during rest.
- The recording callback appends each in-clip `LandmarkFrameSample` directly to a ref. The recording status samples its count every 125 ms and measures FPS once per second. A queued frame timestamped before Start is excluded. Saving preserves the original timestamps, hands, and pose in the existing dataset format.
- [Recorder parity test](Frontend/tests/datasetRecorder.test.cjs) verified the JSON round trip and identical 40-frame grids using irregular source timestamps, missing hands, and two-hand samples. [Progress tests](Frontend/tests/collectorFps.test.cjs) verified polling intervals, wall-time FPS, and cleanup. The complete frontend suite and production build passed. Vite emitted its bundle-size warning.
- The collector export provides the input for the Lab's 1,333 ms resampling rule. The default offline training recipe still uses frame-index interpolation. Sustained 19–20 FPS and live tracking quality on the target webcam remain unmeasured.
