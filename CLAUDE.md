# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|------|---------|
| Install tools | `mise install` |
| Bootstrap repo | `pnpm repo:setup` |
| Verify local toolchain | `pnpm toolchain:doctor` |
| Generate proto stubs | `pnpm codegen` |
| Dev (all services) | `pnpm dev` |
| Build | `pnpm build` |
| Lint (all) | `pnpm lint` |
| Test (all) | `pnpm test` |
| Analyzer lint only | `pnpm --filter @codelens/analyzer lint` |
| Analyzer test only | `pnpm --filter @codelens/analyzer test` |
| Web dev only | `pnpm --filter @codelens/web dev` |

Proto codegen runs automatically before `dev` and `build`. If you edit `proto/codelens/v1/analysis.proto`, run `pnpm codegen` and check that generated files are clean with `git diff`.

## Architecture

Monorepo (pnpm workspaces + Turborepo) with a shared Protocol Buffers contract connecting a TypeScript backend and React frontend via Connect-RPC.

### Packages

- **`proto/`** — Protobuf service definitions (source of truth for API types). Managed by Buf.
- **`packages/proto-ts/`** — Generated TypeScript proto stubs (do not edit, regenerate with `pnpm codegen`).
- **`services/analyzer-ts/`** — TypeScript backend: Node.js HTTP server using Connect-RPC. Uses Vercel AI SDK for LLM-powered code analysis. SQLite (better-sqlite3) for persistence, no ORM.
- **`apps/web/`** — React 19 + TanStack Start frontend. Vite build, Tailwind CSS, shadcn/ui-style components with CVA variants.

### Backend (services/analyzer-ts)

Entry point: `src/server.ts` — creates an HTTP server with Connect-RPC routes.

Key layers:
- **`service.ts`** — Connect-RPC handlers implementing `AnalysisService` from the proto definition.
- **`store.ts`** — SQLite persistence (better-sqlite3, raw SQL, no ORM). Schema: single `analyses` table.
- **`job-manager.ts`** — Job orchestration with semaphore concurrency control. Jobs are fire-and-forget or streaming via async queue.
- **`analysis/engine.ts`** — LLM orchestrator using Vercel AI SDK. Runs 5 sequential sub-agents (summary, frameworks, patterns, insights, architecture) plus a functions agent against a repo snapshot.
- **`repo-snapshot.ts`** — Builds a JSON snapshot of a repo (file tree, manifests, code snippets) within a byte budget.
- **`analysis/agents.ts`** — Sub-agent configs (system prompts, output fields, token limits).
- **`analysis/tools.ts`** — Tools exposed to agents: `list_files`, `get_file_content`, `search_files`, `read_repo_file`.
- **`analysis/parse.ts`** — Parses and validates JSON output from agents.
- **`config.ts`** — Loads settings from `CODELENS_*` env vars.
- **`git-ops.ts`** — Shallow-clones repos (HTTPS only).
- **`models.ts`** — Zod schemas and TypeScript types: `AnalysisResultData`, `Framework`, `Pattern`, `Insight`, `ServiceModule`, `FunctionDetail`.

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
3. Backend clones repo, builds snapshot, runs 5 sub-agents sequentially plus a functions extraction pass
4. Results stored in SQLite, streamed to frontend as `ProgressEvent`s
5. On completion, frontend navigates to detail page which fetches via `GetAnalysis`

## Environment

Copy `.env.example` to `.env`.

Analysis runtime requirements:
- `CODELENS_DSPY_LM` — LLM model identifier (e.g. `groq/openai/gpt-oss-120b`)
- Provider key(s), for example `GROQ_API_KEY`

## Code Style

- TypeScript: strict mode, 2-space indent
- Proto: Buf lint with standard rules
