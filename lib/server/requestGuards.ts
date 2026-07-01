import { NextRequest, NextResponse } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __folderToGithubRateLimits: Map<string, RateLimitEntry> | undefined;
}

function rateLimitStore(): Map<string, RateLimitEntry> {
  if (!globalThis.__folderToGithubRateLimits) {
    globalThis.__folderToGithubRateLimits = new Map();
  }
  return globalThis.__folderToGithubRateLimits;
}

export function guardPostRequest(
  request: NextRequest,
  scope: string,
  options: { limit?: number; windowMs?: number } = {}
): NextResponse | null {
  return assertSameOrigin(request) ?? assertRateLimit(request, scope, options.limit ?? 60, options.windowMs ?? 60_000);
}

export function guardContentLength(request: NextRequest, maxBytes: number): NextResponse | null {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) {
    return null;
  }

  const bytes = Number(contentLength);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return NextResponse.json({ error: "Invalid content length" }, { status: 400 });
  }

  if (bytes > maxBytes) {
    return NextResponse.json({ error: "Upload payload is too large" }, { status: 413 });
  }

  return null;
}

function assertSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) {
    return null;
  }

  try {
    if (new URL(origin).host !== host) {
      return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  return null;
}

function assertRateLimit(request: NextRequest, scope: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const store = rateLimitStore();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  existing.count += 1;
  if (existing.count > limit) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  return null;
}

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
