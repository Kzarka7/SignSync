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
pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
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
