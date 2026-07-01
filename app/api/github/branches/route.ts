import { NextRequest, NextResponse } from "next/server";
import { GitHubApiError, createBranch, listRepositoryBranches } from "@/lib/github/client";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { guardPostRequest } from "@/lib/server/requestGuards";
import { isSafeBranchName } from "@/lib/server/uploadValidation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const repoFullName = request.nextUrl.searchParams.get("repoFullName");
    if (!repoFullName) {
      return NextResponse.json({ error: "repoFullName is required" }, { status: 400 });
    }

    const branches = await listRepositoryBranches(credentials.accessToken, credentials.user.login, repoFullName);
    return NextResponse.json({ branches });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "github:branches", { limit: 30 });
  if (guard) {
    return guard;
  }

  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { repoFullName?: string; branchName?: string; baseBranch?: string };
    if (!body.repoFullName || !body.branchName) {
      return NextResponse.json({ error: "repoFullName and branchName are required" }, { status: 400 });
    }
    if (!isSafeBranchName(body.branchName)) {
      return NextResponse.json({ error: "Branch name contains unsafe characters or unsupported Git syntax" }, { status: 400 });
    }

    const branch = await createBranch(credentials.accessToken, credentials.user.login, body.repoFullName, body.branchName, body.baseBranch);
    return NextResponse.json(branch);
  } catch (error) {
    return githubErrorResponse(error);
  }
}

function githubErrorResponse(error: unknown) {
  if (error instanceof GitHubApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unable to create branch" },
    { status: 400 }
  );
}
