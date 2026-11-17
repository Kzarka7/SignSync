# SignSync

Filipino Sign Language conversation assistant. This repository is a monorepo:

- `Frontend/` — React + TypeScript + Vite app
- `Backend/` — FastAPI API and WebSocket server

## Run locally

Use two terminals.

**Backend** (from `Backend/`):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
.\.venv-gru\Scripts\Activate.ps1
pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
.\.venv-gru\Scripts\python.exe -m uvicorn app.main:app --app-dir Backend --host 127.0.0.1 --port 8000 --reload --reload-dir Backend

uvicorn app.main:app --reload --port 8000
```

**Frontend** (from `Frontend/`):

```powershell
npm install
npm run dev
```

Point the frontend at the API with `Frontend/.env` (see `Frontend/.env.example`):

```
VITE_USE_MOCKS=false
VITE_API_BASE_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/ws/translate
```

Swagger: http://127.0.0.1:8000/docs

## Offline FSL testing

The [FSL test sandbox](scripts/fsl_sandbox/README.md) runs the 43 Similar Signs baseline against fixed clips. The [caption testing guide](scripts/fsl_sandbox/TESTING.md) covers the offline lexicalization and syntax prototype.

In **Recognition Lab**, run **43 Similar Signs (v1 baseline)** with Camera or Video. Stop recognition or let the video replay finish, then click **Pin baseline run**. In **Recognition model**, select **43 Similar Signs (v2 experiment)** and run again. Keep the camera setup and recognition settings the same, or replay the same loaded video. The results show both transcripts, and **Export recognition results** includes the pinned transcript as `comparisonBaseline`.

Sign one phrase per run. Keep **Caption rules** on **v1 demo** for a model-only comparison. Choose **v2 experiment** to try the new caption rules on the current transcript. Try `WAIT → PLEASE` for “Please wait.” or `TOMORROW → WAIT → PLEASE` for the experimental “Please wait tomorrow.” The pinned transcript keeps the caption setting it had when you pinned it.

For the 32-sign expansion, select **75 Signs (multi-batch candidate)** after pinning the v1 baseline. Prefer replaying the same video for both runs. Keep confidence, confirmation time, and landmark settings fixed. Include visible rest, idle hand movement, a repeated sign, and alternating similar signs. The candidate includes REST and IDLE_MOVEMENT as background classes and is available only in Recognition Lab. See the [dataset work note](obsidian://open?vault=SignSync%20Dataset&file=documentation%2F2026-11-15%20New%2032%20Signs%20Recognition%20Lab%20Retraining) for the checkpoints, results, and signer review.

To test the new vocabulary by itself, select **32 Signs (standalone candidate)** in Recognition Lab. Use a fresh recording and mark the intended label for each sign. Include visible rest, incidental hand movement, paired signs such as **MAYBE / AGAIN** and **PERSON / STUDENT**, and two separate performances of **FAST**. Export the recognition results with the same camera or video settings between trials.

To compare the 43-sign training recipe on the 32-sign vocabulary, replay an existing video with **32 Signs (standalone candidate)** and choose **Pin baseline run**. Select **32 Signs (similarity recipe)** and replay the same loaded video. The Lab shows both transcripts and includes the pinned run in **Export recognition results**. A minimum confidence setting of 90% gives both runs the same score floor for comparison. The similarity recipe uses 32 sign labels and treats background footage as an evaluation probe.

## Sign gloss notation in Recognition Lab

Use either **43 Similar Signs** model with **Camera** or **Video**. Try separate runs of `GOOD_MORNING`, `SIX`, `WAIT → WAIT` with a brief rest between signs, and `WAIT → PLEASE`. Under **Sign gloss notation**, expect the corresponding suggestions `GOOD-MORNING`, `SIX · 6`, two `WAIT` entries, and `WAIT` followed by `PLEASE` when those signs are confirmed.

After stopping, select a suggestion to review its gloss and time interval. Use **Add annotation** for a missed or unresolved sign, a reduplication span, or manually entered fingerspelling. On video, you can set each endpoint from the playhead. Save the underlying sign annotations first if you want to link them to a reduplication span. Add a reduplication annotation when the repeated pattern has been reviewed.

Use **Export recognition results** to save the suggestions and annotations in the report's `gloss` field. Video annotations remain available when replaying the same loaded file or comparing Lab models. **Export gloss annotations** is available for a manually annotated video before any recognition run. Annotations live in the current Lab session. Export camera annotations before starting a fresh run, and export video annotations before changing the input or leaving the Lab.

## Test from another network

Most recent test link: [Open SignSync](https://jeff-stamps-releases-affecting.trycloudflare.com). This link is temporary. Always use the URL printed after **Share this link** for the current run.

On Windows, install `cloudflared` and complete the local setup first. The script uses the `.venv-gru` backend environment and the installed dependencies in `Frontend`. Stop any existing manual tunnels, FastAPI on port `8000`, and Vite preview on port `4173` before starting.

From the SignSync repository root, run this in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\remote-test.ps1
```

The script starts two Cloudflare tunnels, configures the backend and frontend URLs, builds the frontend, and starts FastAPI and Vite preview. Send testers the HTTPS URL printed after **Share this link**. They can open it in a browser on another network without installing anything. To test live recognition, start a conversation, allow camera access, wait for **Ready**, and record a supported sign.

Keep your PC awake and the terminal open while people test. Press **Ctrl+C** to stop the test. Each run creates a new link. The test backend is unauthenticated, so use test data.

[Open the SignSync Dataset README](obsidian://open?vault=SignSync%20Dataset&file=README)
