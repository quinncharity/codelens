import { ConnectRouter } from "@connectrpc/connect";
import { AnalysisService } from "@codelens/proto-ts";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import type { AnalysisStore } from "./store.js";
import { JobManager } from "./job-manager.js";
import type { AnalysisResultData } from "./models.js";
import { ConnectError, Code } from "@connectrpc/connect";
import { cloneRepo } from "./git-ops.js";

// ---------------------------------------------------------------------------
// Extension → language map (mirrors Python service.py)
// ---------------------------------------------------------------------------

const EXT_TO_LANG: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".css": "css",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".sh": "bash",
  ".sql": "sql",
  ".proto": "protobuf",
};

function mapAnalysisResponse(rec: {
  id: string;
  gitUrl: string;
  ref: string;
  status: string;
  error: string;
  result: AnalysisResultData | null;
}) {
  const result = rec.result;
  return {
    id: rec.id,
    gitUrl: rec.gitUrl,
    ref: rec.ref,
    summary: result?.summary ?? "",
    frameworks: (result?.frameworks ?? []).map((f) => ({
      name: f.name,
      version: f.version,
      category: f.category,
      confidence: f.confidence,
    })),
    patterns: (result?.patterns ?? []).map((p) => ({
      name: p.name,
      category: p.category,
      description: p.description,
      evidencePaths: p.evidencePaths,
      confidence: p.confidence,
    })),
    insights: (result?.insights ?? []).map((i) => ({
      category: i.category,
      title: i.title,
      description: i.description,
    })),
    services: (result?.services ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      moduleType: s.moduleType,
      entryPoints: s.entryPoints,
      keyFiles: s.keyFiles.map((f) => ({
        path: f.path,
        purpose: f.purpose,
        layer: f.layer,
      })),
      dependsOn: s.dependsOn,
      functions: s.functions.map((fn) => ({
        name: fn.name,
        signature: fn.signature,
        filePath: fn.filePath,
        startLine: fn.startLine,
        endLine: fn.endLine,
        purpose: fn.purpose,
        complexity: fn.complexity,
      })),
    })),
    status: rec.status,
    error: rec.error,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerRoutes(
  router: ConnectRouter,
  store: AnalysisStore,
  jobs: JobManager,
  repoCacheDir: string,
) {
  router.service(AnalysisService, {
    // Fire-and-forget: starts a job and returns an id.
    async analyze(req) {
      const gitUrl = (req.gitUrl || "").trim();
      const ref = (req.ref || "").trim();
      if (!gitUrl) throw new ConnectError("git_url is required", Code.InvalidArgument);

      const jobId = await jobs.start({ gitUrl, ref });
      return { id: jobId };
    },

    // Starts a job and streams progress until completion.
    async *analyzeStream(req) {
      const gitUrl = (req.gitUrl || "").trim();
      const ref = (req.ref || "").trim();
      if (!gitUrl) throw new ConnectError("git_url is required", Code.InvalidArgument);

      const { jobId, queue } = await jobs.startStream({ gitUrl, ref });

      // Initial event so the UI can display the id immediately.
      yield {
        id: jobId,
        phase: "START",
        progress: 0.0,
        message: "Started",
        agent: "engine",
        kind: "JOB_START",
        step: 0,
        stepTotal: 0,
      };

      for await (const ev of queue) {
        if (ev === null) break;
        yield {
          id: jobId,
          phase: ev.phase,
          progress: ev.progress,
          message: ev.message,
          agent: ev.agent ?? "",
          kind: ev.kind ?? "",
          step: ev.step ?? 0,
          stepTotal: ev.stepTotal ?? 0,
        };
      }
    },

    // Fetch a stored analysis result by id.
    async getAnalysis(req) {
      const analysisId = (req.id || "").trim();
      if (!analysisId) throw new ConnectError("id is required", Code.InvalidArgument);

      const rec = await store.get({ id: analysisId });
      if (!rec) throw new ConnectError("analysis not found", Code.NotFound);

      return mapAnalysisResponse(rec);
    },

    async getRepoAnalysis(req) {
      const gitUrl = (req.gitUrl || "").trim();
      const ref = (req.ref || "").trim();
      if (!gitUrl) throw new ConnectError("git_url is required", Code.InvalidArgument);

      const rec = await store.getLatestForRepo({ gitUrl, ref });
      if (!rec) throw new ConnectError("analysis not found", Code.NotFound);

      return mapAnalysisResponse(rec);
    },

    // Fetch annotated source code for a specific file.
    async getFileSource(req) {
      const analysisId = (req.analysisId || "").trim();
      const filePath = (req.filePath || "").trim();
      if (!analysisId) throw new ConnectError("analysis_id is required", Code.InvalidArgument);
      if (!filePath) throw new ConnectError("file_path is required", Code.InvalidArgument);

      // Security: reject path traversal attempts.
      if (filePath.includes("..") || filePath.startsWith("/") || filePath.startsWith("\\")) {
        throw new ConnectError("invalid file_path", Code.InvalidArgument);
      }

      const rec = await store.get({ id: analysisId });
      if (!rec) throw new ConnectError("analysis not found", Code.NotFound);

      // Compute repo cache key (mirrors git-ops safeRepoKey).
      const h = createHash("sha256");
      h.update(rec.gitUrl, "utf8");
      h.update("\0");
      h.update(rec.ref, "utf8");
      const repoDir = resolve(repoCacheDir, h.digest("hex").slice(0, 24));

      let fullPath = resolve(repoDir, filePath);
      if (!existsSync(fullPath)) {
        await cloneRepo({
          gitUrl: rec.gitUrl,
          ref: rec.ref,
          cacheDir: repoCacheDir,
        });
        fullPath = resolve(repoDir, filePath);
      }
      if (!existsSync(fullPath)) {
        throw new ConnectError(`file not found: ${filePath}`, Code.NotFound);
      }

      // Ensure the resolved path doesn't escape the repo dir.
      if (!fullPath.startsWith(resolve(repoDir))) {
        throw new ConnectError("invalid file_path", Code.InvalidArgument);
      }

      let source: string;
      try {
        source = readFileSync(fullPath, "utf8");
      } catch {
        throw new ConnectError("failed to read file", Code.Internal);
      }

      const totalLines = source.split("\n").length;
      const ext = extname(filePath).toLowerCase();
      const language = EXT_TO_LANG[ext] ?? "";

      // Collect function annotations for this file.
      const functions: Array<{
        name: string;
        signature: string;
        filePath: string;
        startLine: number;
        endLine: number;
        purpose: string;
        complexity: string;
      }> = [];

      if (rec.result) {
        for (const svc of rec.result.services) {
          for (const fn of svc.functions) {
            if (fn.filePath === filePath) {
              functions.push({
                name: fn.name,
                signature: fn.signature,
                filePath: fn.filePath,
                startLine: fn.startLine,
                endLine: fn.endLine,
                purpose: fn.purpose,
                complexity: fn.complexity,
              });
            }
          }
        }
      }

      return { filePath, language, source, functions, totalLines };
    },

    // List distinct repositories.
    async listRepos(req) {
      let limit = req.limit || 0;
      let offset = req.offset || 0;
      if (limit <= 0) limit = 25;
      limit = Math.min(Math.max(1, limit), 200);
      offset = Math.max(0, offset);

      const rows = await store.listRepos({ limit, offset });
      return {
        repos: rows.map((r) => ({
          gitUrl: r.gitUrl,
          ref: r.ref,
          lastAnalysisId: r.lastAnalysisId,
          lastStatus: r.lastStatus,
          lastUpdatedAt: r.lastUpdatedAt,
        })),
      };
    },

    // Delete all analyses for a specific repository and ref.
    async deleteRepo(req) {
      const gitUrl = (req.gitUrl || "").trim();
      const ref = (req.ref || "").trim();
      if (!gitUrl) throw new ConnectError("git_url is required", Code.InvalidArgument);

      const deletedCount = await store.deleteRepo({ gitUrl, ref });
      return { deletedCount };
    },
  });
}
