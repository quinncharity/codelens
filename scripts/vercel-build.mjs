#!/usr/bin/env node
/**
 * Vercel build script for the codelens monorepo.
 *
 * 1. Runs protobuf codegen.
 * 2. Builds the TanStack Start web app (Nitro generates Build Output API
 *    inside apps/web/.vercel/output/).
 * 3. Copies that output to the repo-root .vercel/output/ where Vercel
 *    expects it.
 * 4. Bundles serverless/rpc.ts as a Vercel serverless function inside the output.
 * 5. Injects the /rpc rewrite into the Build Output API config so that
 *    the api/rpc serverless function is reachable.
 */

import { execSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function run(cmd) {
  console.log(`▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

// 1. Codegen
run("pnpm codegen");

// 2. Build web app (Nitro auto-detects Vercel via VERCEL=1)
run("pnpm --filter @codelens/web build");

// 3. Copy Build Output API to repo root
const src = join(ROOT, "apps/web/.vercel/output");
const dest = join(ROOT, ".vercel/output");

if (!existsSync(src)) {
  console.error("ERROR: Nitro Build Output API not found at", src);
  console.error("Make sure VERCEL=1 is set and the nitro vite plugin is configured.");
  process.exit(1);
}

cpSync(src, dest, { recursive: true, force: true });
console.log(`✔ Copied Build Output API to ${dest}`);

// 4. Bundle serverless/rpc.ts as a serverless function using esbuild JS API
const funcDir = join(dest, "functions/api/rpc.func");
mkdirSync(funcDir, { recursive: true });

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(ROOT, "serverless/rpc.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["better-sqlite3"],
  outfile: join(funcDir, "index.mjs"),
  nodePaths: [
    join(ROOT, "node_modules"),
    join(ROOT, "services/analyzer-ts/node_modules"),
    join(ROOT, "packages/proto-ts/node_modules"),
  ],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
});
console.log("✔ Bundled serverless/rpc.ts");

// Copy better-sqlite3 native module into the function directory.
// With pnpm strict hoisting, the package lives in .pnpm — find it there.
try {
  const findCmd = `find ${join(ROOT, "node_modules/.pnpm")} -maxdepth 3 -name "better-sqlite3" -type d 2>/dev/null | head -1`;
  const bsqlPath = execSync(findCmd, { encoding: "utf-8" }).trim();
  if (bsqlPath) {
    const funcBsql = join(funcDir, "node_modules/better-sqlite3");
    cpSync(bsqlPath, funcBsql, { recursive: true, dereference: true });
    console.log("✔ Copied better-sqlite3 native module");
  } else {
    console.warn("⚠ better-sqlite3 not found in node_modules/.pnpm");
  }
} catch (e) {
  console.warn("⚠ Could not copy better-sqlite3:", e.message);
}

// Write .vc-config.json for the serverless function
// shouldAddHelpers must be false — Vercel's helpers eagerly parse
// application/json bodies, which drains the IncomingMessage stream before
// ConnectRPC can read it, causing an HTTP 500.
// maxDuration: raise from the default (10 s on Hobby) so the LLM analysis
// pipeline has time to finish.  Hobby max is 60 s; Pro max is 300 s.
writeFileSync(
  join(funcDir, ".vc-config.json"),
  JSON.stringify({
    runtime: "nodejs20.x",
    handler: "index.mjs",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    maxDuration: 300,
  }, null, 2)
);
console.log("✔ Created api/rpc serverless function");

// 5. Inject /rpc rewrite into config.json
const configPath = join(dest, "config.json");
const config = JSON.parse(readFileSync(configPath, "utf-8"));

const rpcRewrite = { src: "/rpc/(.*)", dest: "/api/rpc" };

// Insert BEFORE the catch-all SSR route
const catchAllIdx = config.routes.findIndex(
  (r) => r.dest === "/__server" || r.dest === "/__nitro"
);

if (catchAllIdx !== -1) {
  config.routes.splice(catchAllIdx, 0, rpcRewrite);
} else {
  const fsIdx = config.routes.findIndex((r) => r.handle === "filesystem");
  if (fsIdx !== -1) {
    config.routes.splice(fsIdx + 1, 0, rpcRewrite);
  } else {
    config.routes.push(rpcRewrite);
  }
}

writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log("✔ Injected /rpc rewrite into Build Output API config.json");
console.log("\n✅ Build complete. Ready for Vercel deployment.");
