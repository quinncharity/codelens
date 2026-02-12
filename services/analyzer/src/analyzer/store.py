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


@dataclass(frozen=True)
class RepoSummaryRecord:
    git_url: str
    ref: str
    last_analysis_id: str
    last_status: str  # RUNNING | SUCCEEDED | FAILED
    last_updated_at: str  # ISO8601 UTC timestamp


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
                # Demo app: keep this fast enough for repeated refreshes even as the DB grows.
                conn.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_analyses_repo_updated
                    ON analyses (git_url, ref, updated_at)
                    """
                )
                conn.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_analyses_updated
                    ON analyses (updated_at)
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

    async def list_repos(self, *, limit: int, offset: int) -> list[RepoSummaryRecord]:
        def _list() -> list[RepoSummaryRecord]:
            with sqlite3.connect(self._db_path) as conn:
                cur = conn.execute(
                    """
                    SELECT git_url, ref, id, status, updated_at
                    FROM (
                      SELECT
                        id,
                        git_url,
                        ref,
                        status,
                        updated_at,
                        created_at,
                        ROW_NUMBER() OVER (
                          PARTITION BY git_url, ref
                          ORDER BY updated_at DESC, created_at DESC, id DESC
                        ) AS rn
                      FROM analyses
                    )
                    WHERE rn = 1
                    ORDER BY updated_at DESC, git_url ASC, ref ASC
                    LIMIT ? OFFSET ?
                    """,
                    (int(limit), int(offset)),
                )
                rows = cur.fetchall()
                return [
                    RepoSummaryRecord(
                        git_url=str(r[0]),
                        ref=str(r[1]),
                        last_analysis_id=str(r[2]),
                        last_status=str(r[3]),
                        last_updated_at=str(r[4]),
                    )
                    for r in rows
                ]

        return await asyncio.to_thread(_list)

    async def delete_repo(self, *, git_url: str, ref: str) -> int:
        def _delete() -> int:
            with sqlite3.connect(self._db_path) as conn:
                cur = conn.execute(
                    """
                    DELETE FROM analyses
                    WHERE git_url = ? AND ref = ?
                    """,
                    (git_url, ref),
                )
                conn.commit()
                return cur.rowcount

        return await asyncio.to_thread(_delete)
