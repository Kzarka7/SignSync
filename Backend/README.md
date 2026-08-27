# SignSync backend

FastAPI backend built to satisfy the exact contract already defined by the
SignSync frontend's service layer (`src/services/api/*`, `src/services/ws/translationSocket.ts`).
No frontend code changes are required to use this - point the frontend's
`.env` at it and flip `VITE_USE_MOCKS=false`.

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

- `ws://localhost:8000/ws/translate` — emits
  `{ "type": "translation", "payload": ConversationMessage }` on an
  interval (currently looping the same 4 demo messages the frontend mock
  uses), and accepts
  `{ "type": "control", "action": "end-session" | "export" }` from the
  client.

## Running locally

```
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for interactive Swagger docs covering
every REST route.

## Where the real integrations plug in (no contract changes needed)

- **MediaPipe (camera/hands/face detection)**: replace the static
  `DEVICE_STATUS` in `app/data/device.py` with a live object your
  MediaPipe pipeline updates, and push `{ "type": "status", "payload":
  DeviceStatusEvent }` events over the same `/ws/translate` socket
  whenever it changes — the frontend's `TranslationSocketEvent` type
  already supports a `"status"` event, it's just unused today.
- **Sign → text ML model**: wherever your model produces a translated
  sign, construct a `ConversationMessage` (source="sign") and
  `await websocket.send_json({"type": "translation", "payload": ...})`
  from that callback instead of the demo loop in `app/ws/translate.py`.
- **Speech → sign (avatar)**: the frontend's `AvatarPanel` mic/submit flow
  isn't wired to the socket yet, but when it is, extend the
  `elif action == "submit-speech":` branch already stubbed in
  `receive_control_messages()` — no envelope changes required.
- **Persistence**: swap the in-memory lists in `app/data/*.py` for real
  database queries (SQLAlchemy/SQLModel). Every router only imports from
  `app/data/`, so this is a contained, single-layer change.

## What's intentionally not here yet

No auth, no database, no ML — per the current scope. `app/data/settings.py`
holds one global settings object (fine for a single-user demo; would need
a per-user row + auth for anything beyond that).

<!-- uvicorn app.main:app --reload --port 8000 -->