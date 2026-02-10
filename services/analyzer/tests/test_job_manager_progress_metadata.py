from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from analyzer.jobs.manager import JobManager
from analyzer.models import AnalysisResultData
from analyzer.store import SQLiteStore


@pytest.mark.asyncio
async def test_job_manager_emits_progress_metadata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Avoid any real git/network operations.
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "package.json").write_text('{"name":"x"}', encoding="utf-8")

    async def fake_clone_repo(*, git_url: str, ref: str, cache_dir: Path) -> Path:
        return repo

    async def fake_analyze(self, repo_root: Path, emit) -> AnalysisResultData:
        await emit(
            "ANALYZE",
            0.5,
            "hello",
            agent="summary",
            kind="LM_START",
            step=1,
            step_total=4,
        )
        return AnalysisResultData(summary="ok")

    monkeypatch.setattr("analyzer.jobs.manager.clone_repo", fake_clone_repo)
    monkeypatch.setattr("analyzer.analysis.rlm_engine.RLMEngine.analyze", fake_analyze)

    store = SQLiteStore(tmp_path / "db.sqlite")
    await store.init()

    jobs = JobManager(store=store, repo_cache_dir=tmp_path / "cache", max_concurrent=1)
    _, q = await jobs.start_stream(git_url="https://example.com/repo.git", ref="")

    events = []
    async for ev in jobs.iter_progress(q):
        events.append(ev)
        await asyncio.sleep(0)

    assert any(
        (e.agent == "summary" and e.kind == "LM_START" and e.step == 1 and e.step_total == 4)
        for e in events
    )

