import { NextRequest, NextResponse } from "next/server";
import { fetchAuthenticatedUser, GitHubApiError } from "@/lib/github/client";
import {
  readPublicSettings,
  runtimeSettingsAdminConfigured,
  runtimeSettingsAdminRequired,
  runtimeSettingsAllowed,
  saveGithubSettings,
  verifyRuntimeSettingsAdminKey
} from "@/lib/server/appSettings";
import { guardPostRequest } from "@/lib/server/requestGuards";

export const runtime = "nodejs";
const RUNTIME_SETTINGS_DISABLED_MESSAGE =
  "Runtime settings are disabled in production. To save a GitHub key from this Settings page, set SETTINGS_ADMIN_KEY in Vercel and redeploy. Add Supabase service-role storage for durable saved settings.";

export async function GET() {
  return NextResponse.json(await readPublicSettings());
}

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "settings:github", { limit: 10 });
  if (guard) {
    return guard;
  }
  if (!runtimeSettingsAllowed()) {
    return NextResponse.json({ error: RUNTIME_SETTINGS_DISABLED_MESSAGE }, { status: 403 });
  }
  if (runtimeSettingsAdminRequired() && !runtimeSettingsAdminConfigured()) {
    return NextResponse.json(
      { error: "Production runtime settings require SETTINGS_ADMIN_KEY with at least 16 characters." },
      { status: 403 }
    );
  }
  if (!verifyRuntimeSettingsAdminKey(request.headers.get("x-settings-admin-key"))) {
    return NextResponse.json({ error: "Setup key did not match this deployment." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      authMode?: "token" | "oauth";
      appUrl?: string;
      githubClientId?: string;
      githubClientSecret?: string;
      personalAccessToken?: string;
      sessionSecret?: string;
    };

    if (!body.appUrl) {
      return NextResponse.json({ error: "Application URL is required." }, { status: 400 });
    }

    if (body.authMode !== "oauth" && body.personalAccessToken?.trim()) {
      await fetchAuthenticatedUser(body.personalAccessToken.trim());
    }

    const settings = await saveGithubSettings({
      authMode: body.authMode === "oauth" ? "oauth" : "token",
      appUrl: body.appUrl,
      githubClientId: body.githubClientId,
      githubClientSecret: body.githubClientSecret,
      personalAccessToken: body.personalAccessToken,
      sessionSecret: body.sessionSecret
    });

    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: "GitHub token could not be verified." }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save settings." },
      { status: 400 }
    );
  }
}
