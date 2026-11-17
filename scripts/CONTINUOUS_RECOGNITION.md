# Continuous recognition development lab

Open **Recognition lab** in the sidebar (`/recognition-lab`). The default Live
conversation route, v5 model, acceptance rules and saved artifacts are unchanged.
The lab always connects explicitly to `p4-candidate` through the existing backend.
The lab requests `model=p4-candidate&diagnostics=1`. This executes the existing
candidate members through warmed TensorFlow graphs, sharing the same weights,
scalers, labels and acceptance/visibility rules. Ordinary P4 and v5 requests keep
their existing execution. Graph initialization checks numerical parity and fails
visibly if it differs. The first connection can take time to load and trace.
It maintains a separate experimental transcript, without writing training data or
conversation history. Start the frontend and backend as described in `LIVE_V5.md`.

## Verify the backend connection

The lab uses the same configured `VITE_WS_URL` as the app (normally
`ws://localhost:8000/ws/translate`), with `model=p4-candidate&diagnostics=1` added.
Changing source code does not update a backend process already running without
reload. Restart that backend after backend changes, then reload the lab page.

Before observation or video extraction, the lab now requires a ready handshake
with diagnostics protocol 1, execution `graph`, and recognizer ID
`p4-sign-rest-idle-nine-run-ensemble-graph-diagnostics`. Missing or different
identity stops the run with a backend mismatch message. Each prediction must
also identify the same recognizer. There is no automatic fallback to eager P4.

A successful run displays **Graph-diagnostics backend verified for this run**,
the actual recognition address, and the recognizer ID. JSON exports preserve
the verified backend identity, protocol, checkpoint run names and verification
time. The offline landmark replay command makes the same identity checks.

The default live v5 connection and ordinary P4 capture connection keep their
existing recognition behavior. Do not raise the stale-result limit merely to
hide a slow or incorrect backend connection. Inference round trip excludes
camera tracking and the temporal confirmation delay.

## Video replay

1. Select Video replay and choose the MP4. Files up to 120 seconds are supported.
2. For the development recording `08a1a524-460c-4e44-99b8-dedd623e9bec.mp4`, the
   approximate user notes (THANK YOU at 6–8 seconds, YES at 11–13 seconds) are
   selected automatically. Uncheck them for other videos. These notes are never
   passed to the classifier or acceptance policy.
3. Start video replay. The browser samples source time at 20 fps, using the same
   MediaPipe model options, handedness mapping, upper-body points and feature
   normalization as the camera. No image mirroring is applied to detection input.
4. Inspect raw predictions, stabilized activity and experimental transcript.
   Export diagnostic JSON after completion, or stop and export partial results.

Replay advances by seeking decoded video frames and waits for every window's
inference. It can be slower than video playback; this is an offline pipeline
check, not a live throughput benchmark. Extracted landmarks can differ from a
camera stream because of compression, sampling and tracker history.

## Optional continuous camera

1. Select Continuous camera, turn the camera on, and keep both shoulders visible.
2. Start camera observation. Rest, move casually, sign, and rest with hands still
   visible. REST and IDLE predictions continue without rest-pose calibration.
3. Stop diagnostics to retain the current logs. Turn the camera off to change
   sources. Export before starting another run; logs are held only in memory.

The display distinguishes current tracking, application activity and raw model
output. Raw predictions are available under **Raw model diagnostics** and in the
decision table. They remain unchanged even when an application rule blocks them.

## Policy v2: no-hands IDLE and tracking feedback

With valid body normalization and both shoulder visibility scores at least .5,
continuous absence of both hands for 500 ms displays **IDLE — no hands detected**.
This is an application visibility rule, with no model confidence score. It applies
equally to seated and standing users and never creates a sign transcript entry.
Inference may still run for diagnostics; a raw sign label cannot override the rule.

Before 500 ms, the display reports a brief hand-tracking interruption. Invalid
body tracking reports **TRACKING LOST** instead of IDLE. A source gap over 300 ms
restarts visibility evidence and window coverage. If camera observations stop for
750 ms, a wall-clock watchdog displays **TRACKING PAUSED**, including while the
last model result would otherwise look current. Recovery waits for fresh evidence.

Sustained no-hands IDLE can also release the accepted-sign latch: after the 500 ms
IDLE grace period, another 750 ms of uninterrupted absence with valid body tracking
rearms acceptance. Brief hand loss, pose loss, or unobserved time never releases
the latch. Tracking changes during an inference prevent that old result from
confirming a sign, including when tracking recovers before the result arrives.

The acceptance display identifies the last added sign, whether another boundary
is required, and the current qualifying boundary evidence. Model REST/IDLE remains
another rearming path. Confident wrong sign predictions with hands visible can
still keep the latch closed. No timeout forcibly unlocks it and no stillness rule
mistakes a held sign for rest. Repeated tracking loss requires investigation.

