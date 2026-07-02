import crypto from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".app-data");
const KEY_FILE = path.join(DATA_DIR, "settings.key");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.enc");
const DEFAULT_SETTINGS_STORAGE_KEY = "folder-to-github:settings";
const DEFAULT_SUPABASE_SETTINGS_TABLE = "app_settings";

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
  personalAccessTokenSource?: "saved" | "env";
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
  settingsStorage: "supabase" | "redis" | "filesystem";
  supabaseSettingsConfigured: boolean;
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
    hasSettingsEncryptionKey: settingsEncryptionConfigured(),
    serverTokenAuthAllowed: isEnabledEnv(process.env.ALLOW_SERVER_TOKEN_AUTH),
    githubConfigured: missing.length === 0,
    runtimeSettingsAllowed: runtimeSettingsAllowed(),
    settingsAdminRequired: runtimeSettingsAdminRequired(),
    settingsAdminConfigured: runtimeSettingsAdminConfigured(),
    hasSettingsAdminKey: hasSettingsAdminKey(),
    settingsStorage: settingsStorageKind(),
    supabaseSettingsConfigured: supabaseSettingsConfigured(),
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
  const personalAccessToken = stored.personalAccessToken || process.env.GITHUB_TOKEN;

  return {
    authMode,
    appUrl: stored.appUrl || process.env.NEXT_PUBLIC_APP_URL,
    githubClientId: stored.githubClientId || process.env.GITHUB_CLIENT_ID,
    githubClientSecret: stored.githubClientSecret || process.env.GITHUB_CLIENT_SECRET,
    personalAccessToken,
    personalAccessTokenSource: stored.personalAccessToken ? "saved" : personalAccessToken ? "env" : undefined,
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
  return process.env.NODE_ENV !== "production" || productionSettingsUnlocked() || isEnabledEnv(process.env.ALLOW_RUNTIME_SETTINGS);
}

export function runtimeSettingsAdminRequired(): boolean {
  return process.env.NODE_ENV === "production" && runtimeSettingsAllowed();
}

export function runtimeSettingsAdminConfigured(): boolean {
  return !runtimeSettingsAdminRequired() || hasSettingsAdminKey();
}

export function verifyRuntimeSettingsAdminKey(value: string | null): boolean {
  if (!runtimeSettingsAdminRequired()) {
    return true;
  }

  const expected = process.env.SETTINGS_ADMIN_KEY;
  const received = value?.trim();
  if (!expected || expected.length < 16 || !received) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const valueBytes = Buffer.from(received);
  return expectedBytes.length === valueBytes.length && crypto.timingSafeEqual(expectedBytes, valueBytes);
}

export function redisSettingsConfigured(): boolean {
  return Boolean(redisSettingsConfig());
}

export function supabaseSettingsConfigured(): boolean {
  return Boolean(supabaseSettingsConfig());
}

export function vercelBlobDetected(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_WEBHOOK_PUBLIC_KEY || process.env.BLOB_READ_WRITE_TOKEN);
}

export function blobReadWriteTokenConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function productionSettingsUnlocked(): boolean {
  return hasSettingsAdminKey();
}

function hasSettingsAdminKey(): boolean {
  return Boolean(process.env.SETTINGS_ADMIN_KEY && process.env.SETTINGS_ADMIN_KEY.length >= 16);
}

function settingsEncryptionConfigured(): boolean {
  return Boolean(process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ADMIN_KEY);
}

async function readStoredSettings(): Promise<StoredSettings> {
  const supabase = supabaseSettingsConfig();
  if (supabase) {
    const payload = await supabaseGet(supabase, settingsStorageKey());
    return payload ? JSON.parse(decrypt(payload)) as StoredSettings : {};
  }

  const redis = redisSettingsConfig();
  if (redis) {
    const payload = await redisGet(redis, settingsStorageKey());
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
  const supabase = supabaseSettingsConfig();
  if (supabase) {
    await supabaseSet(supabase, settingsStorageKey(), payload);
    return;
  }

  const redis = redisSettingsConfig();
  if (redis) {
    await redisSet(redis, settingsStorageKey(), payload);
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
    if (
      process.env.NODE_ENV === "production" &&
      settings.personalAccessTokenSource === "env" &&
      !isEnabledEnv(process.env.ALLOW_SERVER_TOKEN_AUTH)
    ) {
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
  const keyFromEnv = process.env.SETTINGS_ENCRYPTION_KEY || process.env.SETTINGS_ADMIN_KEY;
  if (keyFromEnv) {
    return crypto.createHash("sha256").update(keyFromEnv).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SETTINGS_ADMIN_KEY is required to encrypt saved settings in production.");
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

type SupabaseSettingsConfig = {
  restUrl: string;
  serviceKey: string;
  table: string;
};

type SupabaseSettingsRow = {
  id: string;
  encrypted_payload: string;
  updated_at?: string;
};

function settingsStorageKind(): PublicSettings["settingsStorage"] {
  if (supabaseSettingsConfigured()) {
    return "supabase";
  }
  if (redisSettingsConfigured()) {
    return "redis";
  }
  return "filesystem";
}

function supabaseSettingsConfig(): SupabaseSettingsConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const table = process.env.SUPABASE_SETTINGS_TABLE || DEFAULT_SUPABASE_SETTINGS_TABLE;
  if (!isSafeIdentifier(table)) {
    throw new Error("SUPABASE_SETTINGS_TABLE must be a simple table name.");
  }

  return {
    restUrl: `${supabaseUrl.replace(/\/$/, "")}/rest/v1`,
    serviceKey,
    table
  };
}

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

function settingsStorageKey(): string {
  return process.env.SETTINGS_STORAGE_KEY || process.env.SETTINGS_REDIS_KEY || DEFAULT_SETTINGS_STORAGE_KEY;
}

async function supabaseGet(config: SupabaseSettingsConfig, key: string): Promise<string | null> {
  const url = new URL(`${config.restUrl}/${config.table}`);
  url.searchParams.set("id", `eq.${key}`);
  url.searchParams.set("select", "id,encrypted_payload,updated_at");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(config),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as SupabaseSettingsRow[] | { message?: string } | null;

  if (!response.ok) {
    throw new Error(supabaseErrorMessage(data, response.status));
  }

  return Array.isArray(data) && data[0]?.encrypted_payload ? data[0].encrypted_payload : null;
}

async function supabaseSet(config: SupabaseSettingsConfig, key: string, value: string): Promise<void> {
  const url = new URL(`${config.restUrl}/${config.table}`);
  url.searchParams.set("on_conflict", "id");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(config),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      id: key,
      encrypted_payload: value,
      updated_at: new Date().toISOString()
    } satisfies SupabaseSettingsRow),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as { message?: string } | null;

  if (!response.ok) {
    throw new Error(supabaseErrorMessage(data, response.status));
  }
}

function supabaseHeaders(config: SupabaseSettingsConfig): HeadersInit {
  return {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    "Content-Type": "application/json"
  };
}

function supabaseErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
    return data.message;
  }
  return `Supabase settings store request failed with ${status}`;
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

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isEnabledEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}
