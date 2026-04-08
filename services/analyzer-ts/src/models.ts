import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_FRAMEWORK_CATEGORIES = new Set([
  "language", "web", "backend", "build", "testing", "infra",
  "database", "orm", "ai", "observability", "api", "tooling", "unknown",
]);

const ALLOWED_PATTERN_CATEGORIES = new Set([
  "architecture", "implementation", "quality", "ai_rule", "unknown",
]);

const ALLOWED_FILE_LAYERS = new Set([
  "presentation", "business", "data", "config", "test", "infra", "unknown",
]);

const ALLOWED_MODULE_TYPES = new Set([
  "service", "module", "package", "library",
]);

const ALLOWED_COMPLEXITIES = new Set([
  "simple", "moderate", "complex",
]);

// ---------------------------------------------------------------------------
// Helpers (DSPy artifact stripping)
// ---------------------------------------------------------------------------

const TRIPLE_QUOTE = /^"{3,}|"{3,}$/g;
const TRIPLE_BANG = /^!{2,}|!{2,}$/g;

function cleanStr(s: string): string {
  for (let i = 0; i < 5; i++) {
    const prev = s;
    s = s.replace(TRIPLE_QUOTE, "").trim();
    s = s.replace(TRIPLE_BANG, "").trim();
    if (s === prev) break;
  }
  return s;
}

function asStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return cleanStr(v);
  return cleanStr(String(v));
}

function clamp01(v: unknown): number {
  try {
    const x = Number(v);
    if (isNaN(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  } catch {
    return 0;
  }
}

function normalizeCategory(v: unknown, allowed: Set<string>, fallback: string): string {
  const cat = asStr(v).trim().toLowerCase();
  if (!cat || !allowed.has(cat)) return fallback;
  return cat;
}

function normalizeEvidencePaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const p = item.trim();
    if (!p) continue;
    if (p.startsWith("/") || p.startsWith("\\")) continue;
    if (p.includes("://")) continue;
    if (p.length >= 2 && p[1] === ":") continue;
    out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const FrameworkSchema = z.object({
  name: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  version: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  category: z.unknown().transform((v) => normalizeCategory(v, ALLOWED_FRAMEWORK_CATEGORIES, "unknown")).pipe(z.string()),
  confidence: z.unknown().transform((v) => clamp01(v)).pipe(z.number()),
}).passthrough().transform((v) => ({
  name: v.name,
  version: v.version,
  category: v.category,
  confidence: v.confidence,
}));

export const PatternSchema = z.object({
  name: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  category: z.unknown().transform((v) => normalizeCategory(v, ALLOWED_PATTERN_CATEGORIES, "unknown")).pipe(z.string()),
  description: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  evidence_paths: z.unknown().transform((v) => normalizeEvidencePaths(v)).pipe(z.array(z.string())),
  confidence: z.unknown().transform((v) => clamp01(v)).pipe(z.number()),
}).passthrough().transform((v) => ({
  name: v.name,
  category: v.category,
  description: v.description,
  evidencePaths: v.evidence_paths,
  confidence: v.confidence,
}));

export const InsightSchema = z.object({
  category: z.unknown().transform((v) => { const c = asStr(v).trim(); return c || "unknown"; }).pipe(z.string()),
  title: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  description: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
}).passthrough().transform((v) => ({
  category: v.category,
  title: v.title,
  description: v.description,
}));

export const FileDetailSchema = z.object({
  path: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  purpose: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  layer: z.unknown().transform((v) => normalizeCategory(v, ALLOWED_FILE_LAYERS, "unknown")).pipe(z.string()),
}).passthrough().transform((v) => ({
  path: v.path,
  purpose: v.purpose,
  layer: v.layer,
}));

export const FunctionDetailSchema = z.object({
  name: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  signature: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  file_path: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  start_line: z.unknown().transform((v) => { try { return Math.max(0, Number(v) | 0); } catch { return 0; } }).pipe(z.number()),
  end_line: z.unknown().transform((v) => { try { return Math.max(0, Number(v) | 0); } catch { return 0; } }).pipe(z.number()),
  purpose: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  complexity: z.unknown().transform((v) => { const c = asStr(v).trim().toLowerCase(); return ALLOWED_COMPLEXITIES.has(c) ? c : "moderate"; }).pipe(z.string()),
}).passthrough().transform((v) => ({
  name: v.name,
  signature: v.signature,
  filePath: v.file_path,
  startLine: v.start_line,
  endLine: v.end_line,
  purpose: v.purpose,
  complexity: v.complexity,
}));

export const ServiceModuleSchema = z.object({
  name: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  description: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  module_type: z.unknown().transform((v) => { const mt = asStr(v).trim().toLowerCase(); return ALLOWED_MODULE_TYPES.has(mt) ? mt : "module"; }).pipe(z.string()),
  entry_points: z.unknown().transform((v) => normalizeEvidencePaths(v)).pipe(z.array(z.string())),
  key_files: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((item) => { try { return FileDetailSchema.parse(item); } catch { return null; } }).filter(Boolean);
  }),
  depends_on: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((x) => asStr(x).trim()).filter(Boolean).slice(0, 20);
  }),
  functions: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((item) => { try { return FunctionDetailSchema.parse(item); } catch { return null; } }).filter(Boolean);
  }),
}).passthrough().transform((v) => ({
  name: v.name,
  description: v.description,
  moduleType: v.module_type,
  entryPoints: v.entry_points,
  keyFiles: v.key_files as FileDetail[],
  dependsOn: v.depends_on as string[],
  functions: v.functions as FunctionDetail[],
}));

export const AnalysisResultDataSchema = z.object({
  summary: z.unknown().transform((v) => asStr(v).trim()).pipe(z.string().default("")),
  frameworks: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((item) => { try { return FrameworkSchema.parse(item); } catch { return null; } }).filter(Boolean);
  }),
  patterns: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((item) => { try { return PatternSchema.parse(item); } catch { return null; } }).filter(Boolean);
  }),
  insights: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((item) => { try { return InsightSchema.parse(item); } catch { return null; } }).filter(Boolean);
  }),
  services: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return [];
    return v.map((item) => { try { return ServiceModuleSchema.parse(item); } catch { return null; } }).filter(Boolean);
  }),
}).passthrough().transform((v) => ({
  summary: v.summary as string,
  frameworks: v.frameworks as Framework[],
  patterns: v.patterns as Pattern[],
  insights: v.insights as Insight[],
  services: v.services as ServiceModule[],
}));

// ---------------------------------------------------------------------------
// TypeScript types (inferred from schemas)
// ---------------------------------------------------------------------------

export type Framework = {
  name: string;
  version: string;
  category: string;
  confidence: number;
};

export type Pattern = {
  name: string;
  category: string;
  description: string;
  evidencePaths: string[];
  confidence: number;
};

export type Insight = {
  category: string;
  title: string;
  description: string;
};

export type FileDetail = {
  path: string;
  purpose: string;
  layer: string;
};

export type FunctionDetail = {
  name: string;
  signature: string;
  filePath: string;
  startLine: number;
  endLine: number;
  purpose: string;
  complexity: string;
};

export type ServiceModule = {
  name: string;
  description: string;
  moduleType: string;
  entryPoints: string[];
  keyFiles: FileDetail[];
  dependsOn: string[];
  functions: FunctionDetail[];
};

export type AnalysisResultData = {
  summary: string;
  frameworks: Framework[];
  patterns: Pattern[];
  insights: Insight[];
  services: ServiceModule[];
};
