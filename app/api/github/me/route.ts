import { NextRequest, NextResponse } from "next/server";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { SessionStorageSetupError } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let credentials;
  try {
    credentials = await getGitHubCredentials(request);
  } catch (error) {
    if (error instanceof SessionStorageSetupError) {
      return NextResponse.json({
        authenticated: false,
        githubConfigured: true,
        missingConfig: []
      });
    }
    throw error;
  }

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
    githubConfigured: true,
    missingConfig: []
  });
}
