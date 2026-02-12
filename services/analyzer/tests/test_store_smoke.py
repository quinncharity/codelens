from __future__ import annotations

from pathlib import Path

import pytest

from analyzer.models import AnalysisResultData
from analyzer.store import SQLiteStore


@pytest.mark.asyncio
async def test_store_roundtrip(tmp_path: Path) -> None:
    db = tmp_path / "db.sqlite"
    store = SQLiteStore(db)
    await store.init()

    await store.create(id="a1", git_url="https://example.com/repo.git", ref="")
    rec = await store.get(id="a1")
    assert rec is not None
    assert rec.status == "RUNNING"

    await store.set_succeeded(id="a1", result=AnalysisResultData(summary="ok"))
    rec2 = await store.get(id="a1")
    assert rec2 is not None
    assert rec2.status == "SUCCEEDED"
    assert rec2.result is not None
    assert rec2.result.summary == "ok"

