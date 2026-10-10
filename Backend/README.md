# SignSync backend

FastAPI backend built to satisfy the exact contract already defined by the
SignSync frontend's service layer (`src/services/api/*`, `src/services/ws/translationSocket.ts`).
REST demo data is selected with `VITE_USE_MOCKS`. Live sign recognition always
uses the real WebSocket backend. See [live v5 setup](../scripts/LIVE_V5.md).

## Why it matches without a spec doc

Every Pydantic model in `app/models/` mirrors a TS interface in the
frontend's `src/types/` field-for-field (including camelCase names), and
every route mirrors a comment already present in the frontend's service
files (e.g. `// Future FastAPI route: GET /api/phrases?category=medical`).
The in-memory data in `app/data/` is seeded with the same values as the
frontend's `src/mocks/*.json`, so behavior is identical during the
transition - only the transport changes.

## Endpoints

REST (mounted under `/api`, matching `VITE_API_BASE_URL`):

| Method | Path | Matches |
|---|---|---|
| GET | `/api/sessions?limit=N` | `getRecentSessions()` |
| GET | `/api/sessions` | `getAllSessions()` |
| GET | `/api/sessions/{id}` | `getSessionById()` |
| GET | `/api/sessions/{id}/messages` | `getMessagesForSession()` |
| GET | `/api/phrases?category=` | `getPhrases()` |
| GET | `/api/device/status` | `getDeviceStatusSnapshot()` |
| GET | `/api/settings` | `getSettings()` |
| PUT | `/api/settings` | `updateSettings()` |

WebSocket (mounted at root, matching `VITE_WS_URL`):

- `ws://localhost:8000/ws/translate` loads the nine-run v5 ensemble and emits
  loading/ready status. Submit `{ "type": "sign", "payload": SignRequest }`
  with a request ID, the collector feature order, and captured frames. Responses
  are `prediction` or `error` events. No demo translations are emitted.
- `{ "type": "control", "action": "end-session" }` closes the connection.
  Transcript export and confirmation happen in the frontend.

## Running locally

```
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements-live.txt
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for interactive Swagger docs covering
every REST route.

## Remaining integrations

Camera landmarks are produced by the browser. The REST device snapshot and
other REST lists remain demo data. Sign recognition uses `app/recognition.py`
and the live WebSocket; the frontend confirms predictions before adding messages.
Speech-to-avatar rendering and persistent backend storage remain separate work.
There is no authentication or database in this local development backend.

For artifact paths, ensemble details, confidence gates, limitations, and tests,
see [LIVE_V5.md](../scripts/LIVE_V5.md).
