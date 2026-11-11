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
.\.venv-gru\Scripts\python.exe -m uvicorn app.main:app --app-dir Backend --host 127.0.0.1 --port 8000

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

## Test from another network

On Windows, install `cloudflared` and complete the local setup first. The script uses the `.venv-gru` backend environment and the installed dependencies in `Frontend`. Stop any existing manual tunnels, FastAPI on port `8000`, and Vite preview on port `4173` before starting.

From the SignSync repository root, run this in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\remote-test.ps1
```

The script starts two Cloudflare tunnels, configures the backend and frontend URLs, builds the frontend, and starts FastAPI and Vite preview. Send testers the HTTPS URL printed after **Share this link**. They can open it in a browser on another network without installing anything. To test live recognition, start a conversation, allow camera access, wait for **Ready**, and record a supported sign.

Keep your PC awake and the terminal open while people test. Press **Ctrl+C** to stop the test. Each run creates a new link. The test backend is unauthenticated, so use test data.
