from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from uuid import uuid4

from analyzer.analysis.rlm_engine import RLMEngine
from analyzer.git_ops import GitError, clone_repo
from analyzer.models import AnalysisResultData
from analyzer.store import SQLiteStore


@dataclass(frozen=True)
class ProgressEvent:
    phase: str
    progress: float
    message: str
    agent: str | None = None
    kind: str | None = None
    step: int | None = None
    step_total: int | None = None


class JobManager:
    def __init__(self, *, store: SQLiteStore, repo_cache_dir: Path, max_concurrent: int) -> None:
        self._store = store
        self._repo_cache_dir = repo_cache_dir
        self._sem = asyncio.Semaphore(max(1, max_concurrent))

    async def start(self, *, git_url: str, ref: str) -> str:
        job_id = str(uuid4())
        await self._store.create(id=job_id, git_url=git_url, ref=ref)
        asyncio.create_task(self._run_job(job_id=job_id, git_url=git_url, ref=ref, queue=None))
        return job_id

    async def start_stream(self, *, git_url: str, ref: str) -> tuple[str, "asyncio.Queue[ProgressEvent | None]"]:
        job_id = str(uuid4())
        await self._store.create(id=job_id, git_url=git_url, ref=ref)
        q: asyncio.Queue[ProgressEvent | None] = asyncio.Queue()
        asyncio.create_task(self._run_job(job_id=job_id, git_url=git_url, ref=ref, queue=q))
        return job_id, q

    async def _emit(
        self,
        queue: Optional["asyncio.Queue[ProgressEvent | None]"],
        phase: str,
        progress: float,
        message: str,
        *,
        agent: str | None = None,
        kind: str | None = None,
        step: int | None = None,
        step_total: int | None = None,
    ) -> None:
        if queue is not None:
            await queue.put(
                ProgressEvent(
                    phase=phase,
                    progress=progress,
                    message=message,
                    agent=agent,
                    kind=kind,
                    step=step,
                    step_total=step_total,
                )
            )

    async def _run_job(self, *, job_id: str, git_url: str, ref: str, queue: Optional["asyncio.Queue[ProgressEvent | None]"]) -> None:
        async with self._sem:
            try:
                await self._emit(
                    queue,
                    "CLONE",
                    0.0,
                    "Cloning repository",
                    agent="engine",
                    kind="PHASE_START",
                )
                repo_root = await clone_repo(git_url=git_url, ref=ref, cache_dir=self._repo_cache_dir)
                await self._emit(
                    queue,
                    "CLONE",
                    0.10,
                    "Clone complete",
                    agent="engine",
                    kind="PHASE_END",
                )

                async def emit(
                    phase: str,
                    progress: float,
                    message: str,
                    *,
                    agent: str | None = None,
                    kind: str | None = None,
                    step: int | None = None,
                    step_total: int | None = None,
                ) -> None:
                    await self._emit(
                        queue,
                        phase,
                        progress,
                        message,
                        agent=agent,
                        kind=kind,
                        step=step,
                        step_total=step_total,
                    )

                result: AnalysisResultData = await RLMEngine().analyze(repo_root, emit)

                await self._emit(
                    queue,
                    "STORE",
                    0.92,
                    "Persisting result",
                    agent="engine",
                    kind="PHASE_START",
                )
                await self._store.set_succeeded(id=job_id, result=result)
                await self._emit(
                    queue,
                    "STORE",
                    0.97,
                    "Persist complete",
                    agent="engine",
                    kind="PHASE_END",
                )
                await self._emit(queue, "DONE", 1.0, "Done", agent="engine", kind="JOB_END")
            except GitError as e:
                await self._store.set_failed(id=job_id, error=str(e))
                await self._emit(queue, "ERROR", 1.0, str(e), agent="engine", kind="ERROR")
            except Exception as e:
                await self._store.set_failed(id=job_id, error=str(e))
                await self._emit(queue, "ERROR", 1.0, str(e), agent="engine", kind="ERROR")
            finally:
                if queue is not None:
                    await queue.put(None)

    async def iter_progress(self, queue: "asyncio.Queue[ProgressEvent | None]") -> AsyncIterator[ProgressEvent]:
        while True:
            ev = await queue.get()
            if ev is None:
                return
            yield ev
