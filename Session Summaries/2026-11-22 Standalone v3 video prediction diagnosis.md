# Standalone v3 video prediction diagnosis

**What was asked**
Find why 32 Signs standalone v3 (95%+ offline) predicts badly in Lab video upload and live, using six queue exports (signsync-queue-results-2026-11-19*.json) from the training/validation/test source clips.

**What changed**
- No project files changed. Analysis scripts only, in the session scratchpad (`window_repro.py`, `swap_repro.py`).
- Queue exports (370 unique clips): TIRED 0/60, SICK 0/60 (57 → PERSON), HAPPY 0/60 (52 → PERSON), GOOD 0/60 (19 → BAD, 33 no windows), SAD 17/60 (38 no windows), BAD 34/70. Overall 51/370.
- Offline replay of the 194 v3 test samples through the real backend recognizer (`.venv-gru`):
  - Whole clip 192/194 (99.0%); 1500 ms @ 20 Hz windows 181/194 (93.3%); 1333 ms @ 30 Hz windows 184/194 (94.8%). Window length is not the main cause.
  - Same clips with left/right hand blocks swapped (features 36–99 ↔ 100–163): whole clip 85/194 (43.8%), windows 68/194 (35.1%). SICK → PERSON 6/6, HAPPY → PERSON 5/6, TIRED → DEAF/GRANDMOTHER/MOTHER, GOOD → BAD/SAD, SAD and BAD mostly stay correct. This matches the queue-export confusion pattern.

**Decisions and caveats**
- Root cause: hand-slot convention mismatch. Collector video import always calls `processVideo(..., { swapHandSides: true })` (`Frontend/src/components/collector/VideoUploadCollector.tsx:391` → `swapVideoHands`), so every v3 training sample has left/right hand slots swapped. Lab video replay (`Frontend/src/services/landmarks/videoReplay.ts`) and live camera (`Frontend/src/hooks/useCameraFeed.ts`) use `createStreamingHandAssignment` without the swap.
- The 95% figure was measured on already-extracted Collector landmarks, so it never exercised the inference extraction path.
- Secondary, not yet diagnosed: many GOOD/SAD/BAD clips produced zero prediction windows (quality/segmentation gating).

## Fix implemented
- `Backend/app/recognition.py`: `HAND_SWAPPED_TRAINING = {'lab-signs32-standalone', 'lab-signs32-similarity'}` and `swap_hand_slots()`. `V5Recognizer.predict` swaps feature blocks 36–99 ↔ 100–163 when `swap_hand_slots` is set; `SampleDiagnosticRecognizer` sets it per mode; the graph wrapper copies it.
- Training-data swap share (80-sample check per model): standalone v3 ~90%, 32 similarity ~79%, 75-sign sets ~26% (left unswapped), 33/43-sign sets 0%.
- `Backend/tests/test_diagnostic_recognition.py`: 3 new tests. All 36 backend tests pass (`.venv-gru`, unittest).
- Verified: test clips in Lab/live hand order through the patched recognizer score 192/194 whole clip and 181/194 at 1500 ms @ 20 Hz windows (previously 85 and 68). TIRED, SICK and HAPPY now 6/6.
- `graphify update .` run.

**Not done / open**
- Real Lab re-run of the six video queues and live camera check (needs backend restart).
- 75-sign models have mixed hand conventions in training data; needs a data fix (normalize samples) rather than an inference flag.
- Investigate the zero-window GOOD/SAD/BAD clips.

Related: [[Project Home]] · [[2026-11-19 Recognition Lab Video Queue]] · [[2026-11-19 Recognition Lab Live Accuracy Plan]]
