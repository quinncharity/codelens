import {
  FrameworkSchema,
  PatternSchema,
  InsightSchema,
  ServiceModuleSchema,
  type AnalysisResultData,
  type Framework,
  type Pattern,
  type Insight,
  type ServiceModule,
} from "../models.js";

function requireList(raw: unknown, field: string): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  throw new Error(`Non-array for ${field}: ${typeof raw}`);
}

export function parseAnalysisResult(input: {
  summary: unknown;
  frameworks: unknown;
  patterns: unknown;
  insights: unknown;
  services?: unknown;
}): AnalysisResultData {
  const frameworksRaw = requireList(input.frameworks, "frameworks");
  const patternsRaw = requireList(input.patterns, "patterns");
  const insightsRaw = requireList(input.insights, "insights");
  const servicesRaw = requireList(input.services, "services");

  const frameworks: Framework[] = [];
  for (const item of frameworksRaw) {
    try {
      const fw = FrameworkSchema.parse(item);
      if (fw.name.trim()) frameworks.push(fw);
    } catch { /* skip invalid */ }
  }

  const patterns: Pattern[] = [];
  for (const item of patternsRaw) {
    try {
      const pat = PatternSchema.parse(item);
      if (pat.name.trim()) patterns.push(pat);
    } catch { /* skip invalid */ }
  }

  const insights: Insight[] = [];
  for (const item of insightsRaw) {
    try {
      const ins = InsightSchema.parse(item);
      if (ins.title.trim() && ins.description.trim()) insights.push(ins);
    } catch { /* skip invalid */ }
  }

  const services: ServiceModule[] = [];
  for (const item of servicesRaw) {
    try {
      const svc = ServiceModuleSchema.parse(item);
      if (svc.name.trim()) services.push(svc);
    } catch { /* skip invalid */ }
  }

  frameworks.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  patterns.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  const summary = input.summary == null ? "" : String(input.summary).trim();

  return { summary, frameworks, patterns, insights, services };
}
