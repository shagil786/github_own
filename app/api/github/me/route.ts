import { NextRequest, NextResponse } from "next/server";
import { missingGithubAuthEnv } from "@/lib/server/env";
import { getGitHubCredentials } from "@/lib/server/githubAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const missingConfig = await missingGithubAuthEnv();
  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({
      authenticated: false,
      githubConfigured: missingConfig.length === 0,
      missingConfig
    });
  }

  return NextResponse.json({
    authenticated: true,
    user: credentials.user,
    authSource: credentials.source,
    githubConfigured: missingConfig.length === 0,
    missingConfig
  });
}