## Initial settings and limitations

### Optional gesture completion mode (segmentation v1)

The lab now starts with **Gesture completion (experimental)**. Select
**Rolling windows (revert)** after exporting/stopping to restore the preceding
1500 ms rolling-window behavior. Confirmation presets remain selectable in both
modes. This selector affects only Recognition lab; live conversation/model
selection and checkpoint files are unchanged.

Gesture mode forms a candidate from observed hand/finger motion with 100 ms of
pre-roll, then classifies progressively growing segments (minimum 400 ms) at the
selected cadence. The selected confirmation count/history/span still applies.
A confirmed proposal alone cannot print. Motion must settle for 300 ms, or a
tracked downward withdrawal must be followed by visible, lowered pose wrists
for 200 ms. Missing hands without that positive withdrawal evidence discard the
candidate. Body loss, observation gaps, 4-second capture limits and unfinished
source endings also discard it. An inactive resting hand is not treated as the
active signing hand merely because it was visible.

Completion removes 100 ms of the quiet/withdrawal tail. The final model output
must pass the existing score/margin and >=50% hand visibility gates and match a
recent confirmed proposal. When the segment is long enough, an additional view
with 150 ms removed from each end must independently pass and agree; shorter
segments retain the final-output/progressive-confirmation checks. These views
overlap and do not constitute independent accuracy evidence. Recent accepted
outputs keep an existing proposal fresh; invalid/stale results invalidate it.

Different completed labels can print without rest. Repeated labels retain the
sustained non-sign/no-hands rearming requirement. The camera serializes inference,
keeps only the latest progressive request and at most two queued completions,
and blocks stale or body-invalidated completions. Stop cancels all pending work.

Exports add recognitionMode, segmentationVersion, gestureSettings,
segmentationEvents, per-row segmentId/complete/decisionMs, and optional
completionValidation. Rolling mode remains policy v3. Segment completion is a
heuristic, not learned conversational segmentation or unrestricted repetition
recognition. The 81 reference clips are development data, not independent
validation or a random-movement rejection test.

The legacy CLI rolling replay and policy analyzer reject segmented exports
explicitly. Replay the original video in the lab with Gesture completion selected
to reproduce that mode, or use the gesture-aware evaluation harness recorded in
the experiment report.

The lab page starts with the trial 150 ms / 3-of-4 policy (minimum span 400 ms).
At evenly spaced 150 ms predictions, confirmation first becomes possible after
450 ms; three consecutive predictions span only 300 ms and cannot yet print.
Its confirmation selector retains 200 ms / 3-of-4 (minimum span 400 ms) and
350 ms / 2-of-3 (minimum span 350 ms) as
"revert to previous". Stop and export a run before switching. This trial default
is not evidence of improved accuracy. Shared tooling defaults remain 350 ms /
2-of-3 unless settings are supplied. Both retain the 1500 ms input window and all visibility/tracking gates.
Selection is frozen while running, starts a fresh session, and is included in
exported settings. The default live model and conversation controls are unaffected.

- A 1.5-second recent window advances every 350 ms. No hand disappearance or
  return to an initial pose is required to request predictions.
- At least eight frames and 80% valid normalization are required. The latest
  frame must also have valid normalization. Tracking gaps over 300 ms restart
  window coverage. The candidate's existing hand-visibility safeguard still runs.
- Policy v3 keeps the candidate's existing sign score/margin rules. Two accepted
  predictions of the same label among the latest three predictions, including
  the latest, spanning at least 350 ms produce one experimental transcript entry.
  A low-confidence result or non-sign consumes one slot; invalid/stale tracking
  or a prediction gap over 1000 ms clears confirmation evidence. Evidence is
  consumed after each entry. Windows overlap and are not independent votes.
- A different confirmed sign can print without REST/IDLE. The most recently
  printed label remains suppressed until a different sign prints, or REST/IDLE
  evidence spans at least 750 ms, with
  score at least .63 and margin at least .15, or the sustained no-hands rule above
  supplies a boundary. Uncertain evidence interrupts rearming. This remains an
  experimental transition policy, without learned gesture completion: alternating
  confident mistakes can print, and repeating the same sign still needs a boundary.
  Transcript scores remain the latest confirming model score, not measured accuracy.
- Camera inference has one request in flight and at most one pending window.
  New observations replace pending old windows. Results older than 1.5 seconds
  are logged but cannot confirm/rearm activity. Replay does not skip windows or
  apply wall-clock age rejection.
- Stop, disconnect, timeout, tracking failure, source changes and navigation must
  not allow late predictions to create new transcript entries. Runs are bounded
  to five minutes / 12,000 frames; video imports have a two-minute limit.
- The existing model learned complete recordings, not arbitrary streaming
  windows. Confident IDLE-to-sign errors can still pass the temporal policy.
  This interface is for identifying those errors, not declaring readiness.

