from __future__ import annotations

from pathlib import Path

import pytest

import analyzer.store as store_mod
from analyzer.models import AnalysisResultData
from analyzer.store import SQLiteStore


@pytest.mark.asyncio
async def test_list_repos_returns_latest_analysis_per_repo_ref(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Make ordering deterministic across fast test runs.
    times = iter(
        [
            "2020-01-01T00:00:00+00:00",  # create a1
            "2020-01-01T00:00:01+00:00",  # succeed a1
            "2020-01-01T00:00:02+00:00",  # create a2
            "2020-01-01T00:00:03+00:00",  # fail a2
            "2020-01-01T00:00:04+00:00",  # create b1
            "2020-01-01T00:00:05+00:00",  # succeed b1
        ]
    )
    monkeypatch.setattr(store_mod, "_now_iso", lambda: next(times))

    db = tmp_path / "db.sqlite"
    store = SQLiteStore(db)
    await store.init()

    # Same repo/ref: a2 should win because it was updated last.
    await store.create(id="a1", git_url="https://example.com/a.git", ref="")
    await store.set_succeeded(id="a1", result=AnalysisResultData(summary="a1"))
    await store.create(id="a2", git_url="https://example.com/a.git", ref="")
    await store.set_failed(id="a2", error="boom")

    # Different repo/ref.
    await store.create(id="b1", git_url="https://example.com/b.git", ref="main")
    await store.set_succeeded(id="b1", result=AnalysisResultData(summary="b1"))

    repos = await store.list_repos(limit=25, offset=0)
    assert [(r.git_url, r.ref, r.last_analysis_id, r.last_status) for r in repos] == [
        ("https://example.com/b.git", "main", "b1", "SUCCEEDED"),
        ("https://example.com/a.git", "", "a2", "FAILED"),
    ]

    repos_page_1 = await store.list_repos(limit=1, offset=0)
    assert [r.last_analysis_id for r in repos_page_1] == ["b1"]

    repos_page_2 = await store.list_repos(limit=1, offset=1)
    assert [r.last_analysis_id for r in repos_page_2] == ["a2"]

