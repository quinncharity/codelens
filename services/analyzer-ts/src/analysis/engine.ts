import { generateText, tool } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { SUB_AGENTS, FUNCTIONS_AGENT, type SubAgentConfig } from "./agents.js";
import { listFiles, getFileContent, searchFiles, makeReadRepoFile } from "./tools.js";
import { buildRepoSnapshot, type RepoSnapshot } from "../repo-snapshot.js";
import { parseAnalysisResult } from "./parse.js";
import type { AnalysisResultData, FunctionDetail } from "../models.js";
import { FunctionDetailSchema } from "../models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmitFn = (
  phase: string,
  progress: number,
  message: string,
  opts?: {
    agent?: string;
    kind?: string;
    step?: number;
    stepTotal?: number;
  },
) => Promise<void>;

// ---------------------------------------------------------------------------
// LM provider factory
// ---------------------------------------------------------------------------

function createLM(modelSpec: string) {
  // modelSpec format: "provider/model" e.g. "groq/openai/gpt-oss-120b"
  const firstSlash = modelSpec.indexOf("/");
  if (firstSlash === -1) throw new Error(`Invalid model spec: ${modelSpec}`);
  const provider = modelSpec.slice(0, firstSlash).toLowerCase();
  const modelName = modelSpec.slice(firstSlash + 1);

  if (provider === "groq") {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq(modelName);
  }

  if (provider === "openrouter") {
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY || process.env.OR_API_KEY,
      headers: {
        "HTTP-Referer": process.env.OR_SITE_URL || "http://localhost",
        "X-Title": process.env.OR_APP_NAME || "CodeLens",
      },
    });
    return openrouter(modelName);
  }

  // Fallback: treat as OpenAI-compatible
  const compat = createOpenAICompatible({
    name: provider,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
  });
  return compat(modelName);
}

// ---------------------------------------------------------------------------
// Rate-limit retry wrapper
// ---------------------------------------------------------------------------

const MAX_RETRIES = 8;
const BACKOFF_BASE = 15;
const BACKOFF_FACTOR = 1.5;
const BACKOFF_CAP = 90;
const BUFFER = 2;

function parseRetryAfter(msg: string): number | null {
  const m = msg.match(/try again in (\d+(?:\.\d+)?)s/i);
  return m ? parseFloat(m[1]!) : null;
}

