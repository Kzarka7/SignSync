# Automatic capture: offline prototype

For the current separate signs/resting/idle-movement training workflow, see
[SEPARATE_TRAINING_COLLECTION.md](SEPARATE_TRAINING_COLLECTION.md). This guide
describes the retained boundary evaluation tools and earlier 40-task pilot.

The next development step is evaluation of isolated sign boundaries with pauses.
The detector and replay command have no live camera, socket, classifier, or
conversation integration. Manual confirmation remains in the current live flow.
The replacement training models remain an isolated experiment.

## Current collection workflow

Dataset Collector has two views:

- Dataset collector records individual signs and lists saved sign samples.
- Boundary evaluation collects separate Resting postures and Idle movements
  for training alongside the existing sign recordings.

Despite its name, the current Boundary evaluation view saves training samples.
It does not collect continuous pilot evaluation recordings. No participant,
session, notes or batch setup is required. Preserve signer identities separately
when organizing exported datasets and choosing held-out participants.

Resting has 10 posture combinations with three takes each (30 total). Idle
movements has seven activities with three takes each, plus General idle with
unlimited takes. Both use clickable checklists. After three successful saves,
selection advances to the next incomplete task; General idle stays selected.
Recording each take still starts manually.

Delay and Duration are unselected by default: recording starts immediately and
stops when Stop & save is pressed. Each offers optional 1s, 3s and 5s buttons;
click the selected option again to deselect it. Lists, exports and Clear all
apply to the active category. Idle movements display IDLE in the sample list
while retaining IDLE_MOVEMENT in stored/exported labels and category metadata.

## Retained 40-task pilot protocol

The earlier pilot collection screen and its checklists have been removed.
The task definitions remain in boundaryEvaluation.ts for compatibility and
offline tooling: 24 ordinary transitions, four final holds, four repetitions,
four no-sign clips and four tracking interruptions. Previously saved evaluation
recordings remain in their separate browser-storage scope, but the current UI
does not provide access to or export that scope.

Existing evaluation-only JSON/ZIP exports can still be replayed using the
command below. Current sign, resting and idle training exports cannot be used
as direct inputs to that command; it explicitly rejects their schema.
Do not relabel training exports as pilot exports to bypass this check.

Future continuous evaluation collection needs a dedicated workflow with quiet
rest before and after signs, longer no-sign monitoring, matching video and
human-marked starts/ends. Separate training clips can train sign/rest/idle
behavior, but do not establish timing accuracy on continuous signing. The
prototype currently calibrates from one second of quiet tracked rest, so clips
that begin with signing or have insufficient rest may not become ready.

Keep evaluation exports outside training merge-input. They contain timestamped
raw landmarks, not video or human-marked boundaries. The replay command refuses
to overwrite an existing report.

## Replay an export

From the repository's Frontend directory:

```powershell
node scripts/replayBoundaryEvaluation.cjs 'C:\path\pilot.zip' 'C:\path\pilot-replay.json'
```

JSON input is also supported. Paths above are placeholders. The command uses
the project's existing Node dependencies; it does not connect to the backend.
The report gives each proposed segment's start, end, decision time, frame count,
quality fractions and discard reasons. All times are milliseconds relative to
the start of that recording. It also gives no-sign false captures per minute
and whether detected counts match the intended task count. An interruption task
has no assumed number of correct completed signs.
Inspect monitoring duration as well: calibration and unmonitored intervals are
excluded from the false-capture-rate denominator. A recording that never becomes
ready has no count-match verdict or false-capture rate evidence.

## Current prototype behavior

1. Calibrate from one second of quiet tracked rest. A recording beginning with
   signing cannot reliably provide this reference and may produce no segment.
2. Detect sustained wrist or average finger-landmark movement relative to the
   shoulders. Both hands remain available; one stationary hand is not removed.
3. Include 350 ms of pre-roll. A sustained start needs 150 ms of movement.
4. Hold a tentative capture through stillness away from the calibrated rest.
   End only after 750 ms of quiet near that reference; retain 150 ms of the
   final rest instead of the full decision delay.
5. Require rest before rearming to avoid duplicating a held posture. Rest already
   observed while deciding the end counts toward the 500 ms rearm interval.
6. Discard captures on long tracking interruptions, frame gaps over 300 ms,
   eight-second/240-frame limits, incomplete end-of-recording, or insufficient
   frames, duration, valid pose or hand presence. There is no automatic
   submission of a truncated sign at the capture limit.

All numeric values are unvalidated starting settings, not model confidence
thresholds. Start/quiet motion thresholds are 0.35/0.15 shoulder widths per
second; rest distance is 0.18 shoulder widths. Tracking dropout tolerance is
400 ms. Shoulder visibility below 0.5 is unusable. XY measurements have
projection and tracking limitations. Appearance alone does not start a capture.
If a hand was visible during calibration, its disappearance during capture is
treated conservatively as tracking loss. Returning below frame is only allowed
when the rest reference already lacked that hand and pose wrists indicate rest.

## What remains to validate

The synthetic tests check state transitions, holds, repetitions, finger-only
movement, varying sampling intervals, tracking loss and CLI/export separation.
They do not measure real user performance. Adjusting clothes or glasses may
still trigger the detector. A sign ending away from its starting rest, a slow
start, a change in resting posture, or a pause inside a sign may produce errors.
The detector has no learned IDLE class or knowledge of sign meaning.

Review matching videos and annotate actual starts/ends before evaluating cut-off
beginnings/endings, false splits, merged repetitions and decision delay. A
matching segment count alone does not demonstrate correct timing. Compare
human-trimmed and automatically trimmed clips through the same saved classifier
and fixed confidence/margin settings. Tune on development sessions, freeze the
settings, then evaluate held-out participants/sessions. Preserve results by
participant, device and processing FPS.

After offline validation, a separate opt-in integration can be considered.
That integration must pause for Add/Retry/Discard review, preserve manual
capture as a fallback, and require an explicit Add action for conversation text.
