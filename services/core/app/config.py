from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # "ambit" here is the live Postgres role/db name baked into the
    # already-running container's data volume (see docker-compose.yml) --
    # deliberately not renamed as part of the Orion rebrand. Renaming it
    # would require recreating the volume and would orphan existing data.
    database_url: str = "postgresql+asyncpg://ambit:ambit@localhost:5433/ambit"
    opa_url: str = "http://localhost:8181"
    repos_dir: str = "./.data/repos"
    voyage_api_key: str = ""
    llm_provider: str = "groq"
    anthropic_api_key: str = ""
    groq_api_key: str = ""
    groq_api_keys_extra: str = ""  # comma-separated additional keys, failed over to on rate limit
    openai_api_key: str = ""
    gemini_api_key: str = ""

    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_redirect_url: str = "http://localhost:8000/auth/github/callback"
    github_token: str = ""  # PAT (repo scope) used by the web UI adapter to push branches + open PRs

    # Must match the real running container name, which Docker Compose
    # derives from the project directory name ("Ambit") -- not renamed as
    # part of the Orion rebrand for the same reason as database_url above.
    sandbox_container_name: str = "ambit-sandbox-1"
    plans_dir: str = "./.data/plans"

    # Sprint 1 / audit C1: shared-secret API key, checked on every request
    # (see app/auth.py). No per-user identity yet -- that's future work.
    orion_api_key: str = ""

    @property
    def groq_api_keys(self) -> list[str]:
        keys = [self.groq_api_key] + self.groq_api_keys_extra.split(",")
        return [k.strip() for k in keys if k.strip()]


settings = Settings()
