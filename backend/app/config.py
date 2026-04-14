from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SATB Choir API"
    environment: str = "development"
    api_prefix: str = "/api"
    storage_backend: str = "auto"
    mongodb_uri: str = "mongodb://127.0.0.1:27017"
    mongodb_db_name: str = "satb_choir_app"
    # In development, allow frontend + emulator + expo origins.
    # For production, use explicit origins only.
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://10.0.2.2:3000",
        "http://10.0.2.2:8000",
        "http://127.0.0.1:3000",
        "http://192.168.0.0/16",
        "*",
    ]
    audiveris_command: str | None = None
    satb_model_path: str = "artifacts/satb_random_forest.joblib"
    use_ml_classifier: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
