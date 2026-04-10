import type { IncomingMessage, ServerResponse } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { join } from "node:path";
import { SQLiteStore } from "../services/analyzer-ts/src/store.js";
import { BlobAnalysisStore } from "../services/analyzer-ts/src/blob-store.js";
import { JobManager } from "../services/analyzer-ts/src/job-manager.js";
import { registerRoutes } from "../services/analyzer-ts/src/service.js";

// ---------------------------------------------------------------------------
// Initialisation — captured in a try/catch so a cold-start failure returns a
// useful JSON error instead of a bare HTTP 500.
// ---------------------------------------------------------------------------

let handler: ReturnType<typeof connectNodeAdapter> | null = null;
let initError: string | null = null;

try {
  // On Vercel, /tmp is the only writable directory.
  const dbPath = process.env.CODELENS_DB_PATH || join("/tmp", "codelens.sqlite");
  const repoCacheDir =
    process.env.CODELENS_REPO_CACHE_DIR || join("/tmp", "repos");
  const maxConcurrentJobs = parseInt(
    process.env.CODELENS_MAX_CONCURRENT_JOBS || "1",
    10,
  );
  const useBlobStore =
    process.env.CODELENS_STORAGE_BACKEND === "vercel_blob" ||
    !!process.env.BLOB_READ_WRITE_TOKEN;

  const store = useBlobStore
    ? new BlobAnalysisStore(process.env.CODELENS_BLOB_PREFIX || "codelens/v1")
    : new SQLiteStore(dbPath);
  store.init();
  const jobs = new JobManager(store, repoCacheDir, maxConcurrentJobs);

  handler = connectNodeAdapter({
    routes(router) {
      registerRoutes(router, store, jobs, repoCacheDir);
    },
  });

  console.log(
    "[rpc] init OK — store:",
    useBlobStore ? "vercel_blob" : `sqlite:${dbPath}`,
    "repos:",
    repoCacheDir,
  );
} catch (e) {
  initError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error("[rpc] init FAILED:", initError);
}

// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, X-User-Agent",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Type, Connect-Protocol-Version, Grpc-Status, Grpc-Message",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default function rpcHandler(req: IncomingMessage, res: ServerResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health / diagnostics endpoint
  if ((req.url === "/api/rpc" || req.url === "/rpc") && req.method === "GET") {
    const ok = handler !== null;
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok, initError }));
    return;
  }

  // If initialisation failed, return a structured error.
  if (!handler) {
    console.error("[rpc] request rejected — init failed:", initError);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `RPC init failed: ${initError}` }));
    return;
  }

  // Strip the /api/rpc prefix that Vercel rewrites add
  if (req.url?.startsWith("/api/rpc")) {
    req.url = req.url.slice(8) || "/";
  } else if (req.url?.startsWith("/rpc")) {
    req.url = req.url.slice(4) || "/";
  }

  try {
    handler(req, res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[rpc] handler threw:", msg);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  }
}
