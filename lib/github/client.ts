import crypto from "node:crypto";
import type {
  AuthenticatedUser,
  CompareFilePayload,
  CreatePullRequestResult,
  CreateRepositoryPayload,
  GitHubRepository,
  UploadFilePayload
} from "@/lib/types";

const GITHUB_API = "https://api.github.com";

type GitHubApiErrorResponse = {
  message?: string;
  documentation_url?: string;
};

export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GitHubApiError";
  }
}

type GitHubRepoResponse = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: {
    login: string;
    type?: string;
  };
  permissions?: {
    push?: boolean;
  };
};

type GitHubBranchResponse = {
  name: string;
  commit: {
    sha: string;
  };
  protected?: boolean;
};

type GitHubTreeResponse = {
  tree: Array<{
    path?: string;
    type?: string;
    sha?: string;
  }>;
  truncated?: boolean;
};

type GitHubUserResponse = {
  id: number;
  login: string;
  avatar_url: string;
};

type FileComparison<T extends { path: string; size: number }> = {
  changedFiles: T[];
  unchangedFiles: T[];
  changedFilesCount: number;
  unchangedFilesCount: number;
  changedBytes: number;
  unchangedBytes: number;
};

export type GitHubFileComparison = FileComparison<UploadFilePayload>;
export type GitHubFileReferenceComparison = FileComparison<CompareFilePayload>;

export async function githubRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<{ data: T; response: Response }> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers
    },
    cache: "no-store"
  });

  const text = await response.text();
  const data = safeParseJson(text);

  if (!response.ok) {
    const error = data as GitHubApiErrorResponse | null;
    throw new GitHubApiError(friendlyGitHubError(error?.message, response.status, path, init.method), response.status);
  }

  return { data: data as T, response };
}

function safeParseJson(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchAuthenticatedUser(token: string): Promise<AuthenticatedUser> {
  const { data } = await githubRequest<GitHubUserResponse>(token, "/user");
  return {
    id: data.id,
    login: data.login,
    avatarUrl: data.avatar_url
  };
}

export async function listPersonalRepositories(token: string, userLogin: string): Promise<GitHubRepository[]> {
  const repos = await githubPaginatedRequest<GitHubRepoResponse[]>(
    token,
    "/user/repos?affiliation=owner&sort=updated&per_page=100"
  );

  return repos
    .filter((repo) => repo.owner.login === userLogin && repo.owner.type !== "Organization")
    .filter((repo) => Boolean(repo.permissions?.push))
    .map(toRepository);
}

export async function listRepositoryBranches(
  token: string,
  userLogin: string,
  repoFullName: string
): Promise<Array<{ name: string; protected: boolean }>> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const branches = await githubPaginatedRequest<GitHubBranchResponse[]>(
    token,
    `/repos/${owner}/${repo}/branches?per_page=100`
  );

  return branches.map((branch) => ({
    name: branch.name,
    protected: Boolean(branch.protected)
  }));
}

export async function createPersonalRepository(
  token: string,
  userLogin: string,
  payload: CreateRepositoryPayload
): Promise<GitHubRepository> {
  const name = payload.name.trim();
  if (!isSafeRepositoryName(name)) {
    throw new GitHubApiError("Repository name can only use letters, numbers, dots, underscores, and hyphens", 400);
  }

  const description = payload.description?.trim().slice(0, 350) || undefined;
  await assertRepoNameAvailable(token, userLogin, name);
  const { data } = await githubRequest<GitHubRepoResponse>(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      private: payload.private,
      auto_init: payload.autoInit !== false
    })
  });

  if (data.owner.login !== userLogin || data.owner.type === "Organization") {
    throw new GitHubApiError("Only personal repositories owned by the signed-in user are allowed", 403);
  }

  return toRepository(data);
}

