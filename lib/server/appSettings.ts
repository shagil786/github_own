import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".app-data");
const KEY_FILE = path.join(DATA_DIR, "settings.key");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.enc");

type StoredSettings = {
  authMode?: AuthMode;
  appUrl?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  personalAccessToken?: string;
  sessionSecret?: string;
  updatedAt?: string;
};

export type AuthMode = "token" | "oauth";

export type EffectiveGithubSettings = {
  authMode: AuthMode;
  appUrl?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  personalAccessToken?: string;
  sessionSecret?: string;
};

export type PublicSettings = {
  authMode: AuthMode;
  appUrl: string;
  githubClientId: string;
  hasGithubClientSecret: boolean;
  hasPersonalAccessToken: boolean;
  hasSessionSecret: boolean;
  githubConfigured: boolean;
  missing: string[];
  updatedAt?: string;
};

export type OAuthSettings = {
  appUrl?: string;
  githubClientId: string;
  githubClientSecret: string;
  sessionSecret: string;
};

type SaveSettingsInput = {
  authMode: AuthMode;
  appUrl: string;
  githubClientId?: string;
  githubClientSecret?: string;
  personalAccessToken?: string;
  sessionSecret?: string;
};

export async function readPublicSettings(): Promise<PublicSettings> {
  const stored = await readStoredSettings();
  const effective = await getEffectiveGithubSettings();
  const appUrl = effective.appUrl ?? "http://localhost:3000";
  const missing = missingFromEffective(effective);

  return {
    authMode: effective.authMode,
    appUrl,
    githubClientId: effective.githubClientId ?? "",
    hasGithubClientSecret: Boolean(effective.githubClientSecret),
    hasPersonalAccessToken: Boolean(effective.personalAccessToken),
    hasSessionSecret: Boolean(effective.sessionSecret),
    githubConfigured: missing.length === 0,
    missing,
    updatedAt: stored.updatedAt
  };
}

export async function saveGithubSettings(input: SaveSettingsInput): Promise<PublicSettings> {
  const existing = await readStoredSettings();
  const authMode = input.authMode === "oauth" ? "oauth" : "token";
  const next: StoredSettings = {
    authMode,
    appUrl: validateAppUrl(input.appUrl),
    githubClientId: input.githubClientId?.trim()
      ? validateClientId(input.githubClientId)
      : existing.githubClientId || process.env.GITHUB_CLIENT_ID,
    githubClientSecret: input.githubClientSecret?.trim() || existing.githubClientSecret || process.env.GITHUB_CLIENT_SECRET,
    personalAccessToken: input.personalAccessToken?.trim() || existing.personalAccessToken || process.env.GITHUB_TOKEN,
    sessionSecret: input.sessionSecret?.trim() || existing.sessionSecret || process.env.SESSION_SECRET,
    updatedAt: new Date().toISOString()
  };

  if (authMode === "token") {
    if (!next.personalAccessToken || !looksLikeGithubToken(next.personalAccessToken)) {
      throw new Error("A GitHub personal access token is required.");
    }
  } else {
    if (!next.githubClientId) {
      throw new Error("GitHub client ID is required.");
    }
    if (!next.githubClientSecret) {
      throw new Error("GitHub client secret is required.");
    }
    if (!next.sessionSecret || next.sessionSecret.length < 32) {
      throw new Error("Session secret must be at least 32 characters.");
    }
  }

  await writeStoredSettings(next);
  return readPublicSettings();
}

export async function getEffectiveGithubSettings(): Promise<EffectiveGithubSettings> {
  const stored = await readStoredSettings();
  const envHasOAuth = Boolean(process.env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_SECRET);
  const authMode = stored.authMode ?? (envHasOAuth && !process.env.GITHUB_TOKEN ? "oauth" : "token");

  return {
    authMode,
    appUrl: stored.appUrl || process.env.NEXT_PUBLIC_APP_URL,
    githubClientId: stored.githubClientId || process.env.GITHUB_CLIENT_ID,
    githubClientSecret: stored.githubClientSecret || process.env.GITHUB_CLIENT_SECRET,
    personalAccessToken: stored.personalAccessToken || process.env.GITHUB_TOKEN,
    sessionSecret: stored.sessionSecret || process.env.SESSION_SECRET
  };
}

