# CodeLens

Analyze a Git repository and extract frameworks, patterns, and architectural insights.

This is a monorepo:
- `apps/web`: TanStack Start web UI
- `services/analyzer`: Python ConnectRPC analyzer service (ASGI)
- `proto`: protobuf API contract + codegen via Buf
- `packages/proto-ts`: generated TS stubs packaged for the web app

## Quickstart

### 1) Install dependencies
```bash
pnpm install
```

### 2) Generate code
```bash
pnpm codegen
```

### 3) Run dev servers
```bash
pnpm dev
```

Web should run on `http://localhost:3000` (or whatever Start chooses) and the analyzer on `http://localhost:8080`.
The ConnectRPC base URL is `http://localhost:8080/rpc`.

## Notes
- The default analyzer engine is deterministic heuristics and does not require an LLM key.
- An optional `RLM` engine exists behind `CODELENS_ENGINE=rlm` and may require additional configuration.
