from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SATB Choir API"
    environment: str = "development"
    api_prefix: str = "/api"
    mongodb_uri: str = "mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority"
    mongodb_db_name: str = "satb_choir_app"
    allowed_origins: list[str] = ["http://localhost:3000"]
    audiveris_command: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
