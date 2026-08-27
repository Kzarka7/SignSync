import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

logging.basicConfig(level=logging.INFO)
from app.routers import sessions, messages, phrases, device, settings as settings_router
from app.ws import translate

app = FastAPI(
    title="SignSync API",
    description="Backend for the SignSync FSL conversation assistant frontend.",
    version="0.1.0",
)

# Matches VITE_API_BASE_URL / VITE_WS_URL, which both point at
# http://localhost:5173 in dev - see .env.example in the frontend repo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Every router here is mounted under /api, matching VITE_API_BASE_URL =
# http://localhost:8000/api in the frontend's client.ts.
app.include_router(sessions.router, prefix="/api")
app.include_router(messages.router, prefix="/api")
app.include_router(phrases.router, prefix="/api")
app.include_router(device.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")

# Mounted at the root, not under /api, matching VITE_WS_URL =
# ws://localhost:8000/ws/translate.
app.include_router(translate.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
