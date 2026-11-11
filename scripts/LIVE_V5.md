# Live conversation v5 development test

`pipeline` contains implementation work; merge it into `NF` for combined testing.
Promote `NF` to `main` after review. `ui-ux` can deliver independent changes to
`main`; then merge `main` back into `NF`. Use regular merges between ongoing branches.

## Run on this Windows workspace

From the repository root, start the backend in one terminal:

```powershell
.\.venv-gru\Scripts\python.exe -m pip install -r Backend/requirements-live.txt
.\.venv-gru\Scripts\python.exe -m uvicorn app.main:app --app-dir Backend --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```powershell
cd Frontend
npm install
npm run dev
```

Open http://localhost:5173, begin a conversation through Setup, start the camera,
and wait for recognition to say Ready. Click Record sign; prepare during the
selected 1s, 3s, or 5s countdown (default 3s), shown over the camera, perform one complete sign, then click Finish sign.
Capture automatically finishes after eight seconds or 240 frames. Cancel discards
the recording. Review the top three predictions, score, and inference time.
Add sign to conversation inserts it once; intentional repeats require a new recording.
Ending the session saves the confirmed transcript in existing local history.

Keyboard shortcuts: Space starts the selected preparation delay or finishes an active
recording; Esc discards a countdown or recording. Holding Space does not toggle
repeatedly. Shortcuts are ignored while typing, and other buttons keep their
normal keyboard behavior. Space during the countdown does not skip preparation.

Recognition always connects to `VITE_WS_URL` (default
`ws://localhost:8000/ws/translate`), independently of `VITE_USE_MOCKS` for the
other app data. Timed demo translations have been removed. Reconnect is available
if the backend is offline. The first connection loads and warms the models.

## Artifacts and candidate

The default artifact root is the sibling `SignSync Dataset` folder. Override with
`SIGNSYNC_DATASET_ROOT` when starting the backend. Required artifacts:

- `processed/baseline/recordings_v5/folds/gru_*_geometry_v3_recordings_v5/{metadata.json,gru_data.npz}` for all three participant splits.
- `models/baseline/recordings_v5/<run>/{best_model.h5,evaluation.json}` for all nine runs.

The development candidate averages probabilities equally across all three splits
and seeds 42/43/44. Each member uses its own saved training normalization and label
mapping; incompatible or missing artifacts fail visibly. Models load once per
backend process. No retraining occurs, and binary artifacts stay outside Git.
This ensemble is a NEW candidate, not the previously reported 89.42% mean of
nine individual held-out evaluations. P1–P3 samples are not held out from every
ensemble member, so replay results are integration checks, not generalization estimates.

Browser features use the dataset collector's existing normalization and exact
164-channel order. Python reuses the v5 runner's geometry reconstruction to build
40 frames × 238 channels, then applies saved statistics per member. Saved float32
statistics introduce at most 7.44e-5 absolute difference from the original test
tensors on the 1,200-sample parity check (training originally used float64 statistics).

## Limits and checks

This is explicitly segmented, isolated-sign testing. The model has 20 sign classes
and no idle/unknown class. Do not interpret arbitrary movements as supported signs.
At least 8 frames, 0.4–10 seconds, valid normalization in 80% of frames, and a
visible hand in 50% of frames are required. These are provisional quality gates.
A result can be added only when its mean score is at least 0.63 and the lead over
the second class is at least 0.15. These provisional thresholds are not calibrated
accuracy estimates. Manual confirmation remains required; accepted predictions are
not automatically added to the transcript. Continuous sign boundaries remain future work.

The 0.63 threshold is a controlled live-test candidate selected on 400 P4 recordings.
Compared with 0.70 (margin 0.15 unchanged), accepted mistakes increased from 4 to 5
and rejected correct predictions decreased from 75 to 44. P3 replay recovered 12
correct predictions without additional mistakes, but six live ensemble members used
P3 for training/validation. A separate P3-held-out three-model ensemble recovered
16 correct predictions with two additional accepted mistakes. These checks do not
establish independent validation of the full live ensemble's new threshold.
At confidence 0.63, the 0.15 margin is redundant for normalized probabilities,
since the runner-up cannot exceed 0.37. Reevaluate acceptance after any model change.

