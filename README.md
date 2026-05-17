# CodeLens

CodeLens clones a **public Git repository**, runs a multi-step **LLM-powered analysis**, and presents architecture-oriented results: summary, frameworks, patterns, insights, and a structured view of services and code paths—with optional source browsing.

## What you need

| Requirement | Notes |
|-------------|--------|
| [mise](https://mise.jdx.dev/) (recommended) | Installs pinned Node and pnpm from `mise.toml` |
| Node **22.x** + [pnpm](https://pnpm.io/) **10.x** | Alternative if you skip mise |
| LLM provider API key | [Groq](https://console.groq.com/), [OpenRouter](https://openrouter.ai/), or any OpenAI-compatible API |

The analyzer only needs a provider key when you **start an analysis**. The web UI and analyzer process can start without one.

## Quick start

From the repository root:

```bash
# 1. Install toolchain (Node 22 + pnpm)
mise install

# 2. Install dependencies and generate protobuf stubs
pnpm repo:setup

# 3. Configure environment
cp .env.example .env
# Edit .env — set GROQ_API_KEY (or another provider key matching CODELENS_DSPY_LM)

# 4. (Optional) Verify tools
pnpm toolchain:doctor

# 5. Run web UI + analyzer
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The analyzer listens on [http://localhost:8080](http://localhost:8080) (ConnectRPC at `/rpc`).

### Without mise

Install Node 22 and pnpm 10 manually, then run steps 2–5 above.

## Environment variables

Copy `.env.example` to `.env` at the repo root. **Do not commit `.env`** — it is gitignored.

| Variable | Purpose |
|----------|---------|
| `VITE_ANALYZER_BASE_URL` | Where the browser sends RPC requests (default: `http://localhost:8080/rpc`) |
| `CODELENS_HOST` / `CODELENS_PORT` | Analyzer bind address (default: `0.0.0.0:8080`) |
| `CODELENS_DB_PATH` | SQLite database file (default: `.data/codelens.sqlite`) |
| `CODELENS_REPO_CACHE_DIR` | Directory for cloned repos (default: `.data/repos`) |
| `CODELENS_MAX_CONCURRENT_JOBS` | Parallel analysis limit (default: `1`) |
| `CODELENS_DSPY_LM` | Model identifier, e.g. `groq/openai/gpt-oss-120b` |
| `GROQ_API_KEY` | Required when using a Groq model |
| `OPENROUTER_API_KEY` | Required when using an OpenRouter model |
| `OPENAI_API_KEY` | Required for OpenAI-compatible endpoints |

See `.env.example` for OpenRouter and optional tuning variables.

## What it does

- **Bring your own repo**: Submit a public Git HTTPS URL and optional ref (branch, tag, or commit). The analyzer clones the tree, indexes source, and runs the pipeline.
- **Live progress**: Streams phases and per-agent updates while the job runs.
- **Rich results**: Frameworks, patterns with evidence, insights, and a service-oriented breakdown with source links when available.

## Architecture

| Layer | Stack |
|-------|--------|
| Web UI | TanStack Router / Start, React, Tailwind, Vite |
| API | [ConnectRPC](https://connectrpc.com/) — contracts in `proto/`, generated to `packages/proto-ts` |
| Analyzer | Node.js: git clone, snapshot, multi-agent LLM orchestration, SQLite |

```
apps/web/              Web UI
services/analyzer-ts/  Analyzer service + job runner
proto/                 API definitions (`pnpm codegen` → packages/proto-ts)
packages/proto-ts/     Generated TypeScript stubs
```

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Codegen + run web and analyzer in development |
| `pnpm build` | Codegen + production build |
| `pnpm lint` | Lint workspaces and protobuf |
| `pnpm test` | Run workspace tests |
| `pnpm codegen` | Regenerate protobuf TypeScript |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port already in use | Stop the other process or change `CODELENS_PORT` in `.env` |
| `buf` or `pnpm` not found | Run `mise install`, then `pnpm toolchain:doctor` |
| Analysis fails with auth errors | Ensure `CODELENS_DSPY_LM` matches the provider whose API key you set |
| Clone fails | Repo must be **public** and reachable from your machine |

## Security notes for public sharing

- Never commit `.env` or real API keys.
- Local clone data and SQLite live under `.data/` (gitignored).
- If this repository was ever pushed with secrets or `.vercel/project.json`, rotate those credentials and consider rewriting git history before publishing.