function isRateLimit(e: unknown): boolean {
  const msg = String(e);
  return msg.includes("429") || msg.toLowerCase().includes("rate_limit") || msg.toLowerCase().includes("rate limit");
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let backoff = BACKOFF_BASE;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt === MAX_RETRIES) throw e;
      const hint = parseRetryAfter(String(e));
      const wait = Math.min((hint ?? backoff) + BUFFER, BACKOFF_CAP);
      console.warn(`Rate-limited (attempt ${attempt}/${MAX_RETRIES}), sleeping ${wait.toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      backoff = Math.min(backoff * BACKOFF_FACTOR, BACKOFF_CAP);
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Helper: extract JSON from tool calls when the model uses a 'json' tool
// ---------------------------------------------------------------------------

function extractJsonFromToolCalls(result: { text: string; steps: Array<{ toolCalls: Array<{ toolName: string; args: unknown }> }> }): string {
  // If there's already text, prefer it
  if (result.text.trim()) return result.text;
  // Walk steps in reverse looking for a 'json' tool call
  for (let i = result.steps.length - 1; i >= 0; i--) {
    const step = result.steps[i]!;
    for (const tc of step.toolCalls) {
      if (tc.toolName === "json" && tc.args != null) {
        return typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args);
      }
    }
  }
  return result.text;
}

// ---------------------------------------------------------------------------
// Run a single sub-agent
// ---------------------------------------------------------------------------

async function runSubAgent(
  agentCfg: SubAgentConfig,
  snapshot: RepoSnapshot,
  readRepoFile: (path: string) => string,
  modelSpec: string,
  emit: EmitFn,
  step: number,
  total: number,
): Promise<Record<string, unknown>> {
  await emit("ANALYZE", 0, `Starting ${agentCfg.name}`, {
    agent: agentCfg.name, kind: "AGENT_START", step, stepTotal: total,
  });

  const model = createLM(modelSpec);

  const result = await withRetry(() =>
    generateText({
      model,
      system: agentCfg.systemPrompt,
      prompt: `Here is the repository snapshot:\n\n${JSON.stringify(snapshot)}\n\nAnalyze this repository and return your findings as a JSON object.`,
      maxTokens: agentCfg.maxTokens,
      temperature: parseFloat(process.env.CODELENS_DSPY_TEMPERATURE ?? "0"),
      tools: {
        list_files: tool({
          description: "List file paths in the snapshot, optionally filtered by glob pattern",
          parameters: z.object({ pattern: z.string().optional().describe("Optional glob pattern like '*.py'") }),
          execute: async ({ pattern }) => listFiles(snapshot, pattern),
        }),
        get_file_content: tool({
          description: "Get the content of a file from the snapshot",
          parameters: z.object({ path: z.string().describe("File path in the snapshot") }),
          execute: async ({ path }) => getFileContent(snapshot, path),
        }),
        search_files: tool({
          description: "Case-insensitive keyword search across snapshot contents",
          parameters: z.object({ keyword: z.string().describe("Search keyword") }),
          execute: async ({ keyword }) => searchFiles(snapshot, keyword),
        }),
        read_repo_file: tool({
          description: "Read any file from the cloned repository by repo-relative path (up to 50KB)",
          parameters: z.object({ path: z.string().describe("Repo-relative path") }),
          execute: async ({ path }) => readRepoFile(path),
        }),
        json: tool({
          description: "Return structured JSON output",
          parameters: z.object({}).passthrough(),
          execute: async (args) => JSON.stringify(args),
        }),
      },
      maxSteps: 15,
    }),
  );

  await emit("ANALYZE", 1.0, `${agentCfg.name} complete`, {
    agent: agentCfg.name, kind: "AGENT_END", step, stepTotal: total,
  });

  // Parse the text response as JSON (also check tool call args for 'json' tool)
  const text = extractJsonFromToolCalls(result);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (jsonMatch?.[1]) {
      return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
    }
    // Last resort: wrap as the expected field
    return { [agentCfg.outputField]: text };
  }
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export async function analyze(repoRoot: string, emit: EmitFn): Promise<AnalysisResultData> {
  await emit("INDEX", 0.10, "Initializing analysis engine", { agent: "engine", kind: "PHASE_START" });

  const modelSpec = process.env.CODELENS_DSPY_LM;
  if (!modelSpec) throw new Error("Missing CODELENS_DSPY_LM (e.g. groq/openai/gpt-oss-120b)");

  await emit("INDEX", 0.12, "Building repository snapshot", { agent: "engine", kind: "PHASE_START" });
  const snapshotMaxBytes = parseInt(process.env.CODELENS_RLM_SNAPSHOT_MAX_BYTES ?? "2000000", 10);
  const snapshot = buildRepoSnapshot(repoRoot, { maxBytes: snapshotMaxBytes });
  const snapshotJson = JSON.stringify(snapshot);
  await emit("INDEX", 0.25, `Snapshot built (${snapshotJson.length} bytes)`, { agent: "engine", kind: "PHASE_END" });

  const readRepoFile = makeReadRepoFile(repoRoot);

  await emit("ANALYZE", 0.28, "Running sub-agents", { agent: "engine", kind: "PHASE_START" });

  const total = SUB_AGENTS.length;
  const results: Record<string, unknown> = {};
  const failures: string[] = [];

  // Run sub-agents sequentially (avoids rate-limit cascades)
  for (let i = 0; i < SUB_AGENTS.length; i++) {
    const cfg = SUB_AGENTS[i]!;
    try {
      const out = await runSubAgent(cfg, snapshot, readRepoFile, modelSpec, emit, i + 1, total);
      results[cfg.outputField] = out[cfg.outputField] ?? out;
    } catch (e) {
      const errDetail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      failures.push(`${cfg.name}: ${errDetail}`);
      console.warn(`Sub-agent ${cfg.name} failed: ${errDetail}`);
      await emit("ANALYZE", 1.0, `${cfg.name} failed: ${errDetail}`, {
        agent: cfg.name, kind: "AGENT_ERROR", step: i + 1, stepTotal: total,
      });
    }
  }

  if (failures.length > 0) {
    throw new Error("One or more sub-agents failed: " + failures.join(" | "));
  }

  await emit("ANALYZE", 0.88, "Parsing results", { agent: "engine", kind: "PHASE_START" });

  let result = parseAnalysisResult({
    summary: results.summary,
    frameworks: results.frameworks,
    patterns: results.patterns,
    insights: results.insights,
    services: results.services,
  });

  // --- Second pass: Functions agent ---
  const keyFilePaths: string[] = [];
  for (const svc of result.services) {
    for (const kf of svc.keyFiles) {
      if (kf.path && !keyFilePaths.includes(kf.path)) keyFilePaths.push(kf.path);
    }
    for (const ep of svc.entryPoints) {
      if (ep && !keyFilePaths.includes(ep)) keyFilePaths.push(ep);
    }
  }

  if (keyFilePaths.length > 0) {
    await emit("ANALYZE", 0.90, "Extracting functions and generating subgoal labels", {
      agent: "functions", kind: "AGENT_START", step: total + 1, stepTotal: total + 1,
    });

    try {
      const fileListStr = keyFilePaths.slice(0, 40).map((p) => `- ${p}`).join("\n");
      const functionsQuery = `${FUNCTIONS_AGENT.systemPrompt}\n\nFILES TO ANALYZE:\n${fileListStr}\n`;

      const model = createLM(modelSpec);
      const fnResult = await withRetry(() =>
        generateText({
          model,
          system: functionsQuery,
          prompt: `Here is the repository snapshot:\n\n${JSON.stringify(snapshot)}\n\nExtract all functions from the listed files and return as JSON.`,
          maxTokens: FUNCTIONS_AGENT.maxTokens,
          temperature: 0,
          tools: {
            list_files: tool({
              description: "List file paths in the snapshot",
              parameters: z.object({ pattern: z.string().optional() }),
              execute: async ({ pattern }) => listFiles(snapshot, pattern),
            }),
            get_file_content: tool({
              description: "Get file content from snapshot",
              parameters: z.object({ path: z.string() }),
              execute: async ({ path }) => getFileContent(snapshot, path),
            }),
            search_files: tool({
              description: "Search snapshot contents",
              parameters: z.object({ keyword: z.string() }),
              execute: async ({ keyword }) => searchFiles(snapshot, keyword),
            }),
            read_repo_file: tool({
              description: "Read any file from the repo",
              parameters: z.object({ path: z.string() }),
              execute: async ({ path }) => readRepoFile(path),
            }),
            json: tool({
              description: "Return structured JSON output",
              parameters: z.object({}).passthrough(),
              execute: async (args) => JSON.stringify(args),
            }),
          },
          maxSteps: 20,
        }),
      );

      let rawFunctions: unknown[];
      const fnText = extractJsonFromToolCalls(fnResult);
      try {
        const parsed = JSON.parse(fnText) as Record<string, unknown>;
        rawFunctions = Array.isArray(parsed.functions) ? parsed.functions : [];
      } catch {
        const jsonMatch = fnText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        if (jsonMatch?.[1]) {
          const parsed = JSON.parse(jsonMatch[1]) as Record<string, unknown>;
          rawFunctions = Array.isArray(parsed.functions) ? parsed.functions : [];
        } else {
          rawFunctions = [];
        }
      }

      // Parse and validate
      const parsedFunctions: FunctionDetail[] = [];
      for (const item of rawFunctions) {
        try {
          const fd = FunctionDetailSchema.parse(item);
          if (fd.name.trim() && fd.filePath.trim()) parsedFunctions.push(fd);
        } catch { /* skip invalid */ }
      }

      // Attach functions to services by file_path
      const svcByPath: Record<string, number> = {};
      for (let idx = 0; idx < result.services.length; idx++) {
        const svc = result.services[idx]!;
        for (const kf of svc.keyFiles) svcByPath[kf.path] ??= idx;
        for (const ep of svc.entryPoints) svcByPath[ep] ??= idx;
      }

      const svcFunctions: Record<number, FunctionDetail[]> = {};
      for (const fd of parsedFunctions) {
        const svcIdx = svcByPath[fd.filePath];
        if (svcIdx != null) {
          (svcFunctions[svcIdx] ??= []).push(fd);
        }
      }

      const updatedServices = result.services.map((svc, idx) => {
        const fns = svcFunctions[idx];
        return fns ? { ...svc, functions: fns } : svc;
      });

      result = { ...result, services: updatedServices };

      await emit("ANALYZE", 1.0, "Functions extraction complete", {
        agent: "functions", kind: "AGENT_END", step: total + 1, stepTotal: total + 1,
      });
    } catch (e) {
      console.warn(`Functions agent failed (non-fatal): ${e}`);
      await emit("ANALYZE", 1.0, `Functions extraction failed: ${e}`, {
        agent: "functions", kind: "AGENT_ERROR", step: total + 1, stepTotal: total + 1,
      });
    }
  }

  await emit("ANALYZE", 0.92, "Analysis complete", { agent: "engine", kind: "PHASE_END" });
  return result;
}
