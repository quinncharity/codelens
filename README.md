# CodeLens

Analyze a Git repository and extract frameworks, patterns, and architectural insights.

This is a monorepo:
- `apps/web`: TanStack Start web UI
- `services/analyzer`: Python ConnectRPC analyzer service (ASGI)
- `proto`: protobuf API contract + codegen via Buf
- `packages/proto-ts`: generated TS stubs packaged for the web app

## Quickstart

## Toolchain (mise)

This repo expects a few external tools (notably `deno` for DSPy RLM). We recommend using
[mise](https://mise.jdx.dev/) to install and pin them consistently.

```bash
mise install
```

If you don't want to modify your shell to activate mise globally, you can prefix commands with:

```bash
mise exec -- pnpm dev
```

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
- The analyzer runs a DSPy `RLM` (Recursive Language Model) and requires:
  - `CODELENS_DSPY_LM` (e.g. `groq/llama-3.3-70b-versatile`)
  - Deno installed and on `PATH` for the default sandbox
  - `GROQ_API_KEY`
