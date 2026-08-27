from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Matches VITE_API_BASE_URL / VITE_WS_URL in the frontend's .env.example.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    class Config:
        env_file = ".env"
        env_prefix = "SIGNSYNC_"


settings = Settings()
