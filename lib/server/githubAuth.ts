import type { NextRequest } from "next/server";
import { fetchAuthenticatedUser } from "@/lib/github/client";
import type { AuthenticatedUser } from "@/lib/types";
import { getEffectiveGithubSettings } from "@/lib/server/appSettings";
import { readSession } from "@/lib/server/session";

export type GitHubCredentials = {
  source: "oauth" | "token";
  user: AuthenticatedUser;
  accessToken: string;
};

export async function getGitHubCredentials(request: NextRequest): Promise<GitHubCredentials | null> {
  const session = await readSession(request);
  if (session) {
    return {
      source: "oauth",
      user: session.user,
      accessToken: session.accessToken
    };
  }

  const settings = await getEffectiveGithubSettings();
  if (settings.authMode === "token" && settings.personalAccessTokenSource === "env" && settings.personalAccessToken) {
    return getEnvTokenCredentials(request, settings.personalAccessToken);
  }

  return null;
}

async function getEnvTokenCredentials(request: NextRequest, token: string): Promise<GitHubCredentials | null> {
  if (process.env.ALLOW_SERVER_TOKEN_AUTH === "true") {
    try {
      return {
        source: "token",
        user: await fetchAuthenticatedUser(token),
        accessToken: token
      };
    } catch {
      return null;
    }
  }

  const host = request.headers.get("host") ?? "";
  if (process.env.NODE_ENV !== "production" || host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    try {
      return {
        source: "token",
        user: await fetchAuthenticatedUser(token),
        accessToken: token
      };
    } catch {
      return null;
    }
  }

  return null;
}