export async function requireGithubAuthSettings(): Promise<Required<EffectiveGithubSettings>> {
  const settings = await getEffectiveGithubSettings();
  const missing = missingFromEffective(settings);
  if (missing.length > 0) {
    throw new Error(`GitHub settings are incomplete: ${missing.join(", ")}`);
  }

  return settings as Required<EffectiveGithubSettings>;
}

export async function requireOAuthSettings(): Promise<OAuthSettings> {
  const settings = await getEffectiveGithubSettings();
  const missing: string[] = [];
  if (!settings.githubClientId) {
    missing.push("GitHub client ID");
  }
  if (!settings.githubClientSecret) {
    missing.push("GitHub client secret");
  }
  if (!settings.sessionSecret) {
    missing.push("session secret");
  }
  if (missing.length > 0) {
    throw new Error(`GitHub OAuth settings are incomplete: ${missing.join(", ")}`);
  }

  return {
    appUrl: settings.appUrl,
    githubClientId: settings.githubClientId!,
    githubClientSecret: settings.githubClientSecret!,
    sessionSecret: settings.sessionSecret!
  };
}

export async function requireSessionSecret(): Promise<string> {
  const settings = await getEffectiveGithubSettings();
  if (!settings.sessionSecret) {
    throw new Error("Session secret is not configured.");
  }
  return settings.sessionSecret;
}

export async function missingGithubSettings(): Promise<string[]> {
  return missingFromEffective(await getEffectiveGithubSettings());
}

export function runtimeSettingsAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_RUNTIME_SETTINGS === "true";
}

async function readStoredSettings(): Promise<StoredSettings> {
  try {
    const payload = await readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(decrypt(payload)) as StoredSettings;
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }
    throw error;
  }
}

async function writeStoredSettings(settings: StoredSettings): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await writeFile(SETTINGS_FILE, encrypt(JSON.stringify(settings)), { mode: 0o600 });
}

function missingFromEffective(settings: EffectiveGithubSettings): string[] {
  const missing: string[] = [];
  if (settings.authMode === "token") {
    if (!settings.personalAccessToken) {
      missing.push("GitHub personal access token");
    }
    return missing;
  }

  if (!settings.githubClientId) {
    missing.push("GitHub client ID");
  }
  if (!settings.githubClientSecret) {
    missing.push("GitHub client secret");
  }
  if (!settings.sessionSecret) {
    missing.push("session secret");
  }
  return missing;
}

function validateAppUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Application URL must use http or https.");
  }
  return trimmed.replace(/\/$/, "");
}

function validateClientId(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.-]{8,120}$/.test(trimmed)) {
    throw new Error("GitHub client ID looks invalid.");
  }
  return trimmed;
}

function looksLikeGithubToken(value: string): boolean {
  return /^(?:gh[pousr]_|github_pat_|[a-f0-9]{40}$)/i.test(value.trim());
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSettingsKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(payload: string): string {
  const [ivText, tagText, encryptedText] = payload.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("Invalid encrypted settings payload.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getSettingsKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function getSettingsKey(): Buffer {
  const keyFromEnv = process.env.SETTINGS_ENCRYPTION_KEY;
  if (keyFromEnv) {
    return crypto.createHash("sha256").update(keyFromEnv).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SETTINGS_ENCRYPTION_KEY is required in production.");
  }

  return getOrCreateLocalSettingsKey();
}

function getOrCreateLocalSettingsKey(): Buffer {
  try {
    return Buffer.from(readFileSync(KEY_FILE, "utf8"), "base64url");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const key = crypto.randomBytes(32);
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(KEY_FILE, key.toString("base64url"), { mode: 0o600 });
    return key;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}