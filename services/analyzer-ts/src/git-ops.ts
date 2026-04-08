import { simpleGit } from "simple-git";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, existsSync } from "node:fs";

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

  return dest;
}

export function repoKeyForRecord(gitUrl: string, ref: string): string {
  return safeRepoKey(gitUrl, ref);
}