## Diagnostic format

JSON exports contain the source, settings, selected annotations, replay extraction
metadata, normalized landmark frames in the original 164-feature order, every
evaluated window's raw prediction/top three/model ID, valid/hand fractions,
inference round trip, result age, activity/decision, and experimental transcript
timestamps. Camera pending-window replacement and stale-result counts are included.
Events from the existing motion/rest boundary detector are logged alongside the
rolling predictions for comparison. Incomplete captures at the end are not
classified by that detector; its last phase is separate from learned activity.
Camera exports also include a performance profile with processed frame rate,
tracking delegates and processing times. Low-frame-rate sessions retain frames
and gap counts for export even when no complete usable window is available.
Policy v2 exports additionally contain tracking transitions (including gap
durations), acceptance/rearming start/interruption/release events, per-window
tracking and acceptance state, and counts of rearms by model versus visibility
rule. These explain why a run remains waiting for rest. Older exports remain
readable; current replay adds v2 tracking defaults to their recorded settings.

All reported times are milliseconds relative to the first processed sample.
Approximate annotation intervals do not determine true sign boundaries and are
not automatically scored as ground truth. Preserve this video as a development
case. Collect fresh sessions before independently measuring false entries per
minute, correctly accepted signs, duplicate entries and recognition delays.

## Checks

From `Frontend`, run `node --test tests/continuousRecognition.test.cjs` for buffer
coverage, gaps, temporal acceptance, rearming, tracking quality, slow/offline
inference, latest-window scheduling, stale results, cancellation and failures.
Run the existing capture/socket/panel tests as well, then `npm run build`.

To repeat model inference on an existing export without re-extracting video:

```powershell
node scripts/replayContinuousDiagnostics.cjs <diagnostics.json> <new-report.json>
```

An optional third argument supplies a different backend WebSocket URL. The script
requires Node.js 22+ and always selects the diagnostic P4 connection. It retains
recorded settings and fills missing tracking settings with the current defaults,
uses the same window and temporal-policy code as the UI, compares results to the
original windows, records input-report SHA-256, and refuses to overwrite output.

To investigate waiting-for-rest behavior using the recorded predictions, with no
model server or new inference:

```powershell
node scripts/analyzeContinuousBoundaries.cjs <diagnostics.json> <new-report.json>
```

This replays every recorded frame's tracking state and evaluates the original
prediction windows under the current policy (v3). It reports old/new suppression counts,
no-hands IDLE windows, rearming events and additional candidate entries. Source
windows are evaluated at their end timestamps; delivery delay is not simulated.
It is a policy comparison, not evidence that extra accepted signs are correct.

### Accept on confirmation (lab experiment)

Gesture segments now offer a Transcript acceptance selector. The page defaults to
Accept on confirmation: a valid progressive window that passes the existing
confirmation policy prints immediately, with that prediction's score. Later
completion, score drops, or tracking loss cannot remove the saved entry.
Completion windows remain diagnostic only in this mode. Visibility, stale-result,
model rejection, and duplicate/rearming safeguards remain in effect.

Choose Wait for completion (revert) to restore the previous completed-gesture
validation, or Rolling windows to restore the rolling path. Export before changing
modes. Reports include segmentAcceptance and segmentationVersion 2. Programmatic
sessions that omit segmentAcceptance retain completion behavior for compatibility.
Early acceptance removes the final completion check and may accept partial gestures
or confident non-sign errors; its real-camera accuracy is not yet established.

### Repeated signs after a gesture boundary

Segmented accept-on-confirmation mode now permits the same label after a verified
completion of the previously accepted segment and a new motion onset. The new
segment must independently pass confirmation and visibility checks. Its frames
start after the boundary; completed capture history is cleared to prevent reuse.
A held posture, uncertainty, unverified hand loss, frame gap, or duration-limit
restart does not grant this permission. Existing REST/IDLE and sustained hand
absence rearming remain available. Completion-based acceptance is unchanged.
This shared policy applies to Recognition Lab and Live Conversation. Exports use
segmentationVersion 3 and report rearmedByGesture with the acceptance event reason
completed_gesture_then_new_motion. This remains a heuristic boundary, not proof
of linguistic separation; natural repetitions need camera validation.

### Fresh segment confirmation (version 4)

Accept-on-confirmation now honors each segment policy's successful confirmation,
including the same label as the previous segment. The global previous-label veto
is removed in this mode. This supersedes version 3's requirement that the preceding
segment end with a verified completion. Duplicate suppression still applies within
a segment. New segments after a timeout or tracking interruption must confirm again;
this can admit additional repetitions when a gesture is split incorrectly.
Exports mark these repeat events as fresh_segment_confirmation. Completion mode
retains its previous repeat gate. Both Live Conversation and the lab share this code.
