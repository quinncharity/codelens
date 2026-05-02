# CodeLens

Analyze a Git repository and extract frameworks, patterns, and architectural insights.

## Try it

The app is deployed at [https://codelens-self.vercel.app/](https://codelens-self.vercel.app/).

## Run locally

Prerequisites: [mise](https://mise.jdx.dev/) (recommended) or Node 20.x and [pnpm](https://pnpm.io/) 10.x.

1. Install pinned tools: `mise install` (installs Node and pnpm versions from this repo).
2. Install dependencies and generate protobuf code: `pnpm repo:setup`
3. Optional: `pnpm toolchain:doctor` to verify binaries on your PATH.
4. Optional: copy `.env.example` to `.env` and set analyzer/model keys if you run analysis jobs.
5. Start web + analyzer: `pnpm dev`

The web UI is at `http://localhost:3000`, the analyzer at `http://localhost:8080`, and ConnectRPC at `http://localhost:8080/rpc`. If something fails to start, run `pnpm toolchain:doctor`.

This is a monorepo:
- `apps/web`: TanStack Start web UI
- `services/analyzer-ts`: TypeScript ConnectRPC analyzer service (Node.js)
- `proto`: protobuf API contract + codegen via Buf
- `packages/proto-ts`: generated TS stubs packaged for the web app

## Environment

Copy `.env.example` to `.env` for local settings.

Analyzer startup does not require model credentials. These are required when you trigger analysis jobs:
- `CODELENS_DSPY_LM` (for example `groq/openai/gpt-oss-120b`)
- Provider API keys (for example `GROQ_API_KEY`)

## Common Commands

- `pnpm dev`: run web + analyzer in dev mode
- `pnpm build`: build all workspace packages
- `pnpm lint`: lint all workspaces + proto lint
- `pnpm test`: run all workspace tests
- `pnpm codegen`: regenerate protobuf artifacts

## Troubleshooting

- Analyzer port in use: stop the existing process or change `CODELENS_PORT`.
- Missing tool binaries: run `mise install`, then re-run `pnpm toolchain:doctor`.
