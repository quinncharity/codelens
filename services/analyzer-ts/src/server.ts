import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { config } from "dotenv";
import { resolve } from "node:path";
import { loadSettings } from "./config.js";
import { SQLiteStore } from "./store.js";
import { StudyStore } from "./study-store.js";
import { JobManager } from "./job-manager.js";
import { registerRoutes } from "./service.js";
import { registerStudyRoutes } from "./study-service.js";

// Load .env from monorepo root (best-effort)
config({ path: resolve(process.cwd(), "../../.env") });
config(); // also try CWD

const settings = loadSettings();
const store = new SQLiteStore(settings.dbPath);
store.init();

const studyStore = new StudyStore(store.getDb());
studyStore.init();

const jobs = new JobManager(store, settings.repoCacheDir, settings.maxConcurrentJobs);

const handler = connectNodeAdapter({
  routes(router) {
    registerRoutes(router, store, jobs, settings.repoCacheDir);
    registerStudyRoutes(router, studyStore);
  },
});

const server = createServer((req, res) => {
  // CORS headers — use explicit values instead of wildcards for broader
  // browser compatibility (some browsers mishandle wildcard `*` for
  // Access-Control-Allow-Methods and Access-Control-Allow-Headers).
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

  // Health check
  if (req.url === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Strip /rpc prefix so ConnectRPC routes resolve correctly
  // The frontend sends requests to /rpc/codelens.v1.AnalysisService/...
  if (req.url?.startsWith("/rpc")) {
    req.url = req.url.slice(4) || "/";
  }

  handler(req, res);
});

// Listen on the configured host. Use "::" for dual-stack (IPv4 + IPv6) so
// browsers that resolve `localhost` to ::1 can connect.
const listenHost = settings.host === "0.0.0.0" ? "::" : settings.host;
server.listen(settings.port, listenHost, () => {
  console.log(`Analyzer (TS) listening on http://${listenHost}:${settings.port}`);
});
