import { NextRequest, NextResponse } from "next/server";
import { getGitHubCredentials } from "@/lib/server/githubAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({
      authenticated: false,
      githubConfigured: true,
      missingConfig: []
    });
  }

  return NextResponse.json({
    authenticated: true,
    user: credentials.user,
    authSource: credentials.source,
    githubConfigured: true,
    missingConfig: []
  });
}
