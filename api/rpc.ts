import type { IncomingMessage, ServerResponse } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { join } from "node:path";
import { SQLiteStore } from "../services/analyzer-ts/src/store.js";
import { JobManager } from "../services/analyzer-ts/src/job-manager.js";
import { registerRoutes } from "../services/analyzer-ts/src/service.js";

// On Vercel, /tmp is the only writable directory.
const dbPath = process.env.CODELENS_DB_PATH || join("/tmp", "codelens.sqlite");
const repoCacheDir = process.env.CODELENS_REPO_CACHE_DIR || join("/tmp", "repos");
const maxConcurrentJobs = parseInt(process.env.CODELENS_MAX_CONCURRENT_JOBS || "1", 10);

const store = new SQLiteStore(dbPath);
store.init();
const jobs = new JobManager(store, repoCacheDir, maxConcurrentJobs);

const handler = connectNodeAdapter({
  routes(router) {
    registerRoutes(router, store, jobs, repoCacheDir);
  },
});

export default function rpcHandler(req: IncomingMessage, res: ServerResponse) {
  // CORS — use explicit values instead of wildcards for broader
  // browser compatibility.
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

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Strip the /api/rpc prefix that Vercel rewrites add
  if (req.url?.startsWith("/api/rpc")) {
    req.url = req.url.slice(8) || "/";
  } else if (req.url?.startsWith("/rpc")) {
    req.url = req.url.slice(4) || "/";
  }

  handler(req, res);
}
