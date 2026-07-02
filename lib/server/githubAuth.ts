import type { NextRequest } from "next/server";
import type { AuthenticatedUser } from "@/lib/types";
import { readSession } from "@/lib/server/session";

export type GitHubCredentials = {
  user: AuthenticatedUser;
  accessToken: string;
};

export async function getGitHubCredentials(request: NextRequest): Promise<GitHubCredentials | null> {
  const session = await readSession(request);
  if (session) {
    return {
      user: session.user,
      accessToken: session.accessToken
    };
  }

  return null;
}
