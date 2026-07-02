import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedUser } from "@/lib/types";

const SESSION_COOKIE = "folder_to_github_session";
const OAUTH_STATE_COOKIE = "folder_to_github_oauth_state";
const DEFAULT_SESSION_TTL_HOURS = 48;
const DEFAULT_SUPABASE_SESSION_TABLE = "user_sessions";

type SessionPayload = {
  user: AuthenticatedUser;
  accessToken: string;
};

type StoredSession = {
  encryptedPayload: string;
  expiresAt: number;
};

type SessionStore = Map<string, StoredSession>;

type SupabaseSessionConfig = {
  restUrl: string;
  serviceKey: string;
  table: string;
};

type SupabaseSessionRow = {
  id: string;
  encrypted_payload: string;
  expires_at: string;
  updated_at?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __folderToGithubSessions: SessionStore | undefined;
  // eslint-disable-next-line no-var
  var __folderToGithubSessionSecret: string | undefined;
}

function sessionStore(): SessionStore {
  if (!globalThis.__folderToGithubSessions) {
    globalThis.__folderToGithubSessions = new Map();
  }
  return globalThis.__folderToGithubSessions;
}

export type ActiveSession = {
  id: string;
  user: AuthenticatedUser;
  accessToken: string;
};

export function newRandomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function createSession(accessToken: string, user: AuthenticatedUser): Promise<string> {
  const id = newRandomToken();
  const expiresAt = Date.now() + sessionTtlMs();
  const encryptedPayload = await encrypt(JSON.stringify({ user, accessToken } satisfies SessionPayload));

  const supabase = supabaseSessionConfig();
  if (supabase) {
    await writeSupabaseSession(supabase, id, encryptedPayload, expiresAt);
  } else {
    sessionStore().set(id, { encryptedPayload, expiresAt });
  }
  return id;
}

export function setSessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(sessionTtlMs() / 1000));
}

export async function clearSession(request: NextRequest, response: NextResponse): Promise<void> {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    const supabase = supabaseSessionConfig();
    if (supabase) {
      await deleteSupabaseSession(supabase, sessionId);
    } else {
      sessionStore().delete(sessionId);
    }
  }
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}

export function setOAuthStateCookie(response: NextResponse, state: string): void {
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions(10 * 60));
}

export function clearOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0));
}

export function validateOAuthState(request: NextRequest, receivedState: string | null): boolean {
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!expected || !receivedState || expected.length !== receivedState.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedState));
}

export async function readSession(request: NextRequest): Promise<ActiveSession | null> {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) {
    return null;
  }

  const supabase = supabaseSessionConfig();
  const stored = supabase ? await readSupabaseSession(supabase, sessionId) : sessionStore().get(sessionId);
  if (!stored) {
    return null;
  }

  if (stored.expiresAt <= Date.now()) {
    if (supabase) {
      await deleteSupabaseSession(supabase, sessionId);
    } else {
      sessionStore().delete(sessionId);
    }
    return null;
  }

  try {
    const payload = JSON.parse(await decrypt(stored.encryptedPayload)) as SessionPayload;
    return {
      id: sessionId,
      user: payload.user,
      accessToken: payload.accessToken
    };
  } catch {
    if (supabase) {
      await deleteSupabaseSession(supabase, sessionId);
    } else {
      sessionStore().delete(sessionId);
    }
    return null;
  }
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds
  };
}

async function encryptionKey(): Promise<Buffer> {
  return crypto.createHash("sha256").update(sessionSecret()).digest();
}

async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

async function decrypt(payload: string): Promise<string> {
  const [ivText, tagText, encryptedText] = payload.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("Invalid encrypted session payload");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS);
  const safeHours = Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : DEFAULT_SESSION_TTL_HOURS;
  return safeHours * 60 * 60 * 1000;
}

function sessionSecret(): string {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.SETTINGS_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("A server-side Supabase key is required for encrypted sessions.");
  }

  if (!globalThis.__folderToGithubSessionSecret) {
    globalThis.__folderToGithubSessionSecret = crypto.randomBytes(32).toString("base64url");
  }
  return globalThis.__folderToGithubSessionSecret;
}

function supabaseSessionConfig(): SupabaseSessionConfig | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  const table = process.env.SUPABASE_SESSION_TABLE || DEFAULT_SUPABASE_SESSION_TABLE;
  if (!isSafeIdentifier(table)) {
    throw new Error("SUPABASE_SESSION_TABLE must be a simple table name.");
  }

  return {
    restUrl: `${supabaseUrl.replace(/\/$/, "")}/rest/v1`,
    serviceKey,
    table
  };
}

async function readSupabaseSession(config: SupabaseSessionConfig, id: string): Promise<StoredSession | null> {
  const url = new URL(`${config.restUrl}/${config.table}`);
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("select", "id,encrypted_payload,expires_at");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(config),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as SupabaseSessionRow[] | { message?: string } | null;
  if (!response.ok) {
    throw new Error(supabaseErrorMessage(data, response.status));
  }

  if (!Array.isArray(data) || !data[0]) {
    return null;
  }

  return {
    encryptedPayload: data[0].encrypted_payload,
    expiresAt: new Date(data[0].expires_at).getTime()
  };
}

async function writeSupabaseSession(
  config: SupabaseSessionConfig,
  id: string,
  encryptedPayload: string,
  expiresAt: number
): Promise<void> {
  const url = new URL(`${config.restUrl}/${config.table}`);
  url.searchParams.set("on_conflict", "id");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(config),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      id,
      encrypted_payload: encryptedPayload,
      expires_at: new Date(expiresAt).toISOString(),
      updated_at: new Date().toISOString()
    } satisfies SupabaseSessionRow),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(supabaseErrorMessage(data, response.status));
  }
}

async function deleteSupabaseSession(config: SupabaseSessionConfig, id: string): Promise<void> {
  const url = new URL(`${config.restUrl}/${config.table}`);
  url.searchParams.set("id", `eq.${id}`);

  const response = await fetch(url, {
    method: "DELETE",
    headers: supabaseHeaders(config),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) {
    throw new Error(supabaseErrorMessage(data, response.status));
  }
}

function supabaseHeaders(config: SupabaseSessionConfig): HeadersInit {
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
  return `Supabase session store request failed with ${status}`;
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
