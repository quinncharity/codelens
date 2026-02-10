from __future__ import annotations

from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from analyzer.config import load_settings
from analyzer.jobs.manager import JobManager
from analyzer.service import AnalysisServiceImpl
from analyzer.store import SQLiteStore
from codelens.v1.analysis_connect import AnalysisServiceASGIApplication


def _healthz(_request) -> JSONResponse:
    return JSONResponse({"ok": True})


def create_app() -> Starlette:
    settings = load_settings()
    store = SQLiteStore(settings.db_path)
    jobs = JobManager(
        store=store,
        repo_cache_dir=settings.repo_cache_dir,
        engine=settings.engine,
        max_concurrent=settings.max_concurrent_jobs,
    )
    svc = AnalysisServiceImpl(store=store, jobs=jobs)

    rpc_app = AnalysisServiceASGIApplication(svc)

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        await store.init()
        yield

    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    ]

    return Starlette(
        debug=True,
        middleware=middleware,
        lifespan=lifespan,
        routes=[
            Route("/healthz", _healthz, methods=["GET"]),
            Mount("/rpc", rpc_app),
        ],
    )


app = create_app()

