import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_TOTAL_UPLOAD_BYTES,
  evaluateFileDecision,
  validateCommitPath
} from "@/lib/security/pathRules";
import { scanTextForSecrets } from "@/lib/security/secretScan";
import type { CompareFilePayload, CreatePullRequestPayload, UploadFilePayload } from "@/lib/types";
import { optionalNumberEnv } from "@/lib/server/env";

export type ValidatedUpload = CreatePullRequestPayload & {
  totalBytes: number;
};

export type ValidatedCompareFiles = {
  repoFullName: string;
  baseBranch?: string;
  files: CompareFilePayload[];
  totalBytes: number;
};

export function validateUploadPayload(input: unknown): ValidatedUpload {
  if (!isRecord(input)) {
    throw new Error("Invalid JSON payload");
  }

  const repoFullName = readString(input, "repoFullName");
  const branchName = readString(input, "branchName");
  const commitMessage = readString(input, "commitMessage");
  const baseBranch = readOptionalString(input, "baseBranch");
  const files = input.files;

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFullName)) {
    throw new Error("Repository must be a personal repo full name like owner/name");
  }

  if (!isSafeBranchName(branchName)) {
    throw new Error("Branch name contains unsafe characters or unsupported Git syntax");
  }

  if (baseBranch && !isSafeBranchName(baseBranch)) {
    throw new Error("Base branch contains unsafe characters or unsupported Git syntax");
  }

  if (commitMessage.trim().length < 3 || commitMessage.length > 250) {
    throw new Error("Commit message must be between 3 and 250 characters");
  }

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files were provided for commit");
  }

  const maxFiles = optionalNumberEnv("MAX_FILES", DEFAULT_MAX_FILES);
  if (files.length > maxFiles) {
    throw new Error(`Too many files. Limit is ${maxFiles}`);
  }

  const maxFileSize = optionalNumberEnv("MAX_FILE_SIZE_BYTES", DEFAULT_MAX_FILE_SIZE_BYTES);
  const maxTotalBytes = optionalNumberEnv("MAX_TOTAL_UPLOAD_BYTES", DEFAULT_MAX_TOTAL_UPLOAD_BYTES);
  const seenPaths = new Set<string>();
  const sanitizedFiles: UploadFilePayload[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (!isRecord(file)) {
      throw new Error("Each file must be an object");
    }

    const path = readString(file, "path");
    const content = readFileContent(file, "content");
    const size = typeof file.size === "number" && file.size >= 0 ? file.size : new TextEncoder().encode(content).byteLength;
    const validation = validateCommitPath(path);
    if (!validation.ok) {
      throw new Error(`${path}: ${validation.reason}`);
    }

    if (seenPaths.has(validation.path)) {
      throw new Error(`${validation.path}: duplicate file path`);
    }
    seenPaths.add(validation.path);

    const actualBytes = new TextEncoder().encode(content).byteLength;
    const decision = evaluateFileDecision(validation.path, Math.max(size, actualBytes), maxFileSize);
    if (decision.action !== "commit") {
      throw new Error(`${validation.path}: ${decision.reason ?? "file is not allowed"}`);
    }

    const secretIssues = scanTextForSecrets(validation.path, content);
    if (secretIssues.length > 0) {
      const labels = secretIssues.map((issue) => issue.label).join(", ");
      throw new Error(`${validation.path}: possible secret detected (${labels})`);
    }

    totalBytes += actualBytes;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Upload is too large. Total limit is ${maxTotalBytes} bytes`);
    }

    sanitizedFiles.push({
      path: validation.path,
      content,
      size: actualBytes
    });
  }

  return {
    repoFullName,
    branchName: branchName.trim(),
    baseBranch: baseBranch?.trim(),
    commitMessage: commitMessage.trim(),
    draft: input.draft === true,
    files: sanitizedFiles,
    totalBytes
  };
}

export function validateCompareFilesPayload(input: unknown): ValidatedCompareFiles {
  if (!isRecord(input)) {
    throw new Error("Invalid JSON payload");
  }

  const repoFullName = readString(input, "repoFullName");
  const baseBranch = readOptionalString(input, "baseBranch");
  const files = input.files;

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFullName)) {
    throw new Error("Repository must be a personal repo full name like owner/name");
  }

  if (baseBranch && !isSafeBranchName(baseBranch)) {
    throw new Error("Base branch contains unsafe characters or unsupported Git syntax");
  }

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files were provided for comparison");
  }

  const maxFiles = optionalNumberEnv("MAX_FILES", DEFAULT_MAX_FILES);
  if (files.length > maxFiles) {
    throw new Error(`Too many files. Limit is ${maxFiles}`);
  }

  const maxFileSize = optionalNumberEnv("MAX_FILE_SIZE_BYTES", DEFAULT_MAX_FILE_SIZE_BYTES);
  const maxTotalBytes = optionalNumberEnv("MAX_TOTAL_UPLOAD_BYTES", DEFAULT_MAX_TOTAL_UPLOAD_BYTES);
  const seenPaths = new Set<string>();
  const sanitizedFiles: CompareFilePayload[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (!isRecord(file)) {
      throw new Error("Each file must be an object");
    }

    const path = readString(file, "path");
    const sha = readString(file, "sha").toLowerCase();
    const size = typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0 ? file.size : -1;
    const validation = validateCommitPath(path);

    if (!validation.ok) {
      throw new Error(`${path}: ${validation.reason}`);
    }

    if (size < 0) {
      throw new Error(`${validation.path}: invalid file size`);
    }

    if (!/^[a-f0-9]{40}$/.test(sha)) {
      throw new Error(`${validation.path}: invalid Git blob SHA`);
    }

    if (seenPaths.has(validation.path)) {
      throw new Error(`${validation.path}: duplicate file path`);
    }
    seenPaths.add(validation.path);

    const decision = evaluateFileDecision(validation.path, size, maxFileSize);
    if (decision.action !== "commit") {
      throw new Error(`${validation.path}: ${decision.reason ?? "file is not allowed"}`);
    }

    totalBytes += size;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Comparison is too large. Total limit is ${maxTotalBytes} bytes`);
    }

    sanitizedFiles.push({
      path: validation.path,
      sha,
      size
    });
  }

  return {
    repoFullName,
    baseBranch: baseBranch?.trim(),
    files: sanitizedFiles,
    totalBytes
  };
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value.trim();
}

function readFileContent(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Missing required field: ${key}`);
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid field: ${key}`);
  }
  return value.trim();
}

export function isSafeBranchName(branchName: string): boolean {
  const value = branchName.trim();
  if (value.length < 3 || value.length > 120) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
