import { createServer } from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { config } from "dotenv";
import { resolve } from "node:path";
import { loadSettings } from "./config.js";
import { SQLiteStore } from "./store.js";
import { JobManager } from "./job-manager.js";
import { registerRoutes } from "./service.js";

// Load .env from monorepo root (best-effort)
config({ path: resolve(process.cwd(), "../../.env") });
config(); // also try CWD

const settings = loadSettings();
const store = new SQLiteStore(settings.dbPath);
store.init();

const jobs = new JobManager(store, settings.repoCacheDir, settings.maxConcurrentJobs);

const handler = connectNodeAdapter({
  routes(router) {
    registerRoutes(router, store, jobs, settings.repoCacheDir);
  },
});

const server = createServer((req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

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

server.listen(settings.port, settings.host, () => {
  console.log(`Analyzer (TS) listening on http://${settings.host}:${settings.port}`);
});
