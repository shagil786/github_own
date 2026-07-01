import { NextRequest, NextResponse } from "next/server";
import { getEffectiveGithubSettings, requireOAuthSettings } from "@/lib/server/appSettings";
import { appBaseUrl, missingGithubAuthEnv } from "@/lib/server/env";
import { newRandomToken, setOAuthStateCookie } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const effective = await getEffectiveGithubSettings();
  if (effective.authMode === "token" && effective.personalAccessToken) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const missing = await missingGithubAuthEnv();
  if (missing.length > 0) {
    const redirectUrl = new URL("/settings", request.url);
    redirectUrl.searchParams.set("setup", "github");
    return NextResponse.redirect(redirectUrl);
  }

  const settings = await requireOAuthSettings();
  const state = newRandomToken();
  const redirectUri = `${await appBaseUrl(request)}/api/auth/github/callback`;

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", settings.githubClientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "repo read:user");
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl);
  setOAuthStateCookie(response, state);
  return response;
}
