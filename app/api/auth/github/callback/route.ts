import { NextRequest, NextResponse } from "next/server";
import { fetchAuthenticatedUser } from "@/lib/github/client";
import { requireOAuthSettings } from "@/lib/server/appSettings";
import { appBaseUrl } from "@/lib/server/env";
import {
  clearOAuthStateCookie,
  createSession,
  setSessionCookie,
  validateOAuthState
} from "@/lib/server/session";

export const runtime = "nodejs";

type AccessTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !validateOAuthState(request, state)) {
    return redirectWithError(request, "invalid_oauth_state");
  }

  try {
    const settings = await requireOAuthSettings();
    const redirectUri = `${await appBaseUrl(request)}/api/auth/github/callback`;
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: settings.githubClientId,
        client_secret: settings.githubClientSecret,
        code,
        redirect_uri: redirectUri
      }),
      cache: "no-store"
    });

    const tokenJson = (await tokenResponse.json()) as AccessTokenResponse;
    if (!tokenResponse.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description ?? tokenJson.error ?? "GitHub token exchange failed");
    }

    const user = await fetchAuthenticatedUser(tokenJson.access_token);
    const sessionId = await createSession(tokenJson.access_token, user);

    const response = NextResponse.redirect(new URL("/?signed_in=1", request.url));
    setSessionCookie(response, sessionId);
    clearOAuthStateCookie(response);
    return response;
  } catch (error) {
    console.error("github_auth_callback_failed", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return redirectWithError(request, "github_auth_failed");
  }
}

function redirectWithError(request: NextRequest, error: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, request.url));
  clearOAuthStateCookie(response);
  return response;
}