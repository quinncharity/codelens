import { del, get, list, put } from "@vercel/blob";
import type { AnalysisResultData } from "./models.js";
import type {
  AnalysisRecord,
  AnalysisStore,
  RepoSummaryRecord,
} from "./store.js";
import { repoKeyForRecord } from "./git-ops.js";

interface BlobAnalysisRecord {
  id: string;
  gitUrl: string;
  ref: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  result: AnalysisResultData | null;
  error: string;
}

interface BlobRepoIndex {
  gitUrl: string;
  ref: string;
  lastAnalysisId: string;
  lastStatus: string;
  lastUpdatedAt: string;
  analysisIds: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function toAnalysisRecord(record: BlobAnalysisRecord | null): AnalysisRecord | null {
  if (!record) return null;
  return {
    id: record.id,
    gitUrl: record.gitUrl,
    ref: record.ref,
    status: record.status,
    result: record.result,
    error: record.error,
  };
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const res = await get(pathname, { access: "private", useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const text = await new Response(res.stream).text();
  return JSON.parse(text) as T;
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export class BlobAnalysisStore implements AnalysisStore {
  constructor(private prefix = "codelens/v1") {}

  init(): void {}

  private analysisPath(id: string): string {
    return `${this.prefix}/analyses/by-id/${id}.json`;
  }

  private repoPath(gitUrl: string, ref: string): string {
    return `${this.prefix}/repos/by-key/${repoKeyForRecord(gitUrl, ref)}.json`;
  }

  private async getBlobRecord(id: string): Promise<BlobAnalysisRecord | null> {
    return readJson<BlobAnalysisRecord>(this.analysisPath(id));
  }

  private async getRepoIndex(gitUrl: string, ref: string): Promise<BlobRepoIndex | null> {
    return readJson<BlobRepoIndex>(this.repoPath(gitUrl, ref));
  }

  private async putRepoIndex(index: BlobRepoIndex): Promise<void> {
    await writeJson(this.repoPath(index.gitUrl, index.ref), index);
  }

  async create(params: { id: string; gitUrl: string; ref: string }): Promise<void> {
    const now = nowIso();
    const record: BlobAnalysisRecord = {
      id: params.id,
      gitUrl: params.gitUrl,
      ref: params.ref,
      status: "RUNNING",
      createdAt: now,
      updatedAt: now,
      result: null,
      error: "",
    };
    await writeJson(this.analysisPath(params.id), record);

    const current = await this.getRepoIndex(params.gitUrl, params.ref);
    const analysisIds = Array.from(
      new Set([...(current?.analysisIds ?? []), params.id]),
    );
    await this.putRepoIndex({
      gitUrl: params.gitUrl,
      ref: params.ref,
      lastAnalysisId: params.id,
      lastStatus: "RUNNING",
      lastUpdatedAt: now,
      analysisIds,
    });
  }

  async setSucceeded(params: { id: string; result: AnalysisResultData }): Promise<void> {
    const current = await this.getBlobRecord(params.id);
    if (!current) return;

    const updated: BlobAnalysisRecord = {
      ...current,
      status: "SUCCEEDED",
      updatedAt: nowIso(),
      result: params.result,
      error: "",
    };
    await writeJson(this.analysisPath(params.id), updated);

    const repoIndex = await this.getRepoIndex(updated.gitUrl, updated.ref);
    await this.putRepoIndex({
      gitUrl: updated.gitUrl,
      ref: updated.ref,
      lastAnalysisId: updated.id,
      lastStatus: updated.status,
      lastUpdatedAt: updated.updatedAt,
      analysisIds: Array.from(
        new Set([...(repoIndex?.analysisIds ?? []), updated.id]),
      ),
    });
  }

  async setFailed(params: { id: string; error: string }): Promise<void> {
    const current = await this.getBlobRecord(params.id);
    if (!current) return;

    const updated: BlobAnalysisRecord = {
      ...current,
      status: "FAILED",
      updatedAt: nowIso(),
      error: params.error,
    };
    await writeJson(this.analysisPath(params.id), updated);

    const repoIndex = await this.getRepoIndex(updated.gitUrl, updated.ref);
    await this.putRepoIndex({
      gitUrl: updated.gitUrl,
      ref: updated.ref,
      lastAnalysisId: updated.id,
      lastStatus: updated.status,
      lastUpdatedAt: updated.updatedAt,
      analysisIds: Array.from(
        new Set([...(repoIndex?.analysisIds ?? []), updated.id]),
      ),
    });
  }

  async get(params: { id: string }): Promise<AnalysisRecord | null> {
    return toAnalysisRecord(await this.getBlobRecord(params.id));
  }

  async getLatestForRepo(params: {
    gitUrl: string;
    ref: string;
  }): Promise<AnalysisRecord | null> {
    const index = await this.getRepoIndex(params.gitUrl, params.ref);
    if (!index?.lastAnalysisId) return null;
    return this.get({ id: index.lastAnalysisId });
  }

  async listRepos(params: {
    limit: number;
    offset: number;
  }): Promise<RepoSummaryRecord[]> {
    const blobs: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await list({
        prefix: `${this.prefix}/repos/by-key/`,
        cursor,
        limit: 1000,
      });
      blobs.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    const repos = (await Promise.all(
      blobs.map((pathname) => readJson<BlobRepoIndex>(pathname)),
    ))
      .filter((repo): repo is BlobRepoIndex => repo !== null)
      .sort((a, b) => {
        const aTs = Date.parse(a.lastUpdatedAt) || 0;
        const bTs = Date.parse(b.lastUpdatedAt) || 0;
        if (bTs !== aTs) return bTs - aTs;
        if (a.gitUrl !== b.gitUrl) return a.gitUrl.localeCompare(b.gitUrl);
        return a.ref.localeCompare(b.ref);
      })
      .slice(params.offset, params.offset + params.limit)
      .map((repo) => ({
        gitUrl: repo.gitUrl,
        ref: repo.ref,
        lastAnalysisId: repo.lastAnalysisId,
        lastStatus: repo.lastStatus,
        lastUpdatedAt: repo.lastUpdatedAt,
      }));

    return repos;
  }

  async deleteRepo(params: { gitUrl: string; ref: string }): Promise<number> {
    const index = await this.getRepoIndex(params.gitUrl, params.ref);
    if (!index) return 0;

    const paths = [
      this.repoPath(params.gitUrl, params.ref),
      ...index.analysisIds.map((id) => this.analysisPath(id)),
    ];
    await del(paths);
    return index.analysisIds.length;
  }
}
