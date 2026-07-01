import { NextRequest, NextResponse } from "next/server";
import { GitHubApiError, initializeEmptyRepository } from "@/lib/github/client";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { guardPostRequest } from "@/lib/server/requestGuards";
import { isSafeBranchName } from "@/lib/server/uploadValidation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "github:initialize-repo", { limit: 10 });
  if (guard) {
    return guard;
  }

  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { repoFullName?: string; branchName?: string };
    if (!body.repoFullName) {
      return NextResponse.json({ error: "repoFullName is required" }, { status: 400 });
    }
    if (body.branchName && !isSafeBranchName(body.branchName)) {
      return NextResponse.json({ error: "Initial branch name contains unsupported Git syntax" }, { status: 400 });
    }

    const result = await initializeEmptyRepository(
      credentials.accessToken,
      credentials.user.login,
      body.repoFullName,
      body.branchName
    );

    console.info("folder_to_github_repo_initialized", {
      repoFullName: body.repoFullName,
      branchName: result.branchName
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to initialize repository" },
      { status: 400 }
    );
  }
}