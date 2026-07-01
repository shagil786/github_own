import crypto from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { AuthenticatedUser } from "@/lib/types";
import { requireSessionSecret } from "@/lib/server/appSettings";

const SESSION_COOKIE = "folder_to_github_session";
const OAUTH_STATE_COOKIE = "folder_to_github_oauth_state";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

type StoredSession = {
  user: AuthenticatedUser;
  encryptedToken: string;
  expiresAt: number;
};

type SessionStore = Map<string, StoredSession>;

declare global {
  // eslint-disable-next-line no-var
  var __folderToGithubSessions: SessionStore | undefined;
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
  sessionStore().set(id, {
    user,
    encryptedToken: await encrypt(accessToken),
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return id;
}

export function setSessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(SESSION_TTL_MS / 1000));
}

export function clearSession(request: NextRequest, response: NextResponse): void {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    sessionStore().delete(sessionId);
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

  const stored = sessionStore().get(sessionId);
  if (!stored) {
    return null;
  }

  if (stored.expiresAt <= Date.now()) {
    sessionStore().delete(sessionId);
    return null;
  }

  try {
    return {
      id: sessionId,
      user: stored.user,
      accessToken: await decrypt(stored.encryptedToken)
    };
  } catch {
    sessionStore().delete(sessionId);
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
  return crypto.createHash("sha256").update(await requireSessionSecret()).digest();
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