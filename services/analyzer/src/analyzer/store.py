from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from analyzer.models import AnalysisResultData


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class AnalysisRecord:
    id: str
    git_url: str
    ref: str
    status: str  # RUNNING | SUCCEEDED | FAILED
    result: AnalysisResultData | None
    error: str


class SQLiteStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    async def init(self) -> None:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

        def _init() -> None:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analyses (
                      id TEXT PRIMARY KEY,
                      git_url TEXT NOT NULL,
                      ref TEXT NOT NULL,
                      status TEXT NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL,
                      result_json TEXT,
                      error TEXT
                    )
                    """
                )
                conn.commit()

        await asyncio.to_thread(_init)

    async def create(self, *, id: str, git_url: str, ref: str) -> None:
        now = _now_iso()

        def _create() -> None:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO analyses (id, git_url, ref, status, created_at, updated_at, result_json, error)
                    VALUES (?, ?, ?, ?, ?, ?, NULL, '')
                    """,
                    (id, git_url, ref, "RUNNING", now, now),
                )
                conn.commit()

        await asyncio.to_thread(_create)

    async def set_succeeded(self, *, id: str, result: AnalysisResultData) -> None:
        now = _now_iso()
        payload = json.dumps(result.to_json_dict(), separators=(",", ":"), ensure_ascii=True)

        def _set() -> None:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    """
                    UPDATE analyses
                    SET status = ?, updated_at = ?, result_json = ?, error = ''
                    WHERE id = ?
                    """,
                    ("SUCCEEDED", now, payload, id),
                )
                conn.commit()

        await asyncio.to_thread(_set)

    async def set_failed(self, *, id: str, error: str) -> None:
        now = _now_iso()

        def _set() -> None:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    """
                    UPDATE analyses
                    SET status = ?, updated_at = ?, error = ?
                    WHERE id = ?
                    """,
                    ("FAILED", now, error, id),
                )
                conn.commit()

        await asyncio.to_thread(_set)

    async def get(self, *, id: str) -> AnalysisRecord | None:
        def _get() -> dict[str, Any] | None:
            with sqlite3.connect(self._db_path) as conn:
                cur = conn.execute(
                    """
                    SELECT id, git_url, ref, status, result_json, error
                    FROM analyses
                    WHERE id = ?
                    """,
                    (id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "id": row[0],
                    "git_url": row[1],
                    "ref": row[2],
                    "status": row[3],
                    "result_json": row[4],
                    "error": row[5] or "",
                }

        data = await asyncio.to_thread(_get)
        if data is None:
            return None

        result = None
        if data.get("result_json"):
            try:
                result = AnalysisResultData.from_json_dict(json.loads(data["result_json"]))
            except Exception:
                result = None

        return AnalysisRecord(
            id=str(data["id"]),
            git_url=str(data["git_url"]),
            ref=str(data["ref"]),
            status=str(data["status"]),
            result=result,
            error=str(data["error"]),
        )

