"use client";

import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  Github,
  GitPullRequest,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  UploadCloud
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Section } from "@/components/Section";
import { readJsonResponse } from "@/lib/client/apiFetch";
import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_TOTAL_UPLOAD_BYTES,
  evaluateFileDecision,
  formatBytes,
  normalizeBrowserPath,
  stripTopLevelFolder
} from "@/lib/security/pathRules";
import { type SecretIssue, scanTextForSecrets } from "@/lib/security/secretScan";
import type {
  AuthenticatedUser,
  CompareFileMetadata,
  CompareFilePayload,
  CompareFilesResult,
  CreatePullRequestResult,
  GitHubRepository,
  UploadFilePayload
} from "@/lib/types";

type AuthState =
  | { loading: true; authenticated: false; githubConfigured: false; user?: never }
  | { loading: false; authenticated: false; githubConfigured: boolean; user?: never }
  | {
      loading: false;
      authenticated: true;
      githubConfigured: boolean;
      authSource: "oauth" | "token";
      user: AuthenticatedUser;
    };

type ReviewStatus = "commit" | "ignored" | "skipped" | "blocked";
type FileFilter = "all" | ReviewStatus;
type RepoMode = "existing" | "new";

type ReviewedFile = {
  id: string;
  originalPath: string;
  path: string;
  size: number;
  status: ReviewStatus;
  reason?: string;
  issues?: SecretIssue[];
  content?: string;
};

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory?: string;
  directory?: string;
};

type WorkflowStep = {
  label: string;
  description: string;
  status: "complete" | "active" | "pending";
};

const defaultBranchName = "folder-upload/project";

