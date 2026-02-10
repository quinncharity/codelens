from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    db_path: Path
    repo_cache_dir: Path
    max_concurrent_jobs: int
    engine: str  # heuristic | rlm


def load_settings() -> Settings:
    host = os.environ.get("CODELENS_HOST", "0.0.0.0")
    port = int(os.environ.get("CODELENS_PORT", "8080"))
    db_path = Path(os.environ.get("CODELENS_DB_PATH", ".data/codelens.sqlite"))
    repo_cache_dir = Path(os.environ.get("CODELENS_REPO_CACHE_DIR", ".data/repos"))
    max_concurrent_jobs = int(os.environ.get("CODELENS_MAX_CONCURRENT_JOBS", "1"))
    engine = os.environ.get("CODELENS_ENGINE", "heuristic").strip().lower()

    if engine not in {"heuristic", "rlm"}:
        engine = "heuristic"

    return Settings(
        host=host,
        port=port,
        db_path=db_path,
        repo_cache_dir=repo_cache_dir,
        max_concurrent_jobs=max_concurrent_jobs,
        engine=engine,
    )

