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
  if (settings.authMode === "token" && settings.personalAccessToken) {
    if (!serverTokenAuthAllowed(request)) {
      return null;
    }

    try {
      return {
        source: "token",
        user: await fetchAuthenticatedUser(settings.personalAccessToken),
        accessToken: settings.personalAccessToken
      };
    } catch {
      return null;
    }
  }

  return null;
}

function serverTokenAuthAllowed(request: NextRequest): boolean {
  if (process.env.ALLOW_SERVER_TOKEN_AUTH === "true") {
    return true;
  }

  const host = request.headers.get("host") ?? "";
  return process.env.NODE_ENV !== "production" || host.startsWith("localhost") || host.startsWith("127.0.0.1");
}