export function FolderToGithubApp() {
  const [auth, setAuth] = useState<AuthState>({
    loading: true,
    authenticated: false,
    githubConfigured: false
  });
  const [repos, setRepos] = useState<GitHubRepository[]>([]);
  const [branches, setBranches] = useState<Array<{ name: string; protected: boolean }>>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [reviewedFiles, setReviewedFiles] = useState<ReviewedFile[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [repoMode, setRepoMode] = useState<RepoMode>("existing");
  const [baseBranch, setBaseBranch] = useState("");
  const [branchName, setBranchName] = useState(defaultBranchName);
  const [commitMessage, setCommitMessage] = useState("Upload project folder");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDescription, setNewRepoDescription] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [newRepoAutoInit, setNewRepoAutoInit] = useState(true);
  const [draftPr, setDraftPr] = useState(false);
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [fileSearch, setFileSearch] = useState("");
  const [fileDisplayLimit, setFileDisplayLimit] = useState(120);
  const [scanError, setScanError] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isComparingFiles, setIsComparingFiles] = useState(false);
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [isInitializingRepo, setIsInitializingRepo] = useState(false);
  const [apiError, setApiError] = useState("");
  const [authError, setAuthError] = useState("");
  const [repoMessage, setRepoMessage] = useState("");
  const [repoError, setRepoError] = useState("");
  const [remoteDiffError, setRemoteDiffError] = useState("");
  const [remoteDiff, setRemoteDiff] = useState<CompareFilesResult | null>(null);
  const [result, setResult] = useState<CreatePullRequestResult | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      setAuthError("GitHub sign-in could not be completed. Check Settings and try again.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    void refreshAuth();
  }, []);

  const filesToCommit = useMemo(
    () => reviewedFiles.filter((file) => file.status === "commit" && file.content !== undefined),
    [reviewedFiles]
  );
  const ignoredFiles = useMemo(() => reviewedFiles.filter((file) => file.status === "ignored"), [reviewedFiles]);
  const skippedFiles = useMemo(() => reviewedFiles.filter((file) => file.status === "skipped"), [reviewedFiles]);
  const blockedFiles = useMemo(() => reviewedFiles.filter((file) => file.status === "blocked"), [reviewedFiles]);
  const totalCommitBytes = useMemo(
    () => filesToCommit.reduce((total, file) => total + file.size, 0),
    [filesToCommit]
  );
  const filteredReviewFiles = useMemo(
    () =>
      reviewedFiles.filter((file) => {
        const matchesStatus = fileFilter === "all" || file.status === fileFilter;
        const search = fileSearch.trim().toLowerCase();
        const matchesSearch = !search || file.path.toLowerCase().includes(search) || file.originalPath.toLowerCase().includes(search);
        return matchesStatus && matchesSearch;
      }),
    [fileFilter, fileSearch, reviewedFiles]
  );
  const visibleReviewFiles = useMemo(
    () => filteredReviewFiles.slice(0, fileDisplayLimit),
    [fileDisplayLimit, filteredReviewFiles]
  );
  const selectedRepoData = repos.find((repo) => repo.fullName === selectedRepo);
  const deployBranchName = selectedRepo ? selectedRepoData?.defaultBranch || "main" : "";
  const vercelDeployUrl = selectedRepo && deployBranchName ? buildVercelDeployUrl(selectedRepo, deployBranchName) : "";
  const branchError = getBranchNameError(branchName);
  const commitMessageError = getCommitMessageError(commitMessage);
  const duplicateRepo = repos.find((repo) => repo.name.toLowerCase() === newRepoName.trim().toLowerCase());
  const compareDisabledReason = getCompareDisabledReason(
    auth.authenticated,
    isComparingFiles,
    filesToCommit.length,
    blockedFiles.length,
    selectedRepo,
    baseBranch
  );
  const baseCreatePrDisabledReason = getCreatePrDisabledReason(
    auth.authenticated,
    isCreatingPr,
    filesToCommit.length,
    blockedFiles.length,
    selectedRepo,
    baseBranch,
    branchError,
    commitMessageError
  );
  const createPrDisabledReason =
    baseCreatePrDisabledReason ??
    (remoteDiff?.changedFilesCount === 0
      ? `No changed files were found compared with ${remoteDiff.baseBranch}. Nothing needs to be uploaded.`
      : null);
  const filesPreviewValue = remoteDiff
    ? `${remoteDiff.changedFilesCount} changed, ${remoteDiff.unchangedFilesCount} unchanged skipped`
    : `${filesToCommit.length} approved locally, compare to narrow`;
  const createPrStatus = createPrDisabledReason ?? (remoteDiff
    ? `${remoteDiff.changedFilesCount} changed files, ${formatBytes(remoteDiff.changedBytes)}`
    : `${filesToCommit.length} approved local files, ${formatBytes(totalCommitBytes)}`);

  const workflowSteps = getWorkflowSteps({
    authenticated: auth.authenticated,
    reviewedCount: reviewedFiles.length,
    blockedCount: blockedFiles.length,
    filesToCommitCount: filesToCommit.length,
    selectedRepo,
    baseBranch,
    readyToCreate: !createPrDisabledReason
  });

  useEffect(() => {
    if (!auth.authenticated || !selectedRepo) {
      setBranches([]);
      setBaseBranch("");
      return;
    }

    void loadBranches(selectedRepo);
  }, [auth.authenticated, selectedRepo]);

  useEffect(() => {
    setRemoteDiff(null);
    setRemoteDiffError("");
  }, [baseBranch, reviewedFiles, selectedRepo]);

  async function refreshAuth() {
    setAuth({ loading: true, authenticated: false, githubConfigured: false });
    setAuthError("");
    try {
      const response = await fetch("/api/github/me", { cache: "no-store" });
      const data = await readJsonResponse<{
        authenticated: boolean;
        user?: AuthenticatedUser;
        authSource?: "oauth" | "token";
        githubConfigured?: boolean;
      }>(response, "Unable to check GitHub connection");

      if (data.authenticated && data.user) {
        setAuth({
          loading: false,
          authenticated: true,
          user: data.user,
          authSource: data.authSource ?? "oauth",
          githubConfigured: Boolean(data.githubConfigured)
        });
        await loadRepos();
        return;
      }

      setAuth({
        loading: false,
        authenticated: false,
        githubConfigured: Boolean(data.githubConfigured)
      });
      setRepos([]);
    } catch (error) {
      setAuth({ loading: false, authenticated: false, githubConfigured: false });
      setRepos([]);
      setAuthError(error instanceof Error ? error.message : "Unable to check GitHub connection.");
    }
  }

  async function loadRepos() {
    setReposLoading(true);
    setApiError("");
    try {
      const response = await fetch("/api/github/repos", { cache: "no-store" });
      const data = await readJsonResponse<{ repos?: GitHubRepository[] }>(response, "Unable to load repositories");
      const nextRepos = data.repos ?? [];
      setRepos(nextRepos);
      if (nextRepos.length === 0) {
        setSelectedRepo("");
        return;
      }
      if (!selectedRepo || !nextRepos.some((repo) => repo.fullName === selectedRepo)) {
        setSelectedRepo(nextRepos[0].fullName);
      }
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to load repositories");
    } finally {
      setReposLoading(false);
    }
  }

  async function loadBranches(repoFullName: string) {
    setBranchesLoading(true);
    setRepoError("");
    try {
      const response = await fetch(`/api/github/branches?repoFullName=${encodeURIComponent(repoFullName)}`, { cache: "no-store" });
      const data = await readJsonResponse<{ branches?: Array<{ name: string; protected: boolean }> }>(response, "Unable to load branches");
      const nextBranches = data.branches ?? [];
      setBranches(nextBranches);
      if (nextBranches.length === 0) {
        setBaseBranch("");
        setRepoError("This repository has no branches yet. Initialize it with a README on GitHub, or create a new repo with Add initial README enabled.");
        return;
      }
      const repoDefault = repos.find((repo) => repo.fullName === repoFullName)?.defaultBranch;
      const nextBase = repoDefault && nextBranches.some((branch) => branch.name === repoDefault)
        ? repoDefault
        : nextBranches[0].name;
      setBaseBranch((current) => (current && nextBranches.some((branch) => branch.name === current) ? current : nextBase));
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Unable to load branches");
      setBranches([]);
      setBaseBranch("");
    } finally {
      setBranchesLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuth({
      loading: false,
      authenticated: false,
      githubConfigured: auth.githubConfigured
    });
    setRepos([]);
    setSelectedRepo("");
  }

  async function handleFolderSelection(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    setResult(null);
    setApiError("");
    setScanError("");
    setRemoteDiff(null);
    setRemoteDiffError("");
    setFileFilter("all");
    setFileSearch("");
    setFileDisplayLimit(120);

    if (files.length === 0) {
      setReviewedFiles([]);
      return;
    }

    setIsScanning(true);

    try {
      const firstPath = normalizeBrowserPath(files[0].webkitRelativePath || files[0].name);
      const rootName = firstPath.split("/")[0] || "project";
      setBranchName(`folder-upload/${slugify(rootName)}-${timestampSlug()}`);
      setCommitMessage(`Upload ${rootName}`);
      setNewRepoName((current) => current || slugify(rootName));
      setNewRepoDescription((current) => current || `Imported from ${rootName}`);

      const nextFiles: ReviewedFile[] = [];
      let commitFileCount = 0;
      let commitTotalBytes = 0;

      for (const file of files) {
        const originalPath = normalizeBrowserPath(file.webkitRelativePath || file.name);
        const commitPath = stripTopLevelFolder(originalPath);
        const id = `${originalPath}:${file.size}`;
        const decision = evaluateFileDecision(commitPath, file.size, DEFAULT_MAX_FILE_SIZE_BYTES);

        if (decision.action !== "commit") {
          nextFiles.push({
            id,
            originalPath,
            path: commitPath,
            size: file.size,
            status: decision.action,
            reason: decision.reason
          });
          continue;
        }

        if (await looksBinary(file)) {
          nextFiles.push({
            id,
            originalPath,
            path: commitPath,
            size: file.size,
            status: "skipped",
            reason: "Skipped because the file appears to contain binary bytes"
          });
          continue;
        }

        const content = await file.text();
        const actualBytes = new TextEncoder().encode(content).byteLength;
        if (commitFileCount >= DEFAULT_MAX_FILES) {
          nextFiles.push({
            id,
            originalPath,
            path: commitPath,
            size: actualBytes,
            status: "skipped",
            reason: `Skipped because the upload is limited to ${DEFAULT_MAX_FILES} files`
          });
          continue;
        }

        if (commitTotalBytes + actualBytes > DEFAULT_MAX_TOTAL_UPLOAD_BYTES) {
          nextFiles.push({
            id,
            originalPath,
            path: commitPath,
            size: actualBytes,
            status: "skipped",
            reason: `Skipped because the upload would exceed ${formatBytes(DEFAULT_MAX_TOTAL_UPLOAD_BYTES)}`
          });
          continue;
        }

        const issues = scanTextForSecrets(commitPath, content);

        if (issues.length > 0) {
          nextFiles.push({
            id,
            originalPath,
            path: commitPath,
            size: actualBytes,
            status: "blocked",
            reason: issues.map((issue) => issue.label).join(", "),
            issues
          });
          continue;
        }

        commitFileCount += 1;
        commitTotalBytes += actualBytes;
        nextFiles.push({
          id,
          originalPath,
          path: commitPath,
          size: actualBytes,
          status: "commit",
          content
        });
      }

      setReviewedFiles(sortReviewedFiles(nextFiles));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Unable to scan the selected folder");
    } finally {
      setIsScanning(false);
    }
  }

  function buildApprovedFilePayloads(): UploadFilePayload[] {
    return filesToCommit.map((file) => ({
      path: file.path,
      content: file.content ?? "",
      size: file.size
    }));
  }

  async function buildCompareFilePayloads(): Promise<CompareFilePayload[]> {
    return Promise.all(
      filesToCommit.map(async (file) => ({
        path: file.path,
        sha: await calculateBrowserGitBlobSha(file.content ?? ""),
        size: file.size
      }))
    );
  }

  function buildPullRequestFilePayloads(): UploadFilePayload[] {
    const files = buildApprovedFilePayloads();
    if (!remoteDiff || remoteDiff.changedFilesCount === 0) {
      return files;
    }

    const changedPaths = new Set(remoteDiff.changedFiles.map((file) => file.path));
    return files.filter((file) => changedPaths.has(file.path));
  }

  async function compareWithGitHub() {
    setApiError("");
    setRemoteDiffError("");
    setRemoteDiff(null);

    if (compareDisabledReason) {
      setRemoteDiffError(compareDisabledReason);
      return;
    }

    setIsComparingFiles(true);
    try {
      const response = await fetch("/api/github/compare-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: selectedRepo,
          baseBranch,
          files: await buildCompareFilePayloads()
        })
      });

      const data = await readJsonResponse<CompareFilesResult>(response, "Unable to compare files with GitHub");
      setRemoteDiff(data);
    } catch (error) {
      setRemoteDiffError(error instanceof Error ? error.message : "Unable to compare files with GitHub");
    } finally {
      setIsComparingFiles(false);
    }
  }

  async function createPullRequest() {
    setApiError("");
    setResult(null);

    if (!selectedRepo) {
      setApiError("Choose a GitHub repository first.");
      return;
    }

    if (blockedFiles.length > 0) {
      setApiError("Resolve blocked secret scan results before creating a pull request.");
      return;
    }

    if (remoteDiff?.changedFilesCount === 0) {
      setApiError(`No changed files were found compared with ${remoteDiff.baseBranch}. Nothing needs to be uploaded.`);
      return;
    }

    setIsCreatingPr(true);
    try {
      const response = await fetch("/api/github/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: selectedRepo,
          baseBranch,
          branchName,
          commitMessage,
          draft: draftPr,
          files: buildPullRequestFilePayloads()
        })
      });

      const data = await readJsonResponse<CreatePullRequestResult>(response, "Unable to create pull request");

      setResult(data);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to create pull request");
    } finally {
      setIsCreatingPr(false);
    }
  }

  async function createRepository() {
    setRepoError("");
    setRepoMessage("");

    if (!auth.authenticated) {
      setRepoError("Connect GitHub before creating a repository.");
      return;
    }

    if (!isSafeRepositoryName(newRepoName)) {
      setRepoError("Use letters, numbers, dots, underscores, or hyphens. Do not start or end with a dot.");
      return;
    }
    if (duplicateRepo) {
      setSelectedRepo(duplicateRepo.fullName);
      setRepoMode("existing");
      setRepoMessage(`${duplicateRepo.fullName} already exists and is now selected.`);
      return;
    }

    setIsCreatingRepo(true);
    try {
      const response = await fetch("/api/github/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRepoName.trim(),
          description: newRepoDescription.trim(),
          private: newRepoPrivate,
          autoInit: newRepoAutoInit
        })
      });
      const data = await readJsonResponse<{ repo: GitHubRepository }>(response, "Unable to create repository");

      setRepos((currentRepos) => {
        const withoutDuplicate = currentRepos.filter((repo) => repo.id !== data.repo.id);
        return [data.repo, ...withoutDuplicate];
      });
      setSelectedRepo(data.repo.fullName);
      setRepoMode("existing");
      setRepoMessage(`Created and selected ${data.repo.fullName}.`);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Unable to create repository");
    } finally {
      setIsCreatingRepo(false);
    }
  }

  async function initializeRepository() {
    setRepoError("");
    setRepoMessage("");

    if (!selectedRepo) {
      setRepoError("Choose a GitHub repository first.");
      return;
    }

    setIsInitializingRepo(true);
    try {
      const initialBranch = selectedRepoData?.defaultBranch || "main";
      const response = await fetch("/api/github/initialize-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoFullName: selectedRepo,
          branchName: initialBranch
        })
      });
      const data = await readJsonResponse<{ branchName: string; commitSha: string }>(response, "Unable to initialize repository");

      setRepoMessage(`Initialized ${selectedRepo} with ${data.branchName}.`);
      setBaseBranch(data.branchName);
      await loadBranches(selectedRepo);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Unable to initialize repository");
    } finally {
      setIsInitializingRepo(false);
    }
  }

  function downloadScanReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      rootStatus: reviewedFiles.length ? "scanned" : "not-scanned",
      limits: {
        maxFiles: DEFAULT_MAX_FILES,
        maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        maxTotalUploadBytes: DEFAULT_MAX_TOTAL_UPLOAD_BYTES
      },
      summary: {
        total: reviewedFiles.length,
        commit: filesToCommit.length,
        ignored: ignoredFiles.length,
        skipped: skippedFiles.length,
        blocked: blockedFiles.length,
        commitBytes: totalCommitBytes
      },
      files: reviewedFiles.map(({ content: _content, ...file }) => ({
        path: file.path,
        originalPath: file.originalPath,
        size: file.size,
        status: file.status,
        reason: file.reason,
        issues: file.issues?.map((issue) => ({ id: issue.id, label: issue.label, reason: issue.reason }))
      }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `folder-to-github-scan-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  const directoryInputProps: DirectoryInputProps = {
    type: "file",
    webkitdirectory: "",
    directory: "",
    multiple: true,
    disabled: isScanning,
    onChange: (event) => void handleFolderSelection(event.currentTarget.files)
  };

  return (
    <main className="appShell">
      <div className="topBar">
        <div>
          <p className="eyebrow">Browser-only folder review, GitHub API commit</p>
          <h1>Folder to GitHub</h1>
        </div>
        <div className="topActions">
          <div className="statusPill">
            <ShieldCheck size={18} aria-hidden="true" />
            API-only upload
          </div>
          <Link className="secondaryButton" href="/settings">
            <SettingsIcon size={16} aria-hidden="true" />
            Settings
          </Link>
          {vercelDeployUrl ? (
            <a
              className="secondaryButton"
              href={vercelDeployUrl}
              target="_blank"
              rel="noreferrer"
              title={`Deploy ${selectedRepo} default branch ${deployBranchName} to Vercel`}
            >
              <ExternalLink size={16} aria-hidden="true" />
              Deploy {deployBranchName}
            </a>
          ) : (
            <button className="secondaryButton" type="button" disabled>
              <ExternalLink size={16} aria-hidden="true" />
              Deploy
            </button>
          )}
        </div>
      </div>

      <aside className="policyNotice">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>Only upload code you own or are authorized to upload.</span>
      </aside>

      <WorkflowStepper steps={workflowSteps} />

      <Section title="Sign in with GitHub" description="Tokens stay in encrypted server-side session storage.">
        {auth.loading ? (
          <div className="inlineState" role="status" aria-live="polite">
            <Loader2 className="spin" size={18} aria-hidden="true" />
            Checking session
          </div>
        ) : auth.authenticated ? (
          <div className="authRow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={auth.user.avatarUrl} alt="" className="avatar" />
            <div>
              <strong>{auth.user.login}</strong>
              <p>{auth.authSource === "token" ? "Connected with a saved server-side token." : "Signed in for personal repository access."}</p>
            </div>
            {auth.authSource === "oauth" ? (
              <button className="secondaryButton" type="button" onClick={handleLogout}>
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            ) : (
              <Link className="secondaryButton" href="/settings">
                <SettingsIcon size={16} aria-hidden="true" />
                Settings
              </Link>
            )}
          </div>
        ) : !auth.githubConfigured ? (
          <div className="authRow">
            <div>
              <strong>Connect GitHub to continue.</strong>
              <p>Set up the GitHub connection once, then return here to create pull requests.</p>
            </div>
            <Link className="primaryButton" href="/settings?setup=github">
              <SettingsIcon size={16} aria-hidden="true" />
              Set up GitHub
            </Link>
          </div>
        ) : (
          <a className="primaryButton" href="/api/auth/github/start">
            <Github size={18} aria-hidden="true" />
            Sign in with GitHub
          </a>
        )}
        {authError ? (
          <div className="inlineError" role="alert">
            <span>{authError}</span>
            <button className="secondaryButton compactButton" type="button" onClick={() => void refreshAuth()}>
              Retry
            </button>
          </div>
        ) : null}
      </Section>

      <Section
        title="Select folder"
        description="The browser preserves relative paths and the app removes the selected top-level folder name before committing."
        right={isScanning ? <span className="mutedText">Scanning...</span> : null}
      >
        <label className={isScanning ? "folderDrop folderDropBusy" : "folderDrop"} aria-busy={isScanning}>
          {isScanning ? <Loader2 className="spin" size={26} aria-hidden="true" /> : <FolderOpen size={26} aria-hidden="true" />}
          <span>{isScanning ? "Scanning folder" : "Choose a project folder"}</span>
          <small id="folder-picker-help">Generated files, local Git metadata, keys, env files, and large binaries are excluded.</small>
          <input {...directoryInputProps} aria-label="Select project folder" aria-describedby="folder-picker-help" />
        </label>
        {scanError ? <p className="errorText" role="alert">{scanError}</p> : null}
      </Section>

      {reviewedFiles.length ? (
        <div className="statsGrid" aria-label="Folder review summary">
          <Stat label="Approved local" value={filesToCommit.length} tone="good" />
          <Stat label="Ignored" value={ignoredFiles.length} tone="neutral" />
          <Stat label="Skipped" value={skippedFiles.length} tone="warn" />
          <Stat label="Blocked" value={blockedFiles.length} tone="bad" />
          <Stat label="Commit size" value={formatBytes(totalCommitBytes)} tone="neutral" />
        </div>
      ) : null}

      {reviewedFiles.length ? (
        <Section
          title="File review"
          description="Search, filter, and inspect the safe metadata for every reviewed file."
          right={
            <button className="secondaryButton compactButton" type="button" onClick={downloadScanReport}>
              <Download size={16} aria-hidden="true" />
              Download report
            </button>
          }
        >
          <div className="reviewToolbar">
            <label className="searchField">
              <Search size={16} aria-hidden="true" />
              <span className="srOnly">Search files</span>
              <input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder="Search paths" />
            </label>
            <div className="filterChips" aria-label="Filter files by status">
              {(["all", "commit", "ignored", "skipped", "blocked"] as FileFilter[]).map((filter) => (
                <button
                  key={filter}
                  className={fileFilter === filter ? "filterChip filterChipActive" : "filterChip"}
                  type="button"
                  onClick={() => {
                    setFileFilter(filter);
                    setFileDisplayLimit(120);
                  }}
                >
                  {filter === "all" ? "All" : statusLabel(filter)}
                </button>
              ))}
            </div>
          </div>
          <FileTree files={visibleReviewFiles} totalCount={filteredReviewFiles.length} />
          {filteredReviewFiles.length > visibleReviewFiles.length ? (
            <button className="secondaryButton loadMoreButton" type="button" onClick={() => setFileDisplayLimit((limit) => limit + 120)}>
              Show {Math.min(120, filteredReviewFiles.length - visibleReviewFiles.length)} more
            </button>
          ) : null}
        </Section>
      ) : null}

      {reviewedFiles.length ? (
        <>
          <Section title="Ignored and skipped files" description="These files are not uploaded to the backend.">
            <div className="twoColumn">
              <FileList title="Ignored files" files={ignoredFiles} empty="No ignored files." />
              <FileList title="Skipped files" files={skippedFiles} empty="No skipped files." />
            </div>
          </Section>

          <Section title="Secret scan results" description="Possible secrets block the commit and are never uploaded.">
            {blockedFiles.length === 0 ? (
              <div className="safeState">
                <CheckCircle2 size={18} aria-hidden="true" />
                No possible secrets detected in files selected for commit.
              </div>
            ) : (
              <FileList title="Blocked files" files={blockedFiles} empty="" />
            )}
          </Section>

          <Section title="Approved local files" description="These files passed local ignore rules and secret scanning. Use the GitHub comparison below to see which ones changed.">
            <FileList title="Approved files" files={filesToCommit} empty="No approved files." />
          </Section>
        </>
      ) : null}

      <Section title="Choose GitHub repo" description="Only writable personal repositories owned by the signed-in user are listed.">
        <div className="repoModeSelector" role="radiogroup" aria-label="Repository target mode">
          <button
            className={repoMode === "existing" ? "modeButton modeButtonActive" : "modeButton"}
            type="button"
            role="radio"
            aria-checked={repoMode === "existing"}
            onClick={() => setRepoMode("existing")}
          >
            Choose existing
          </button>
          <button
            className={repoMode === "new" ? "modeButton modeButtonActive" : "modeButton"}
            type="button"
            role="radio"
            aria-checked={repoMode === "new"}
            onClick={() => setRepoMode("new")}
          >
            Create new
          </button>
        </div>

        {repoMode === "existing" ? (
          <>
            <div className="formGrid">
              <label>
                Repository
                <select
                  value={selectedRepo}
                  onChange={(event) => setSelectedRepo(event.target.value)}
                  disabled={!auth.authenticated || reposLoading}
                  aria-busy={reposLoading}
                >
                  {reposLoading ? <option value="">Loading repositories...</option> : null}
                  {!reposLoading && repos.length === 0 ? <option value="">No repositories available</option> : null}
                  {repos.map((repo) => (
                    <option key={repo.id} value={repo.fullName}>
                      {repo.fullName} ({repo.private ? "private" : "public"})
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondaryButton formButton" type="button" onClick={loadRepos} disabled={!auth.authenticated || reposLoading}>
                {reposLoading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                {reposLoading ? "Loading repos" : "Refresh repos"}
              </button>
            </div>
            {!auth.authenticated ? <p className="mutedText">Sign in before choosing a repository.</p> : null}
            {auth.authenticated && repos.length === 0 && !reposLoading ? (
              <p className="mutedText">No writable personal repositories were returned for this account.</p>
            ) : null}
          </>
        ) : (
          <div className="repoCreator" aria-label="Create a new personal GitHub repository">
            <div className="repoCreatorHeader">
              <div>
                <strong>Create a new personal repo</strong>
                <p>GitHub creates it in your personal account, then this app selects it for the pull request.</p>
              </div>
              <label className="checkboxRow">
                <input
                  type="checkbox"
                  checked={newRepoPrivate}
                  onChange={(event) => setNewRepoPrivate(event.target.checked)}
                  disabled={!auth.authenticated || isCreatingRepo}
                />
                Private
              </label>
            </div>
            <div className="formGrid twoFieldGrid">
              <label>
                Repository name
                <input
                  value={newRepoName}
                  onChange={(event) => setNewRepoName(event.target.value)}
                  placeholder="my-new-project"
                  disabled={!auth.authenticated || isCreatingRepo}
                  aria-invalid={Boolean(newRepoName && (!isSafeRepositoryName(newRepoName) || duplicateRepo))}
                  aria-describedby="new-repo-help"
                />
              </label>
              <label>
                Description
                <input
                  value={newRepoDescription}
                  onChange={(event) => setNewRepoDescription(event.target.value)}
                  placeholder="Optional"
                  maxLength={350}
                  disabled={!auth.authenticated || isCreatingRepo}
                />
              </label>
            </div>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={newRepoAutoInit}
                onChange={(event) => setNewRepoAutoInit(event.target.checked)}
                disabled={!auth.authenticated || isCreatingRepo}
              />
              Add initial README
            </label>
            <div className="actionRow compactActionRow">
              <button
                className="secondaryButton"
                type="button"
                onClick={createRepository}
                disabled={!auth.authenticated || isCreatingRepo || !isSafeRepositoryName(newRepoName)}
              >
                {isCreatingRepo ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {isCreatingRepo ? "Creating repo" : "Create and select repo"}
              </button>
              <span className="mutedText" id="new-repo-help">
                {duplicateRepo
                  ? `${duplicateRepo.fullName} already exists. Creating will select it.`
                  : auth.authenticated
                    ? "Repository names must be unique in your personal account."
                    : "Connect GitHub first."}
              </span>
            </div>
            {repoMessage ? <div className="successInline" role="status" aria-live="polite">{repoMessage}</div> : null}
            {repoError ? <p className="errorText" role="alert">{repoError}</p> : null}
          </div>
        )}
      </Section>

      <Section title="Branch and commit" description="A new branch is created from the selected base branch, then a pull request is opened.">
        <div className="formGrid threeFieldGrid">
          <label>
            Base branch
            <select value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} disabled={!selectedRepo || branchesLoading}>
              {branchesLoading ? <option value="">Loading branches...</option> : null}
              {!branchesLoading && branches.length === 0 ? <option value="">No branches available</option> : null}
              {branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}{branch.protected ? " (protected)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Branch name
            <input value={branchName} onChange={(event) => setBranchName(event.target.value)} aria-invalid={Boolean(branchError)} />
            {branchError ? <span className="fieldError">{branchError}</span> : null}
          </label>
          <label>
            Commit message
            <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} aria-invalid={Boolean(commitMessageError)} />
            {commitMessageError ? <span className="fieldError">{commitMessageError}</span> : null}
          </label>
        </div>
        <label className="checkboxRow draftToggle">
          <input type="checkbox" checked={draftPr} onChange={(event) => setDraftPr(event.target.checked)} />
          Create as draft pull request
        </label>
        {repoError ? <div className="softNotice">{repoError}</div> : null}
        {auth.authenticated && selectedRepo && !branchesLoading && branches.length === 0 ? (
          <div className="actionRow compactActionRow">
            <button className="secondaryButton" type="button" onClick={initializeRepository} disabled={isInitializingRepo}>
              {isInitializingRepo ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
              {isInitializingRepo ? "Initializing repo" : "Initialize with README"}
            </button>
            <span className="mutedText">Creates the first commit only, then your project still uploads through a pull request.</span>
          </div>
        ) : null}
        {repoMessage ? <div className="successInline" role="status" aria-live="polite">{repoMessage}</div> : null}
      </Section>

      <Section title="Changed file check" description="Compare approved local files with the selected GitHub base branch before creating the pull request.">
        <div className="compareHeader">
          <div>
            <strong>Remote comparison</strong>
            <p>Compares the commit paths shown above against the selected base branch. Only paths, sizes, and Git blob hashes are sent.</p>
          </div>
          <button
            className="secondaryButton"
            type="button"
            onClick={compareWithGitHub}
            disabled={Boolean(compareDisabledReason)}
          >
            {isComparingFiles ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            {isComparingFiles ? "Comparing" : "Compare with GitHub"}
          </button>
        </div>

        {remoteDiffError ? <p className="errorText" role="alert">{remoteDiffError}</p> : null}

        {remoteDiff ? (
          <>
            {remoteDiff.changedFilesCount > 0 ? (
              <div className="safeState">
                <CheckCircle2 size={18} aria-hidden="true" />
                {remoteDiff.changedFilesCount} changed files will be committed. {remoteDiff.unchangedFilesCount} unchanged files will be skipped.
              </div>
            ) : (
              <div className="softNotice">
                No changed files were found compared with {remoteDiff.baseBranch}. Nothing needs to be uploaded.
              </div>
            )}
            {remoteDiff.changedFilesCount > 0 && remoteDiff.matchingPathsCount === 0 ? (
              <div className="softNotice">
                GitHub found no matching file paths on {remoteDiff.baseBranch}. These files are new on that branch. If this is a repeat upload,
                make sure the earlier pull request is merged into {remoteDiff.baseBranch}, or choose the branch that already contains the project files.
              </div>
            ) : null}
            <div className="statsGrid compactStats" aria-label="GitHub comparison summary">
              <Stat label="New" value={remoteDiff.newFilesCount} tone="good" />
              <Stat label="Modified" value={remoteDiff.modifiedFilesCount} tone="warn" />
              <Stat label="Unchanged" value={remoteDiff.unchangedFilesCount} tone="neutral" />
              <Stat label="Matched paths" value={remoteDiff.matchingPathsCount} tone="neutral" />
              <Stat label="Base branch" value={remoteDiff.baseBranch} tone="neutral" />
            </div>
            <div className="twoColumn compareLists">
              <MetadataFileList title="Changed files" files={remoteDiff.changedFiles} empty="No changed files." />
              <MetadataFileList title="Unchanged files" files={remoteDiff.unchangedFiles} empty="No unchanged files." />
            </div>
          </>
        ) : (
          <div className="softNotice">
            Run the comparison to see changed files before uploading contents. If you skip it, the final PR route still filters unchanged files on the server.
          </div>
        )}
      </Section>

      <Section title="Pull request preview" description="Review the GitHub side effect before creating anything.">
        <div className="previewGrid">
          <PreviewItem icon={<Github size={16} aria-hidden="true" />} label="Repository" value={selectedRepo || "Choose a repository"} />
          <PreviewItem icon={<GitBranch size={16} aria-hidden="true" />} label="Base branch" value={baseBranch || "Choose a base branch"} />
          <PreviewItem icon={<GitPullRequest size={16} aria-hidden="true" />} label="New branch" value={branchName || "Enter a branch"} />
          <PreviewItem icon={<FileText size={16} aria-hidden="true" />} label="Commit" value={commitMessage || "Enter a commit message"} />
          <PreviewItem label="Files" value={filesPreviewValue} />
          <PreviewItem label="Review" value={`${ignoredFiles.length} ignored, ${skippedFiles.length} skipped, ${blockedFiles.length} blocked`} />
          <PreviewItem label="Mode" value={draftPr ? "Draft pull request" : "Ready for review"} />
        </div>
        {vercelDeployUrl ? (
          <div className="actionRow compactActionRow">
            <a className="secondaryButton" href={vercelDeployUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden="true" />
              Deploy {deployBranchName} to Vercel
            </a>
            <span className="mutedText">Uses the selected repository default branch, usually main, not the temporary upload branch.</span>
          </div>
        ) : null}
        {createPrDisabledReason ? (
          <div className="softNotice">{createPrDisabledReason}</div>
        ) : (
          <div className="safeState">
            <CheckCircle2 size={18} aria-hidden="true" />
            Ready to create a pull request. Blocked, ignored, and skipped files will not be uploaded.
          </div>
        )}
      </Section>

      <div className="actionRow">
        <button
          className="primaryButton"
          type="button"
          onClick={createPullRequest}
          disabled={Boolean(createPrDisabledReason)}
          aria-describedby="create-pr-status"
        >
          {isCreatingPr ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <GitPullRequest size={18} aria-hidden="true" />}
          Create pull request
        </button>
        <span className="mutedText" id="create-pr-status">
          {createPrStatus}
        </span>
      </div>

      {apiError ? <div className="errorPanel" role="alert">{apiError}</div> : null}

      {result ? (
        <section className="successPanel" role="status" aria-live="polite">
          <div>
            <CheckCircle2 size={24} aria-hidden="true" />
          </div>
          <div>
            <h2>Pull request created</h2>
            <p>
              Branch <code>{result.branchName}</code> was created and committed as <code>{result.commitSha.slice(0, 8)}</code>.
              {typeof result.uploadedFilesCount === "number" ? (
                <>
                  {" "}Uploaded {result.uploadedFilesCount} changed files
                  {result.unchangedFilesCount ? ` and skipped ${result.unchangedFilesCount} unchanged files` : ""}.
                </>
              ) : null}
            </p>
            <a className="primaryButton" href={result.pullRequestUrl} target="_blank" rel="noreferrer">
              <UploadCloud size={18} aria-hidden="true" />
              Open PR #{result.pullRequestNumber}
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "good" | "neutral" | "warn" | "bad" }) {
  const effectiveTone = value === 0 || value === "0 B" ? "neutral" : tone;
  return (
    <div className={`stat stat-${effectiveTone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FileList({ title, files, empty }: { title: string; files: ReviewedFile[]; empty: string }) {
  return (
    <div className="fileList">
      <h3>{title}</h3>
      {files.length === 0 ? (
        <p className="mutedText">{empty}</p>
      ) : (
        <ul>
          {files.slice(0, 120).map((file) => (
            <li key={file.id}>
              <div>
                <strong>{file.path || file.originalPath}</strong>
                {file.reason ? <span>{file.reason}</span> : null}
                {file.issues?.length ? (
                  <span>{file.issues.map((issue) => issue.reason).join(" ")}</span>
                ) : null}
              </div>
              <small>{formatBytes(file.size)}</small>
            </li>
          ))}
        </ul>
      )}
      {files.length > 120 ? <p className="mutedText">Showing 120 of {files.length} files.</p> : null}
    </div>
  );
}

function MetadataFileList({ title, files, empty }: { title: string; files: CompareFileMetadata[]; empty: string }) {
  return (
    <div className="fileList">
      <h3>{title}</h3>
      {files.length === 0 ? (
        <p className="mutedText">{empty}</p>
      ) : (
        <ul>
          {files.slice(0, 120).map((file) => (
            <li key={file.path}>
              <div>
                <strong>{file.path}</strong>
                <span>{compareStatusLabel(file.status)}</span>
              </div>
              <small>{formatBytes(file.size)}</small>
            </li>
          ))}
        </ul>
      )}
      {files.length > 120 ? <p className="mutedText">Showing 120 of {files.length} files.</p> : null}
    </div>
  );
}

function compareStatusLabel(status: CompareFileMetadata["status"]): string {
  return {
    new: "New on the selected base branch",
    modified: "Path exists, content changed",
    unchanged: "Already identical on the selected base branch"
  }[status];
}

function WorkflowStepper({ steps }: { steps: WorkflowStep[] }) {
  return (
    <ol className="workflowStepper" aria-label="Upload workflow">
      {steps.map((step, index) => (
        <li key={step.label} className={`workflowStep workflowStep-${step.status}`}>
          <span className="workflowIndex">{index + 1}</span>
          <span>
            <strong>{step.label}</strong>
            <small>{step.description}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

function FileTree({ files, totalCount }: { files: ReviewedFile[]; totalCount: number }) {
  if (files.length === 0) {
    return <p className="mutedText">No files match the current filter.</p>;
  }

  const groups = groupFilesByFolder(files);
  return (
    <div className="fileTree" aria-label={`Showing ${files.length} of ${totalCount} reviewed files`}>
      {groups.map(([folder, folderFiles]) => (
        <section className="treeFolder" key={folder} aria-label={folder === "." ? "Root files" : `${folder} folder`}>
          <div className="treeFolderHeader">
            <FolderOpen size={16} aria-hidden="true" />
            <strong>{folder === "." ? "Root files" : folder}</strong>
            <span>{folderFiles.length}</span>
          </div>
          <ul>
            {folderFiles.map((file) => (
              <li className="treeFile" key={file.id}>
                <div>
                  <strong>{file.path || file.originalPath}</strong>
                  <ReasonBadges file={file} />
                  {file.issues?.length ? <small>{file.issues.map((issue) => issue.reason).join(" ")}</small> : null}
                </div>
                <div className="treeMeta">
                  <span className={`statusBadge statusBadge-${file.status}`}>{statusLabel(file.status)}</span>
                  <small>{formatBytes(file.size)}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ReasonBadges({ file }: { file: ReviewedFile }) {
  const labels = file.issues?.map((issue) => issue.label) ?? (file.reason ? [file.reason] : []);
  if (labels.length === 0) {
    return null;
  }

  return (
    <div className="reasonBadges" aria-label="Review reasons">
      {labels.slice(0, 4).map((label) => (
        <span className="reasonBadge" key={label}>{label}</span>
      ))}
    </div>
  );
}

function PreviewItem({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="previewItem">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

async function looksBinary(file: File): Promise<boolean> {
  const sample = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
  return sample.includes(0);
}

async function calculateBrowserGitBlobSha(content: string): Promise<string> {
  if (!crypto.subtle) {
    throw new Error("Your browser does not support secure file comparison. Create the pull request directly to let the server compare files.");
  }

  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);
  const headerBytes = encoder.encode(`blob ${contentBytes.byteLength}\0`);
  const payload = new Uint8Array(headerBytes.byteLength + contentBytes.byteLength);
  payload.set(headerBytes, 0);
  payload.set(contentBytes, headerBytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", payload);

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sortReviewedFiles(files: ReviewedFile[]): ReviewedFile[] {
  const rank: Record<ReviewStatus, number> = {
    blocked: 0,
    commit: 1,
    ignored: 2,
    skipped: 3
  };

  return [...files].sort((left, right) => rank[left.status] - rank[right.status] || left.path.localeCompare(right.path));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";
}

function buildVercelDeployUrl(repoFullName: string, branchName: string): string {
  const url = new URL("https://vercel.com/new/clone");
  const githubTreeUrl = `https://github.com/${repoFullName}/tree/${branchName}`;
  const repoName = repoFullName.split("/")[1] ?? "project";

  url.searchParams.set("repository-url", githubTreeUrl);
  url.searchParams.set("project-name", repoName);
  url.searchParams.set("repository-name", repoName);
  return url.toString();
}

function timestampSlug(): string {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

function isSafeRepositoryName(name: string): boolean {
  const trimmed = name.trim();
  return /^[A-Za-z0-9._-]{1,100}$/.test(trimmed) && !trimmed.startsWith(".") && !trimmed.endsWith(".");
}

function getCompareDisabledReason(
  authenticated: boolean,
  comparing: boolean,
  fileCount: number,
  blockedCount: number,
  repoFullName: string,
  baseBranch: string
): string | null {
  if (comparing) {
    return "Comparing files with GitHub...";
  }
  if (!authenticated) {
    return "Connect GitHub first.";
  }
  if (blockedCount > 0) {
    return "Resolve blocked secret scan results.";
  }
  if (fileCount === 0) {
    return "Select a folder with approved files.";
  }
  if (!repoFullName) {
    return "Choose a GitHub repository.";
  }
  if (!baseBranch) {
    return "Choose a base branch.";
  }
  return null;
}

function getCreatePrDisabledReason(
  authenticated: boolean,
  creating: boolean,
  fileCount: number,
  blockedCount: number,
  repoFullName: string,
  baseBranch: string,
  branchError: string | null,
  commitMessageError: string | null
): string | null {
  if (creating) {
    return "Creating pull request...";
  }
  if (!authenticated) {
    return "Connect GitHub first.";
  }
  if (blockedCount > 0) {
    return "Resolve blocked secret scan results.";
  }
  if (fileCount === 0) {
    return "Select a folder with files to commit.";
  }
  if (!repoFullName) {
    return "Choose a GitHub repository.";
  }
  if (!baseBranch) {
    return "Choose a base branch.";
  }
  if (branchError) {
    return branchError;
  }
  if (commitMessageError) {
    return commitMessageError;
  }
  return null;
}

function getBranchNameError(value: string): string | null {
  const branch = value.trim();
  if (branch.length < 3 || branch.length > 120) {
    return "Branch name must be between 3 and 120 characters.";
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
    return "Branch name can use letters, numbers, dots, underscores, hyphens, and slashes.";
  }
  if (
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.startsWith(".") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.endsWith(".lock")
  ) {
    return "Branch name uses unsupported Git syntax.";
  }
  return null;
}

function getCommitMessageError(value: string): string | null {
  const message = value.trim();
  if (message.length < 3) {
    return "Commit message must be at least 3 characters.";
  }
  if (message.length > 250) {
    return "Commit message must be 250 characters or less.";
  }
  return null;
}

function getWorkflowSteps({
  authenticated,
  reviewedCount,
  blockedCount,
  filesToCommitCount,
  selectedRepo,
  baseBranch,
  readyToCreate
}: {
  authenticated: boolean;
  reviewedCount: number;
  blockedCount: number;
  filesToCommitCount: number;
  selectedRepo: string;
  baseBranch: string;
  readyToCreate: boolean;
}): WorkflowStep[] {
  const scanPassed = reviewedCount > 0 && blockedCount === 0 && filesToCommitCount > 0;
  const targetSelected = Boolean(selectedRepo && baseBranch);

  return [
    {
      label: "Connect",
      description: authenticated ? "GitHub ready" : "Sign in first",
      status: authenticated ? "complete" : "active"
    },
    {
      label: "Select",
      description: reviewedCount ? `${reviewedCount} files reviewed` : "Choose a folder",
      status: reviewedCount ? "complete" : authenticated ? "active" : "pending"
    },
    {
      label: "Review",
      description: blockedCount ? `${blockedCount} blocked` : scanPassed ? "Scan passed" : "Check results",
      status: scanPassed ? "complete" : reviewedCount ? "active" : "pending"
    },
    {
      label: "Target",
      description: targetSelected ? "Repo and base set" : "Choose or create repo",
      status: targetSelected ? "complete" : scanPassed ? "active" : "pending"
    },
    {
      label: "Preview",
      description: readyToCreate ? "Ready" : "Confirm PR details",
      status: readyToCreate ? "complete" : targetSelected ? "active" : "pending"
    },
    {
      label: "Create",
      description: "Open PR",
      status: readyToCreate ? "active" : "pending"
    }
  ];
}

function statusLabel(status: ReviewStatus): string {
  return {
    commit: "Approved",
    ignored: "Ignored",
    skipped: "Skipped",
    blocked: "Blocked"
  }[status];
}

function groupFilesByFolder(files: ReviewedFile[]): Array<[string, ReviewedFile[]]> {
  const groups = new Map<string, ReviewedFile[]>();
  for (const file of files) {
    const folder = file.path.includes("/") ? file.path.split("/")[0] || "." : ".";
    const group = groups.get(folder) ?? [];
    group.push(file);
    groups.set(folder, group);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