export async function initializeEmptyRepository(
  token: string,
  userLogin: string,
  repoFullName: string,
  branchName?: string
): Promise<{ branchName: string; commitSha: string }> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  const repoData = await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const existingBranches = await githubPaginatedRequest<GitHubBranchResponse[]>(
    token,
    `/repos/${owner}/${repo}/branches?per_page=1`
  );

  if (existingBranches.length > 0) {
    throw new GitHubApiError("This repository already has a branch. Refresh repository data and choose a base branch.", 409);
  }

  const initialBranch = branchName?.trim() || repoData.default_branch || "main";
  if (!isSafeBranchName(initialBranch)) {
    throw new GitHubApiError("Initial branch name contains unsupported Git syntax", 400);
  }

  const { data: tree } = await githubRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      tree: [
        {
          path: "README.md",
          mode: "100644",
          type: "blob",
          content: [
            `# ${repo}`,
            "",
            "Initialized by Folder to GitHub so project uploads can be proposed through pull requests."
          ].join("\n")
        }
      ]
    })
  });

  const { data: commit } = await githubRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Initialize repository",
      tree: tree.sha,
      parents: []
    })
  });

  await githubRequest(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${initialBranch}`,
      sha: commit.sha
    })
  });

  return {
    branchName: initialBranch,
    commitSha: commit.sha
  };
}

export async function createBranch(
  token: string,
  userLogin: string,
  repoFullName: string,
  branchName: string,
  baseBranch?: string
): Promise<{ owner: string; repo: string; branchName: string; baseBranch: string; baseSha: string; baseTreeSha: string }> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  const repoData = await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const resolvedBaseBranch = baseBranch?.trim() || repoData.default_branch;

  const { data: ref } = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(resolvedBaseBranch)}`
  );
  const baseSha = ref.object.sha;

  const { data: commit } = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${baseSha}`
  );

  const finalBranchName = await createUniqueBranchRef(token, owner, repo, branchName, baseSha);

  return {
    owner,
    repo,
    branchName: finalBranchName,
    baseBranch: resolvedBaseBranch,
    baseSha,
    baseTreeSha: commit.tree.sha
  };
}

export async function commitFilesToBranch(
  token: string,
  userLogin: string,
  repoFullName: string,
  branchName: string,
  commitMessage: string,
  files: UploadFilePayload[]
): Promise<{ owner: string; repo: string; commitSha: string; defaultBranch: string }> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  const repoData = await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const { baseSha, baseTreeSha } = await getBranchHead(token, owner, repo, branchName);

  const { data: tree } = await githubRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content
      }))
    })
  });

  const { data: commit } = await githubRequest<{ sha: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: tree.sha,
      parents: [baseSha]
    })
  });

  await githubRequest(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: "PATCH",
    body: JSON.stringify({
      sha: commit.sha,
      force: false
    })
  });

  return {
    owner,
    repo,
    commitSha: commit.sha,
    defaultBranch: repoData.default_branch
  };
}

export async function openPullRequest(
  token: string,
  userLogin: string,
  repoFullName: string,
  branchName: string,
  commitMessage: string,
  defaultBranch?: string,
  draft = false
): Promise<{ url: string; number: number }> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  const repoData = await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const base = defaultBranch ?? repoData.default_branch;
  const title = commitMessage.split("\n")[0]?.slice(0, 120) || "Upload project folder";

  const { data } = await githubRequest<{ html_url: string; number: number }>(
    token,
    `/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        head: branchName,
        base,
        draft,
        body: [
          "Created by Folder to GitHub.",
          "",
          "The tool ignored generated folders, local Git metadata, env files, keys, large files, and possible secrets before creating this branch."
        ].join("\n")
      })
    }
  );

  return {
    url: data.html_url,
    number: data.number
  };
}

export async function compareFilesWithBaseBranch(
  token: string,
  userLogin: string,
  repoFullName: string,
  baseBranch: string | undefined,
  files: UploadFilePayload[]
): Promise<GitHubFileComparison & { baseBranch: string }> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  const repoData = await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const resolvedBaseBranch = baseBranch?.trim() || repoData.default_branch;
  const { baseTreeSha } = await getBranchHead(token, owner, repo, resolvedBaseBranch);
  const comparison = await compareFilesWithTree(token, owner, repo, baseTreeSha, files);

  return {
    ...comparison,
    baseBranch: resolvedBaseBranch
  };
}

export async function compareFileReferencesWithBaseBranch(
  token: string,
  userLogin: string,
  repoFullName: string,
  baseBranch: string | undefined,
  files: CompareFilePayload[]
): Promise<GitHubFileReferenceComparison & { baseBranch: string }> {
  const { owner, repo } = splitPersonalRepo(repoFullName, userLogin);
  const repoData = await verifyWritablePersonalRepo(token, userLogin, owner, repo);
  const resolvedBaseBranch = baseBranch?.trim() || repoData.default_branch;
  const { baseTreeSha } = await getBranchHead(token, owner, repo, resolvedBaseBranch);
  const comparison = await compareFileReferencesWithTree(token, owner, repo, baseTreeSha, files);

  return {
    ...comparison,
    baseBranch: resolvedBaseBranch
  };
}