```powershell
.\.venv-gru\Scripts\python.exe -m pip install -r Backend/requirements-test.txt
.\.venv-gru\Scripts\python.exe -m unittest discover -s Backend/tests -p "test_*.py"
# Also compare all saved test tensors and exercise the real nine-model WebSocket:
$env:SIGNSYNC_TEST_ARTIFACTS='1'
.\.venv-gru\Scripts\python.exe -m unittest discover -s Backend/tests -p "test_*.py" -v
Remove-Item Env:SIGNSYNC_TEST_ARTIFACTS
.\.venv-gru\Scripts\python.exe -m unittest discover -s scripts -p "test_*.py"
cd Frontend
node --test tests/translationSocket.test.cjs
npm run build
```

Manual camera check: all 20 signs; no hands; missing shoulders; cancel mid-capture;
stop/restart camera; repeat the same sign intentionally; disconnect/reconnect backend;
end session and start another. Verify no automatic demo messages enter the timeline.


## Optional P4 sign / rest / idle camera test

In Live Conversation, select **P4 sign / rest / idle candidate (testing)**.
Start the camera, wait for Ready, then click **Start continuous testing** once.
Stay relaxed and still for about one second to calibrate your resting posture.
Perform one sign, return to that same posture, and wait for **Ready for next sign**
before performing the next sign. A clear rest of about 1.3 seconds separates
captures. Each accepted sign is appended automatically to transcription and the
conversation timeline with its model score percentage. Intentional repetitions
produce separate entries; a held final posture remains one capture. REST, IDLE,
uncertain results and signs blocked by missing hands are never transcribed.
Manual single-capture controls are also available when continuous testing is off;
accepted candidate results are auto-added in that mode too. Default v5 recognition
still requires manual capture and confirmation.

**Stop continuous testing** or Esc discards the unfinished gesture and queued
captures. A completed capture already being classified may still finish and appear.
Turning off the camera, disconnecting recognition, or switching model stops testing.
The model selector is locked during continuous testing; stop testing before switching.
Completed captures queue in order while the backend is busy (up to six waiting).
If the queue fills, an explicit warning asks you to pause; additional captures are
not submitted. Ending a session disconnects recognition and saves the transcript.

This first continuous mode uses the shared motion/rest boundary detector. Motion
starts a capture with 350 ms of pre-roll; returning to the calibrated posture for
750 ms ends it, followed by a 500 ms rest to rearm. It does not split signs performed
back-to-back without rest. A held gesture longer than eight seconds or 240 frames,
tracking loss, or long frame gaps causes a visible discard rather than a sign.
A stationary camera, visible shoulders, and a repeatable resting posture are
needed. Finger and wrist movement both count as motion. An idle movement can form
a capture too; the 22-class classifier decides whether it is a sign, REST or IDLE.
The boundary status is a heuristic, not a model prediction of REST or IDLE.

The backend lazily loads nine candidate checkpoints from
`models/baseline/sign_rest_idle_p4_signs_v1_2026_10_18/models` and corresponding
`processed/baseline/sign_rest_idle_p4_signs_v1_2026_10_18/folds/<fold>/{metadata.json,gru_data.npz}`. It uses each
member's saved scaler and the existing 0.63 score / 0.15 margin thresholds.
The current model remains the default on page load. No artifacts are replaced.
Missing candidate artifacts report an error; restart the backend after code changes.

Candidate signs require at least one detected hand in valid frames for at least
50% of a capture. REST/IDLE inference still allows hands out of view; missing hands
do not force an artificial REST/IDLE label. The UI explains blocked sign guesses.
Model scores are not measured accuracy. Try touching hair and scratching the face
as well as signs: those activities caused false sign accepts in the experiment.
Automatic boundaries are provisional and require camera testing. The nine-model
ensemble includes members trained on each of P1–P3, so this is a behavior check,
not a reproduction of held-out accuracy. P4 contributed signs only. Captures are
sent for inference, not saved as training recordings. Test transcriptions use the
normal session history/export; review them for mistakes.


P4 continuous testing now treats both hands absent (with valid shoulder/pose
tracking) as a rule-based REST / IDLE state. No motion calibration is required
in this state. Hands re-entering start a capture after the normal start debounce;
continuous absence for 750 ms finishes it, followed by the normal rearm period.
Brief hand dropouts do not split the capture. One hand disappearing while the
other remains visible keeps the previous tracking-loss protection. Missing pose
still requires recovery. The backend sign visibility safeguard and model scores
are unchanged. REST / IDLE camera status is a no-sign rule, not a measured
classifier score or a distinction between resting and idle movement.
