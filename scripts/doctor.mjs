#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const pkgJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const expectedPnpm = String(pkgJson.packageManager ?? "").replace(/^pnpm@/, "");

const checks = [
  { name: "node", command: "node", args: ["-v"] },
  { name: "pnpm", command: "pnpm", args: ["-v"], expected: expectedPnpm || null },
  { name: "uv", command: "uv", args: ["--version"] },
  { name: "deno", command: "deno", args: ["--version"] },
  { name: "buf", command: "pnpm", args: ["exec", "buf", "--version"] },
];

let hasFailure = false;

for (const check of checks) {
  try {
    const output = execFileSync(check.command, check.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")[0];

    if (check.expected && !output.includes(check.expected)) {
      console.error(
        `FAIL ${check.name}: expected ${check.expected}, got ${output}`
      );
      hasFailure = true;
      continue;
    }

    console.log(`OK   ${check.name}: ${output}`);
  } catch {
    console.error(`FAIL ${check.name}: command not available`);
    hasFailure = true;
  }
}

if (hasFailure) {
  console.error("\nRun `mise install` to install pinned tools.");
  process.exitCode = 1;
}
