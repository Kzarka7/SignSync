# Promote 43 Similar Signs motion E to live model

**What was asked**
Promote the 43 Similar Signs motion E candidate to the current model, use it in Live Conversation, and replace the v1 baseline in the Recognition Lab.

**What changed**
- `Frontend/src/services/landmarks/liveRecognitionPolicy.ts`: `LIVE_SIGNS_MODEL` is now `lab-signs43-motion-e` (was `lab-signs43-similarity`). Added `LIVE_MOTION_PROFILE = 'motion-e'`.
- `Frontend/src/hooks/useContinuousLiveRecognition.ts`: Live Conversation now passes `motionProfile: 'motion-e'` with the live model.
- `Frontend/src/pages/RecognitionLabPage.tsx`: the v1 baseline entry is gone. The default/pinned Lab model is now "43 Similar Signs (motion E)". Removed the separate candidate entry and the comparisons that no longer did anything.
- Checks: `npx tsc --noEmit` passes, `npm run build` passes, `node tests/motionProfileE.test.cjs` reports 0 failures. Ran `graphify update .`.

**Decisions and caveats**
- The backend is unchanged. The `lab-signs43-motion-e` recognizer still loads its model files from `models/candidates/samples_43_signs_motion_e_v1/...`. The v1 `lab-signs43-similarity` backend mode stays available but is no longer in the Lab list.
- Motion E expected accuracy is 91.3% on unseen participants/batches (threshold 0.57).

**Not done / open**
- Not tested with a live camera in the app.

## Follow-up: move to current/ and Lab-identical live camera

**What was asked**
Move the motion E model from candidates to current. Make the live camera pipeline exactly match the Recognition Lab so it gets the same FPS.

**What changed**
- Moved `SignSync Dataset/models/candidates/samples_43_signs_motion_e_v1/` → `models/current/samples_43_signs_motion_e_v1/`. Updated paths in `Backend/app/sign_motion_e_recognition.py`, `experiments/samples_43_signs_motion_v1/{train_final_e.py, analysis/lab_parity_e.py, analysis/verify_final_e.py, REPORT.md}`, and the Recognition Lab table in `SignSync Dataset/README.md`. All 4 artifact SHA-256 checksums match after the move.
- `Frontend/src/hooks/useCameraFeed.ts`: new `LIVE_RECOGNITION_CAMERA_OPTIONS`, the Lab's default camera setup: optimized options, 640 px detection input, GPU hands, 720p, deferred/strided pose, one-hand mode, low-light assist, both landmark types.
- `RecognitionLabPage.tsx` takes its default settings from that constant. `useContinuousLiveRecognition.ts` passes the same constant unchanged. Before this, Live used full-resolution detection, no frame decoupling or pose striding, and the default palm threshold.
- Live session now also uses `wallClockWindows` and `poseGuidedOcclusion` (same as the Lab camera), skips frames when no session is active, and throttles status re-renders to 125 ms like the Lab snapshot.
- Tests updated: `tests/continuousLiveRecognition.test.cjs` (motion E model and profile, Lab camera options) and `tests/recognitionLabComparison.test.cjs` (mock constant). All `tests/*.test.cjs` pass. `tsc --noEmit` passes, `npm run build` passes, `graphify update .` ran.

**Decisions and caveats**
- Fingerspelling mode keeps `settleConfirmedHold`, which is live-only alphabet behaviour.
- The backend model was not loaded: no local Python has numpy/TensorFlow. Only the checksums were verified.
- FPS was not measured with a camera.
