# CodeLens

Analyze a Git repository and extract frameworks, patterns, and architectural insights.

This is a monorepo:
- `apps/web`: TanStack Start web UI
- `services/analyzer-ts`: TypeScript ConnectRPC analyzer service (Node.js)
- `proto`: protobuf API contract + codegen via Buf
- `packages/proto-ts`: generated TS stubs packaged for the web app

## Toolchain

This repo uses [mise](https://mise.jdx.dev/) to pin external tools (`node`, `pnpm`).

```bash
mise install
```

## Quickstart

1. Install dependencies:

   ```bash
   pnpm repo:setup
   ```

2. Verify local toolchain:

   ```bash
   pnpm toolchain:doctor
   ```

3. Start development servers:

   ```bash
   pnpm dev
   ```

Web runs at `http://localhost:3000`, analyzer at `http://localhost:8080`, and ConnectRPC at `http://localhost:8080/rpc`.

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
