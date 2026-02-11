# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|------|---------|
| Install tools | `mise install` |
| Install deps | `pnpm install` |
| Generate proto stubs | `pnpm codegen` |
| Dev (all services) | `pnpm dev` |
| Build | `pnpm build` |
| Lint (all) | `pnpm lint` |
| Test (all) | `pnpm test` |
| Analyzer lint only | `pnpm --filter analyzer lint` |
| Analyzer test only | `pnpm --filter analyzer test` |
| Run single pytest | `cd services/analyzer && uv run pytest tests/test_foo.py -k test_name` |
| Web dev only | `pnpm --filter web dev` |

Proto codegen runs automatically before `dev` and `build`. If you edit `proto/codelens/v1/analysis.proto`, run `pnpm codegen` and check that generated files are clean with `git diff`.

## Architecture

Monorepo (pnpm workspaces + Turborepo) with a shared Protocol Buffers contract connecting a Python backend and React frontend via Connect-RPC.

### Packages

- **`proto/`** — Protobuf service definitions (source of truth for API types). Managed by Buf.
- **`packages/proto-ts/`** — Generated TypeScript proto stubs (do not edit, regenerate with `pnpm codegen`).
- **`services/analyzer/`** — Python 3.13 backend: Starlette ASGI app served by Uvicorn. Uses DSPy RLM for AI-powered code analysis. SQLite for persistence, no ORM.
- **`apps/web/`** — React 19 + TanStack Start frontend. Vite build, Tailwind CSS, shadcn/ui-style components with CVA variants.

### Backend (services/analyzer)

Entry point: `src/analyzer/server.py` → `create_app()` builds the Starlette app.

Key layers:
- **`service.py`** — Connect-RPC handlers implementing `AnalysisService` from the proto definition.
- **`store.py`** — Async SQLite persistence (raw SQL, no ORM). Schema: single `analyses` table.
- **`jobs/manager.py`** — Asyncio-based job orchestration with semaphore concurrency control. Jobs are fire-and-forget or streaming via `asyncio.Queue`.
- **`analysis/rlm_engine.py`** — DSPy RLM orchestrator. Runs 4 sequential sub-agents (summary, frameworks, patterns, insights) against a repo snapshot.
- **`analysis/repo_snapshot.py`** — Builds a JSON snapshot of a repo (file tree, manifests, code snippets) within a byte budget.
- **`analysis/rlm_agents.py`** — Sub-agent configs (signatures, iteration/call limits).
- **`analysis/rlm_tools.py`** — Tools exposed to RLM agents: `list_files`, `get_file_content`, `search_files`.
- **`analysis/rlm_streaming.py`** — Wires DSPy streaming to progress events with heartbeat.
- **`analysis/rlm_parse.py`** — Parses and validates JSON output from RLM agents.
- **`config.py`** — Loads `Settings` dataclass from `CODELENS_*` env vars.
- **`git_ops.py`** — Shallow-clones repos (HTTPS only).
- **`models.py`** — Frozen dataclasses: `AnalysisResultData`, `Framework`, `Pattern`, `Insight`.

Python linting: Ruff (100 char line length, Python 3.13 target). Tests: pytest with pytest-asyncio (auto mode).

### Frontend (apps/web)

Routing: TanStack Router (file-based). Routes live in `src/routes/`. The route tree is auto-generated in `src/routeTree.gen.ts` — do not edit.

Key routes:
- `index.tsx` — Home page. Submits repos via `analysisClient.analyzeStream()` (server streaming) and navigates to detail on completion.
- `analysis.$id.tsx` — Analysis detail. Polls `getAnalysis` every 1.5s while status is RUNNING.

API client: `src/lib/rpc.ts` exports `analysisClient` (Connect-RPC transport pointing at `VITE_ANALYZER_BASE_URL`).

UI components: `src/components/ui/` follow shadcn/ui conventions — CVA variants, `cn()` utility for class merging, Radix UI primitives. Dark-mode-only design with cyan/tech aesthetic.

### Data Flow

1. User submits a Git URL on the home page
2. Frontend calls `AnalyzeStream` RPC → server streams progress events
3. Backend clones repo, builds snapshot, runs 4 RLM sub-agents sequentially
4. Results stored in SQLite, streamed to frontend as `ProgressEvent`s
5. On completion, frontend navigates to detail page which fetches via `GetAnalysis`

## Environment

Copy `.env.example` to `.env`. Required variables:
- `CODELENS_DSPY_LM` — DSPy language model identifier (e.g. `groq/llama-3.3-70b-versatile`)
- `GROQ_API_KEY`
- Deno must be on PATH (used by DSPy RLM sandbox). Install via `mise install`.

## Code Style

- TypeScript: strict mode, 2-space indent
- Python: Ruff, 4-space indent, 100 char lines, frozen dataclasses throughout
- Proto: Buf lint with standard rules
