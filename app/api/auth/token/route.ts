import { NextRequest, NextResponse } from "next/server";
import { fetchAuthenticatedUser, GitHubApiError } from "@/lib/github/client";
import { createSession, SessionStorageSetupError, setSessionCookie } from "@/lib/server/session";
import { guardPostRequest } from "@/lib/server/requestGuards";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "auth:token", { limit: 20 });
  if (guard) {
    return guard;
  }

  try {
    const body = (await request.json()) as { token?: string };
    const token = body.token?.trim();
    if (!token) {
      return NextResponse.json({ error: "GitHub token is required." }, { status: 400 });
    }

    const user = await fetchAuthenticatedUser(token);
    const sessionId = await createSession(token, user);
    const response = NextResponse.json({ authenticated: true, user });
    setSessionCookie(response, sessionId);
    return response;
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: "GitHub token could not be verified." }, { status: 400 });
    }
    if (error instanceof SessionStorageSetupError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to connect GitHub token." },
      { status: 400 }
    );
  }
}