export async function createPullRequestFromFiles(
  token: string,
  userLogin: string,
  repoFullName: string,
  branchName: string,
  commitMessage: string,
  files: UploadFilePayload[],
  baseBranch?: string,
  draft = false
): Promise<CreatePullRequestResult> {
  const branch = await createBranch(token, userLogin, repoFullName, branchName, baseBranch);
  const comparison = await filterChangedFilesForBranch(token, branch.owner, branch.repo, branch.branchName, files);

  if (comparison.changedFiles.length === 0) {
    await deleteBranchRef(token, branch.owner, branch.repo, branch.branchName).catch(() => undefined);
    throw new GitHubApiError(
      `No changed files were found compared with ${branch.baseBranch}. Nothing needs to be uploaded.`,
      409
    );
  }

  const commit = await commitFilesToBranch(
    token,
    userLogin,
    repoFullName,
    branch.branchName,
    commitMessage,
    comparison.changedFiles
  );
  const pullRequest = await openPullRequest(
    token,
    userLogin,
    repoFullName,
    branch.branchName,
    commitMessage,
    branch.baseBranch,
    draft
  );

  return {
    branchName: branch.branchName,
    commitSha: commit.commitSha,
    pullRequestUrl: pullRequest.url,
    pullRequestNumber: pullRequest.number,
    uploadedFilesCount: comparison.changedFilesCount,
    unchangedFilesCount: comparison.unchangedFilesCount
  };
}

async function githubPaginatedRequest<T extends unknown[]>(
  token: string,
  initialPath: string
): Promise<T[number][]> {
  let path: string | null = initialPath;
  const items: T[number][] = [];

  while (path) {
    const { data, response } = await githubRequest<T>(token, path);
    items.push(...data);
    path = nextLinkPath(response.headers.get("link"));
  }

  return items;
}

async function verifyWritablePersonalRepo(
  token: string,
  userLogin: string,
  owner: string,
  repo: string
): Promise<GitHubRepoResponse> {
  if (owner !== userLogin) {
    throw new GitHubApiError("Only personal repositories owned by the signed-in user are allowed", 403);
  }

  const { data } = await githubRequest<GitHubRepoResponse>(token, `/repos/${owner}/${repo}`);
  if (data.owner.login !== userLogin || data.owner.type === "Organization") {
    throw new GitHubApiError("Only personal repositories owned by the signed-in user are allowed", 403);
  }

  if (!data.permissions?.push) {
    throw new GitHubApiError("The signed-in user does not have write permission for this repository", 403);
  }

  return data;
}

async function assertRepoNameAvailable(token: string, userLogin: string, name: string): Promise<void> {
  try {
    await githubRequest<GitHubRepoResponse>(token, `/repos/${userLogin}/${name}`);
    throw new GitHubApiError("A repository with this name already exists. Select it from the repo list instead.", 409);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}

async function createUniqueBranchRef(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  baseSha: string
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? branchName : `${branchName}-${attempt + 1}`;
    try {
      await githubRequest(token, `/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${candidate}`,
          sha: baseSha
        })
      });
      return candidate;
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) {
        continue;
      }
      throw error;
    }
  }

  throw new GitHubApiError("Unable to find an available branch name. Rename the branch and try again.", 409);
}

async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branchName: string
): Promise<{ baseSha: string; baseTreeSha: string }> {
  const { data: ref } = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`
  );
  const baseSha = ref.object.sha;
  const { data: commit } = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${baseSha}`
  );

  return {
    baseSha,
    baseTreeSha: commit.tree.sha
  };
}

async function filterChangedFilesForBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  files: UploadFilePayload[]
): Promise<GitHubFileComparison> {
  const { baseTreeSha } = await getBranchHead(token, owner, repo, branchName);
  return compareFilesWithTree(token, owner, repo, baseTreeSha, files);
}

async function compareFilesWithTree(
  token: string,
  owner: string,
  repo: string,
  baseTreeSha: string,
  files: UploadFilePayload[]
): Promise<GitHubFileComparison> {
  const existingBlobShas = await getExistingBlobShasForTree(token, owner, repo, baseTreeSha);
  return compareByGitBlobSha(files, existingBlobShas, (file) => calculateGitBlobSha(file.content));
}

