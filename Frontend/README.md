# Purdoy — FSL conversation assistant (frontend prototype)

Frontend-only prototype for the capstone project. No ML, no backend, no auth,
no database — every data source is either a static mock JSON file or a mocked
service that mimics the shape of the real integration to come.

## Stack
  
- React 18 + TypeScript + Vite
- React Router v6
- Zustand (session state)
- Tailwind CSS
- lucide-react (icons)

## Architecture: the "swap seam" pattern

Every piece of data or real-time state flows through a service module in
`src/services/`. Components never call `fetch`, open a `WebSocket`, or touch
a camera API directly — they call a service function or a hook that wraps
one. That's the seam where mocks get replaced by real integrations later,
with no component changes required.

```
src/services/
  api/            REST-shaped calls (sessions, messages, phrases, device
                  snapshot, settings). Each function checks VITE_USE_MOCKS
                  and either returns local JSON or calls FastAPI.
  ws/             translationSocket.ts defines ITranslationSocket. Today,
                  MockTranslationSocket emits the demo conversation on an
                  interval. Later, RealTranslationSocket opens a native
                  WebSocket to the FastAPI /ws/translate endpoint. Same
                  interface either way.
  media/          cameraService.ts defines ICameraDetectionService. Today,
                  a mock nudges device status on an interval. Later, a
                  MediaPipe Holistic pipeline maps landmark results into
                  the same DeviceStatus shape and calls the same callback.
```

`src/types/` doubles as the informal API contract — `ConversationMessage`,
`ConversationSession`, `DeviceStatus`, `QuickPhrase`, `AppSettings` are the
shapes both the mocks and the future FastAPI responses must satisfy.

## Switching from mocks to the real backend

1. Stand up FastAPI with routes matching the comments in each
   `src/services/api/*Service.ts` file (e.g. `GET /api/sessions`,
   `GET /api/sessions/{id}/messages`, `GET/PUT /api/settings`).
2. Implement the WebSocket endpoint referenced in `translationSocket.ts`
   (`/ws/translate`), emitting `{ type: 'translation', payload: ConversationMessage }`.
3. Implement MediaPipe Holistic in `RealCameraDetectionService`, mapping
   hand/face landmark presence and frame brightness into `DeviceStatus`.
4. Copy `.env.example` to `.env` and set `VITE_USE_MOCKS=false`,
   `VITE_API_BASE_URL`, and `VITE_WS_URL`.

No component or page needs to change for any of this — they only ever
imported the service/hook, never the mock data.

## Running locally

```
npm install
npm run dev
```

## Folder map

```
src/
  types/        Shared TS interfaces (the API contract)
  mocks/        Static JSON standing in for backend responses
  services/     api / ws / media - the swap seam described above
  hooks/        useDeviceStatus, useTranslationStream, useAsync, ...
  store/        Zustand store for the live session (timer, active state)
  components/   layout/, shared/, dashboard/, live/, history/, resources/, settings/
  pages/        One page component per route, composed from the above
```
