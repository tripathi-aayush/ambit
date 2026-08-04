from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://ambit:ambit@localhost:5433/ambit"
    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_redirect_url: str = "http://localhost:8000/auth/github/callback"


settings = Settings()
