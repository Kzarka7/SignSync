# Alphabet recognition continuity — 2026-11-05

Superseded for repeat handling: at the user's request, all three Recognition Lab model options now share `LIVE_RECOGNITION_POLICY` with Live Conversation (segmented capture, confirmation acceptance). The custom handshape repeat rule was removed. The rolling-window behavior and replay results below document the earlier experiment, not the current active capture policy. J/T backend routing remains active. The optional number-hold check remains a prediction filter and no longer changes capture mode.

Recognition Lab alphabet mode uses continuous 1,500 ms rolling windows with the existing 150 ms stride and three-of-four confirmation over 400 ms. It does not wait for a motion-triggered segment. Other sign models retain their existing capture modes.

The supplied `signsync-camera-diagnostics-2026-11-05T15-42-23-801Z.json` contained 20 four-second segment duration discards. Those ended inference until another motion onset, explaining the need to shake the hand. Continuous windows remove that capture dependency.

Same-letter repetition can rearm after a sustained handshape departure and return: wrist-relative, palm-scaled landmark RMS distance greater than 0.25 palm units for 150 ms, followed by distance below 0.12 for 150 ms. New confirmation is required. Translation, scale changes, small jitter and tracking loss alone do not rearm this rule. Existing visible motion-boundary and sustained no-hands rules remain available. This is a provisional intent heuristic; a completely unchanged hold cannot reveal whether the user intends another letter.

The original static-first adapter could override temporal J with a confident static T. A sustained extended pinky with the index, middle and ring fingers folded now permits the learned temporal J prediction to compete with static output. It still requires deliberate motion, confidence >=0.80 and margin >=0.15. The handshape rule alone cannot identify J because I shares its posture. Static T is rejected when it conflicts with this sustained extended-pinky evidence. This is an explicit geometric routing heuristic, not a newly trained model or calibrated probability of correct signing.

Active backend identity: `lab-alphabet-j460-v2-seed43-graph-diagnostics`. Alphabet recognition loads `models/current/alphabet_26_j460_v2/alphabet_26_j460_v2_seed43` with its matching scalers and labels. The frozen training package is under `processed/current/alphabet_26_j460_v2_seed42`. Seed 43 was selected by lowest validation loss across seeds 42–44. The previous `alphabet_26_mixed_v1_seed42` checkpoint is preserved. The failed OTHER/J/Z candidate remains inactive. Existing J/T routing and per-segment repeat confirmation are retained. No diagnostic frames were added to training.

Integration verification on 2026-11-07: actual graph probabilities matched the saved seed-43 predictions exactly for one held-out example from each of the 26 classes. Local websocket readiness announces the new recognizer ID and run. Eight backend alphabet tests, four diagnostic endpoint tests, 22 targeted frontend tests and production build passed.

The real websocket smoke test also confirms a remaining routing failure: J clips 495, 692 and 693 produce static X (rejected), O (accepted) and O (accepted), respectively, even though their complete temporal inputs classify as J. This is not checkpoint/scaler mismatch. The existing recent-motion/static-first input policy still bypasses temporal inference for these clips. Integration of the checkpoint alone does not establish successful live J recognition; further routing work needs separate validation with motion negatives and static holds.

## Replay and validation

Replayed all 2,206 normalized frames through 923 continuous windows with the actual backend and the shared frontend confirmation policy; no inference failures. The original segmented log had 433 windows. These overlapping window counts are not accuracy measurements.

- Original 50–62s transcript: I 51.79, T 53.84, T 56.97, J 58.93. Updated: I 51.69, J 58.84, D 60.79.
- Original 160–175s transcript: T 162.72, T 166.27, T 172.61. Updated: T 162.64, J 171.20.
- T around 100.81s remains accepted. Z appears around 135.65s.
- 17 windows selected learned J with compatible handshape; 50 windows rejected conflicting static T.
- One handshape release-and-return event rearmed confirmation.

There are no intended-letter interval annotations. These are behavioral observations, not ground-truth accuracy. The remaining T and other questionable outputs require labeled live-camera evaluation. Rules were developed using this diagnostic recording, so it is a development regression example, not an independent test set.

Validation: eight alphabet backend tests, four diagnostic endpoint tests, 48 targeted frontend tests and production build. Tests cover stationary observation beyond four seconds, handshape release-and-return repetition, rejection of jitter/scale/translation/dropout as repeat intent, J/T routing and JSON serialization. Replay artifacts are in `.tmp/alphabet-continuity-replay.json` and `.tmp/alphabet-continuity-summary.json`.
