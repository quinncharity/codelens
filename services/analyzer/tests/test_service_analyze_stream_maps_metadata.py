from __future__ import annotations

import pytest

from analyzer.jobs.manager import ProgressEvent
from analyzer.service import AnalysisServiceImpl
from analyzer.store import SQLiteStore
from codelens.v1 import analysis_pb2


class FakeJobs:
    async def start_stream(self, *, git_url: str, ref: str):  # type: ignore[no-untyped-def]
        return "job-1", object()

    async def iter_progress(self, q):  # type: ignore[no-untyped-def]
        yield ProgressEvent(
            phase="ANALYZE",
            progress=0.5,
            message="hello",
            agent="summary",
            kind="LM_START",
            step=1,
            step_total=4,
        )


@pytest.mark.asyncio
async def test_analyze_stream_maps_metadata(tmp_path) -> None:  # type: ignore[no-untyped-def]
    store = SQLiteStore(tmp_path / "db.sqlite")
    await store.init()

    svc = AnalysisServiceImpl(store=store, jobs=FakeJobs(), repo_cache_dir=tmp_path)  # type: ignore[arg-type]

    req = analysis_pb2.AnalyzeStreamRequest(git_url="https://example.com/repo.git", ref="")
    out = []
    async for ev in svc.analyze_stream(req, None):  # type: ignore[arg-type]
        out.append(ev)

    assert out[0].phase == "START"
    assert out[0].agent == "engine"
    assert out[0].kind == "JOB_START"

    assert out[1].phase == "ANALYZE"
    assert out[1].agent == "summary"
    assert out[1].kind == "LM_START"
    assert out[1].step == 1
    assert out[1].step_total == 4

