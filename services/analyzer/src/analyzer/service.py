from __future__ import annotations

from collections.abc import AsyncIterator

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext

from analyzer.jobs.manager import JobManager
from analyzer.store import SQLiteStore
from codelens.v1 import analysis_pb2
from codelens.v1.analysis_connect import AnalysisService


class AnalysisServiceImpl(AnalysisService):
    def __init__(self, *, store: SQLiteStore, jobs: JobManager) -> None:
        self._store = store
        self._jobs = jobs

    async def analyze(
        self, request: analysis_pb2.AnalyzeRequest, ctx: RequestContext
    ) -> analysis_pb2.AnalyzeResponse:
        git_url = (request.git_url or "").strip()
        ref = (request.ref or "").strip()
        if not git_url:
            raise ConnectError(Code.INVALID_ARGUMENT, "git_url is required")

        job_id = await self._jobs.start(git_url=git_url, ref=ref)
        return analysis_pb2.AnalyzeResponse(id=job_id)

    async def analyze_stream(
        self, request: analysis_pb2.AnalyzeStreamRequest, ctx: RequestContext
    ) -> AsyncIterator[analysis_pb2.AnalyzeStreamResponse]:
        git_url = (request.git_url or "").strip()
        ref = (request.ref or "").strip()
        if not git_url:
            raise ConnectError(Code.INVALID_ARGUMENT, "git_url is required")

        job_id, q = await self._jobs.start_stream(git_url=git_url, ref=ref)

        # Initial event so the UI can display the id immediately.
        yield analysis_pb2.AnalyzeStreamResponse(
            id=job_id,
            phase="START",
            progress=0.0,
            message="Started",
            agent="engine",
            kind="JOB_START",
        )

        async for ev in self._jobs.iter_progress(q):
            yield analysis_pb2.AnalyzeStreamResponse(
                id=job_id,
                phase=ev.phase,
                progress=float(ev.progress),
                message=ev.message,
                agent=ev.agent or "",
                kind=ev.kind or "",
                step=int(ev.step or 0),
                step_total=int(ev.step_total or 0),
            )

    async def get_analysis(
        self, request: analysis_pb2.GetAnalysisRequest, ctx: RequestContext
    ) -> analysis_pb2.GetAnalysisResponse:
        analysis_id = (request.id or "").strip()
        if not analysis_id:
            raise ConnectError(Code.INVALID_ARGUMENT, "id is required")

        rec = await self._store.get(id=analysis_id)
        if rec is None:
            raise ConnectError(Code.NOT_FOUND, "analysis not found")

        result = rec.result
        return analysis_pb2.GetAnalysisResponse(
            id=rec.id,
            git_url=rec.git_url,
            ref=rec.ref,
            summary=result.summary if result else "",
            frameworks=[
                analysis_pb2.Framework(
                    name=f.name,
                    version=f.version,
                    category=f.category,
                    confidence=float(f.confidence),
                )
                for f in (result.frameworks if result else [])
            ],
            patterns=[
                analysis_pb2.Pattern(
                    name=p.name,
                    category=p.category,
                    description=p.description,
                    evidence_paths=list(p.evidence_paths),
                    confidence=float(p.confidence),
                )
                for p in (result.patterns if result else [])
            ],
            insights=[
                analysis_pb2.Insight(
                    category=i.category,
                    title=i.title,
                    description=i.description,
                )
                for i in (result.insights if result else [])
            ],
            status=rec.status,
            error=rec.error,
        )

    async def list_repos(
        self, request: analysis_pb2.ListReposRequest, ctx: RequestContext
    ) -> analysis_pb2.ListReposResponse:
        limit = int(request.limit or 0)
        offset = int(request.offset or 0)

        if limit <= 0:
            limit = 25
        limit = min(max(1, limit), 200)
        offset = max(0, offset)

        rows = await self._store.list_repos(limit=limit, offset=offset)
        return analysis_pb2.ListReposResponse(
            repos=[
                analysis_pb2.RepoSummary(
                    git_url=r.git_url,
                    ref=r.ref,
                    last_analysis_id=r.last_analysis_id,
                    last_status=r.last_status,
                    last_updated_at=r.last_updated_at,
                )
                for r in rows
            ]
        )

    async def delete_repo(
        self, request: analysis_pb2.DeleteRepoRequest, ctx: RequestContext
    ) -> analysis_pb2.DeleteRepoResponse:
        git_url = (request.git_url or "").strip()
        ref = (request.ref or "").strip()
        if not git_url:
            raise ConnectError(Code.INVALID_ARGUMENT, "git_url is required")

        deleted_count = await self._store.delete_repo(git_url=git_url, ref=ref)
        return analysis_pb2.DeleteRepoResponse(deleted_count=deleted_count)
