import { simpleGit } from "simple-git";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, existsSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { get as httpsGet } from "node:https";
import type { IncomingMessage } from "node:http";
import { extract as tarExtract } from "tar-stream";

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

function safeRepoKey(gitUrl: string, ref: string): string {
  const h = createHash("sha256");
  h.update(gitUrl, "utf8");
  h.update("\0");
  h.update(ref, "utf8");
  return h.digest("hex").slice(0, 24);
}

export function validateGitUrl(gitUrl: string): void {
  let u: URL;
  try {
    u = new URL(gitUrl);
  } catch {
    throw new GitError("Invalid git URL.");
  }
  if (u.protocol !== "https:") {
    throw new GitError("Only https:// git URLs are allowed (v1).");
  }
  if (!u.hostname) {
    throw new GitError("Invalid git URL.");
  }
}

// ---------------------------------------------------------------------------
// Git binary availability check (cached)
// ---------------------------------------------------------------------------

let _gitAvailable: boolean | null = null;

function isGitAvailable(): boolean {
  if (_gitAvailable === null) {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      _gitAvailable = true;
    } catch {
      _gitAvailable = false;
    }
  }
  return _gitAvailable;
}

// ---------------------------------------------------------------------------
// Archive-based clone fallback (no git binary required)
// Downloads a tarball from GitHub/GitLab's built-in archive endpoint.
// ---------------------------------------------------------------------------

function parseGitHubUrl(
  gitUrl: string,
): { owner: string; repo: string } | null {
  const m = gitUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

function parseGitLabUrl(gitUrl: string): { path: string } | null {
  const m = gitUrl.match(/gitlab\.com[/:](.+?)(?:\.git)?\/?$/);
  return m ? { path: m[1]! } : null;
}

function httpsFollow(
  url: string,
  maxRedirects = 5,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    httpsGet(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        httpsFollow(res.headers.location, maxRedirects - 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    }).on("error", reject);
  });
}

function buildArchiveUrl(gitUrl: string, ref: string): string {
  const gh = parseGitHubUrl(gitUrl);
  if (gh) {
    const r = ref || "HEAD";
    return `https://github.com/${gh.owner}/${gh.repo}/archive/${r}.tar.gz`;
  }

  const gl = parseGitLabUrl(gitUrl);
  if (gl) {
    const r = ref || "HEAD";
    return `https://gitlab.com/${gl.path}/-/archive/${r}/archive.tar.gz`;
  }

  throw new GitError(
    "Git binary is not available and archive download is only supported for GitHub and GitLab URLs.",
  );
}

async function cloneViaArchive(params: {
  gitUrl: string;
  ref: string;
  dest: string;
}): Promise<void> {
  const url = buildArchiveUrl(params.gitUrl, params.ref);
  mkdirSync(params.dest, { recursive: true });

  try {
    const res = await httpsFollow(url);

    // Pipe: HTTPS response → gunzip → tar extract (pure JS, no binaries)
    await new Promise<void>((resolve, reject) => {
      const extract = tarExtract();

      extract.on("entry", (header, stream, next) => {
        // Strip the first path component (e.g. "repo-main/src/..." → "src/...")
        const parts = header.name.split("/");
        const stripped = parts.slice(1).join("/");

        if (header.type === "directory" || !stripped) {
          stream.resume();
          next();
          return;
        }

        const outPath = join(params.dest, stripped);
        mkdirSync(dirname(outPath), { recursive: true });
        const ws = createWriteStream(outPath);
        stream.pipe(ws);
        ws.on("finish", next);
        ws.on("error", reject);
      });

      extract.on("finish", resolve);
      extract.on("error", reject);

      const gunzip = createGunzip();
      gunzip.on("error", reject);

      res.pipe(gunzip).pipe(extract);
    });
  } catch (e) {
    throw new GitError(
      `Archive download/extract failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main clone function
// ---------------------------------------------------------------------------

export async function cloneRepo(params: {
  gitUrl: string;
  ref: string;
  cacheDir: string;
}): Promise<string> {
  validateGitUrl(params.gitUrl);
  mkdirSync(params.cacheDir, { recursive: true });

  const key = safeRepoKey(params.gitUrl, params.ref);
  const dest = `${params.cacheDir}/${key}`;

  // Always re-clone into a fresh directory.
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }

  if (isGitAvailable()) {
    const git = simpleGit();

    try {
      await git.clone(params.gitUrl, dest, [
        "--depth",
        "1",
        "--no-tags",
      ]);
    } catch (e) {
      throw new GitError(
        `Clone failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (params.ref) {
      const repoGit = simpleGit(dest);
      try {
        await repoGit.fetch(["origin", params.ref, "--depth", "1"]);
        await repoGit.checkout("FETCH_HEAD");
      } catch (e) {
        throw new GitError(
          `Checkout ref "${params.ref}" failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } else {
    // Serverless environments (e.g. Vercel) without git — download archive
    await cloneViaArchive({ gitUrl: params.gitUrl, ref: params.ref, dest });
  }

  return dest;
}

export function repoKeyForRecord(gitUrl: string, ref: string): string {
  return safeRepoKey(gitUrl, ref);
}