async function compareFileReferencesWithTree(
  token: string,
  owner: string,
  repo: string,
  baseTreeSha: string,
  files: CompareFilePayload[]
): Promise<GitHubFileReferenceComparison> {
  const existingBlobShas = await getExistingBlobShasForTree(token, owner, repo, baseTreeSha);
  return compareByGitBlobSha(files, existingBlobShas, (file) => file.sha);
}

async function getExistingBlobShasForTree(
  token: string,
  owner: string,
  repo: string,
  baseTreeSha: string
): Promise<Map<string, string>> {
  const { data } = await githubRequest<GitHubTreeResponse>(
    token,
    `/repos/${owner}/${repo}/git/trees/${baseTreeSha}?recursive=1`
  );

  if (data.truncated) {
    throw new GitHubApiError("The repository tree is too large to compare safely. Try a smaller target repository.", 409);
  }

  const existingBlobShas = new Map<string, string>();
  for (const item of data.tree) {
    if (item.type === "blob" && item.path && item.sha) {
      existingBlobShas.set(item.path, item.sha);
    }
  }

  return existingBlobShas;
}

function compareByGitBlobSha<T extends { path: string; size: number }>(
  files: T[],
  existingBlobShas: Map<string, string>,
  getSha: (file: T) => string
): FileComparison<T> {
  const changedFiles: T[] = [];
  const unchangedFiles: T[] = [];

  for (const file of files) {
    if (existingBlobShas.get(file.path) === getSha(file)) {
      unchangedFiles.push(file);
    } else {
      changedFiles.push(file);
    }
  }

  return {
    changedFiles,
    unchangedFiles,
    changedFilesCount: changedFiles.length,
    unchangedFilesCount: unchangedFiles.length,
    changedBytes: changedFiles.reduce((total, file) => total + file.size, 0),
    unchangedBytes: unchangedFiles.reduce((total, file) => total + file.size, 0)
  };
}

async function deleteBranchRef(token: string, owner: string, repo: string, branchName: string): Promise<void> {
  await githubRequest(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: "DELETE"
  });
}

function splitPersonalRepo(repoFullName: string, userLogin: string): { owner: string; repo: string } {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo || owner !== userLogin) {
    throw new GitHubApiError("Only personal repositories owned by the signed-in user are allowed", 403);
  }
  return { owner, repo };
}

function isSafeRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && !name.startsWith(".") && !name.endsWith(".");
}

function isSafeBranchName(branchName: string): boolean {
  const value = branchName.trim();
  if (value.length < 1 || value.length > 120) {
    return false;
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    return false;
  }

  return !(
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith(".lock")
  );
}

function calculateGitBlobSha(content: string): string {
  const contentBuffer = Buffer.from(content, "utf8");
  const header = Buffer.from(`blob ${contentBuffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, contentBuffer])).digest("hex");
}

function toRepository(repo: GitHubRepoResponse): GitHubRepository {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    ownerLogin: repo.owner.login,
    canPush: Boolean(repo.permissions?.push)
  };
}

function friendlyGitHubError(
  message: string | undefined,
  status: number,
  path = "",
  method = "GET"
): string {
  const normalizedMessage = message?.toLowerCase() ?? "";
  if (status === 401) {
    return "GitHub authentication failed. Reconnect GitHub in Settings.";
  }
  if (status === 403) {
    return message?.includes("rate limit")
      ? "GitHub rate limit reached. Try again later."
      : "GitHub rejected the request. Check token permissions for this repository.";
  }
  if (status === 404) {
    if (path.includes("/git/ref/heads/")) {
      return "The selected base branch was not found. Refresh repository data and choose an existing branch.";
    }
    return "GitHub repository or branch was not found.";
  }
  if (status === 409) {
    if (normalizedMessage.includes("empty")) {
      return "This repository has no branch to start from yet. Create it with an initial README, or initialize the repo on GitHub, then refresh repositories.";
    }
    if (method === "PATCH" && path.includes("/git/refs/heads/")) {
      return "GitHub could not update the upload branch because it changed while committing. Refresh repository data and try again with a new branch name.";
    }
    return "GitHub reported a repository conflict. Refresh branches or choose a new branch name, then try again.";
  }
  if (status === 422) {
    return message ?? "GitHub could not process the request. Check for duplicate names or invalid fields.";
  }
  return message ?? "GitHub API request failed";
}

function nextLinkPath(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="next"'));
  if (!next) {
    return null;
  }

  const match = next.match(/<([^>]+)>/);
  if (!match) {
    return null;
  }

  const url = new URL(match[1]);
  return `${url.pathname}${url.search}`;
}