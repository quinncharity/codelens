import { resolve } from "node:path";

export interface Settings {
  host: string;
  port: number;
  dbPath: string;
  repoCacheDir: string;
  maxConcurrentJobs: number;
}

export function loadSettings(): Settings {
  return {
    host: process.env.CODELENS_HOST ?? "0.0.0.0",
    port: parseInt(process.env.CODELENS_PORT ?? "8080", 10),
    dbPath: resolve(process.env.CODELENS_DB_PATH ?? ".data/codelens.sqlite"),
    repoCacheDir: resolve(
      process.env.CODELENS_REPO_CACHE_DIR ?? ".data/repos",
    ),
    maxConcurrentJobs: parseInt(
      process.env.CODELENS_MAX_CONCURRENT_JOBS ?? "1",
      10,
    ),
  };
}
