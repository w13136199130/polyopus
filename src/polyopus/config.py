"""Runtime configuration (M0: file/env only; no DB-backed settings yet)."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Instance-level settings. `POLY_` prefix maps to env vars."""

    model_config = SettingsConfigDict(
        env_prefix="POLY_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "dev"
    data_dir: Path = Path("data")
    db_path: Path = Path("data/polyopus.db")

    def resolved_db_path(self) -> Path:
        """Absolute DB path; `db_path` wins over `data_dir`."""
        if self.db_path.is_absolute():
            return self.db_path
        return (Path.cwd() / self.db_path).resolve()


def load_settings() -> Settings:
    return Settings()
