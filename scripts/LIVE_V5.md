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
two-second countdown, perform one complete sign, then click Finish sign.
Capture automatically finishes after eight seconds or 240 frames. Cancel discards
the recording. Review the top three predictions, score, and inference time.
Add sign to conversation inserts it once; intentional repeats require a new recording.
Ending the session saves the confirmed transcript in existing local history.

Recognition always connects to `VITE_WS_URL` (default
`ws://localhost:8000/ws/translate`), independently of `VITE_USE_MOCKS` for the
other app data. Timed demo translations have been removed. Reconnect is available
if the backend is offline. The first connection loads and warms the models.

## Artifacts and candidate

The default artifact root is the sibling `SignSync Dataset` folder. Override with
`SIGNSYNC_DATASET_ROOT` when starting the backend. Required artifacts:

- `processed/gru_*_geometry_v3_recordings_v5/{metadata.json,gru_data.npz}` for all three participant splits.
- `models/gru_model_train_test_geometry_v3_recordings_v5/<run>/{best_model.h5,evaluation.json}` for all nine runs.

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
A result can be added only when its mean score is at least 0.70 and the lead over
the second class is at least 0.15. These provisional thresholds are not calibrated
accuracy estimates. Continuous sign boundaries and P4 evaluation remain future work.

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
