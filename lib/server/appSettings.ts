import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".app-data");
const KEY_FILE = path.join(DATA_DIR, "settings.key");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.enc");
const DEFAULT_REDIS_SETTINGS_KEY = "folder-to-github:settings";

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
  hasSettingsEncryptionKey: boolean;
  serverTokenAuthAllowed: boolean;
  githubConfigured: boolean;
  runtimeSettingsAllowed: boolean;
  settingsAdminRequired: boolean;
  settingsAdminConfigured: boolean;
  hasSettingsAdminKey: boolean;
  settingsStorage: "redis" | "filesystem";
  redisSettingsConfigured: boolean;
  vercelBlobDetected: boolean;
  blobReadWriteTokenConfigured: boolean;
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
    hasSettingsEncryptionKey: Boolean(process.env.SETTINGS_ENCRYPTION_KEY),
    serverTokenAuthAllowed: process.env.ALLOW_SERVER_TOKEN_AUTH === "true",
    githubConfigured: missing.length === 0,
    runtimeSettingsAllowed: runtimeSettingsAllowed(),
    settingsAdminRequired: runtimeSettingsAdminRequired(),
    settingsAdminConfigured: runtimeSettingsAdminConfigured(),
    hasSettingsAdminKey: Boolean(process.env.SETTINGS_ADMIN_KEY && process.env.SETTINGS_ADMIN_KEY.length >= 16),
    settingsStorage: redisSettingsConfigured() ? "redis" : "filesystem",
    redisSettingsConfigured: redisSettingsConfigured(),
    vercelBlobDetected: vercelBlobDetected(),
    blobReadWriteTokenConfigured: blobReadWriteTokenConfigured(),
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

export function runtimeSettingsAdminRequired(): boolean {
  return process.env.NODE_ENV === "production" && runtimeSettingsAllowed();
}

export function runtimeSettingsAdminConfigured(): boolean {
  return !runtimeSettingsAdminRequired() || Boolean(process.env.SETTINGS_ADMIN_KEY && process.env.SETTINGS_ADMIN_KEY.length >= 16);
}

export function verifyRuntimeSettingsAdminKey(value: string | null): boolean {
  if (!runtimeSettingsAdminRequired()) {
    return true;
  }

  const expected = process.env.SETTINGS_ADMIN_KEY;
  if (!expected || expected.length < 16 || !value) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const valueBytes = Buffer.from(value);
  return expectedBytes.length === valueBytes.length && crypto.timingSafeEqual(expectedBytes, valueBytes);
}

export function redisSettingsConfigured(): boolean {
  return Boolean(redisSettingsConfig());
}

export function vercelBlobDetected(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_WEBHOOK_PUBLIC_KEY || process.env.BLOB_READ_WRITE_TOKEN);
}

export function blobReadWriteTokenConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readStoredSettings(): Promise<StoredSettings> {
  const redis = redisSettingsConfig();
  if (redis) {
    const payload = await redisGet(redis, redisSettingsKey());
    return payload ? JSON.parse(decrypt(payload)) as StoredSettings : {};
  }

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
  const payload = encrypt(JSON.stringify(settings));
  const redis = redisSettingsConfig();
  if (redis) {
    await redisSet(redis, redisSettingsKey(), payload);
    return;
  }

  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await writeFile(SETTINGS_FILE, payload, { mode: 0o600 });
}

function missingFromEffective(settings: EffectiveGithubSettings): string[] {
  const missing: string[] = [];
  if (settings.authMode === "token") {
    if (!settings.personalAccessToken) {
      missing.push("GitHub personal access token");
    }
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_SERVER_TOKEN_AUTH !== "true") {
      missing.push("ALLOW_SERVER_TOKEN_AUTH=true");
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

type RedisSettingsConfig = {
  url: string;
  token: string;
};

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

function redisSettingsConfig(): RedisSettingsConfig | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }
  return {
    url: url.replace(/\/$/, ""),
    token
  };
}

function redisSettingsKey(): string {
  return process.env.SETTINGS_REDIS_KEY || DEFAULT_REDIS_SETTINGS_KEY;
}

async function redisGet(config: RedisSettingsConfig, key: string): Promise<string | null> {
  return redisCommand<string | null>(config, ["GET", key]);
}

async function redisSet(config: RedisSettingsConfig, key: string, value: string): Promise<void> {
  await redisCommand<string>(config, ["SET", key, value]);
}

async function redisCommand<T>(config: RedisSettingsConfig, command: unknown[]): Promise<T> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({})) as RedisResponse<T>;

  if (!response.ok || data.error) {
    throw new Error(data.error || `Redis settings store request failed with ${response.status}`);
  }

  return data.result as T;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
