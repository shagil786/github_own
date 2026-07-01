export const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 1000;

export type FileDecisionAction = "commit" | "ignored" | "skipped";

export type FileDecision = {
  action: FileDecisionAction;
  reason?: string;
};

const IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".app-data",
  ".codex",
  ".git",
  ".expo",
  ".firebase",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".netlify",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".venv",
  ".vercel",
  "out",
  "outputs",
  "target",
  "venv",
  "work"
]);

const IGNORED_FILENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "npm-debug.log",
  "yarn-error.log",
  "pnpm-debug.log"
]);

const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".der",
  ".keystore"
]);

const BINARY_OR_CACHE_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".bmp",
  ".br",
  ".class",
  ".db",
  ".dmg",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".rar",
  ".sqlite",
  ".tar",
  ".tgz",
  ".ttf",
  ".wasm",
  ".wav",
  ".webp",
  ".woff",
  ".woff2",
  ".zip"
]);

export function normalizeBrowserPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function stripTopLevelFolder(path: string): string {
  const normalized = normalizeBrowserPath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length > 1) {
    parts.shift();
  }
  return parts.join("/");
}

export function validateCommitPath(path: string): { ok: true; path: string } | { ok: false; reason: string } {
  const normalized = normalizeBrowserPath(path);
  if (!normalized) {
    return { ok: false, reason: "Empty file path" };
  }

  if (normalized.startsWith("/") || normalized.includes("\0")) {
    return { ok: false, reason: "Unsafe absolute or null-byte path" };
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return { ok: false, reason: "Unsafe path segment" };
  }

  return { ok: true, path: normalized };
}

export function evaluateFileDecision(path: string, size: number, maxFileSize = DEFAULT_MAX_FILE_SIZE_BYTES): FileDecision {
  const validation = validateCommitPath(path);
  if (!validation.ok) {
    return { action: "skipped", reason: validation.reason };
  }

  const normalized = validation.path;
  const segments = normalized.split("/");
  const filename = segments[segments.length - 1] ?? "";
  const lowerFilename = filename.toLowerCase();
  const extension = getLowerExtension(lowerFilename);

  const ignoredDirectory = segments.find((segment) => IGNORED_DIRECTORIES.has(segment.toLowerCase()));
  if (ignoredDirectory) {
    return { action: "ignored", reason: `Ignored generated or repository directory: ${ignoredDirectory}/` };
  }

  if (lowerFilename === ".env" || lowerFilename.startsWith(".env.")) {
    return { action: "ignored", reason: "Ignored environment file" };
  }

  if (IGNORED_FILENAMES.has(filename) || IGNORED_FILENAMES.has(lowerFilename)) {
    return { action: "ignored", reason: "Ignored OS or package-manager metadata file" };
  }

  if (SENSITIVE_EXTENSIONS.has(extension)) {
    return { action: "ignored", reason: `Ignored sensitive key/certificate file (${extension})` };
  }

  if (size === 0) {
    return { action: "skipped", reason: "Skipped empty file" };
  }

  if (size > maxFileSize) {
    return { action: "skipped", reason: `Skipped because it is larger than ${formatBytes(maxFileSize)}` };
  }

  if (BINARY_OR_CACHE_EXTENSIONS.has(extension)) {
    return { action: "skipped", reason: `Skipped likely binary/cache file (${extension})` };
  }

  return { action: "commit" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getLowerExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index > -1 ? filename.slice(index) : "";
}
