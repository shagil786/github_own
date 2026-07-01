import { NextRequest, NextResponse } from "next/server";
import { GitHubApiError, openPullRequest } from "@/lib/github/client";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { guardPostRequest } from "@/lib/server/requestGuards";
import { isSafeBranchName } from "@/lib/server/uploadValidation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "github:open-pull-request", { limit: 20 });
  if (guard) {
    return guard;
  }

  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      repoFullName?: string;
      branchName?: string;
      commitMessage?: string;
      defaultBranch?: string;
      draft?: boolean;
    };

    if (!body.repoFullName || !body.branchName || !body.commitMessage) {
      return NextResponse.json(
        { error: "repoFullName, branchName, and commitMessage are required" },
        { status: 400 }
      );
    }
    if (!isSafeBranchName(body.branchName)) {
      return NextResponse.json({ error: "Branch name contains unsafe characters or unsupported Git syntax" }, { status: 400 });
    }

    const pullRequest = await openPullRequest(
      credentials.accessToken,
      credentials.user.login,
      body.repoFullName,
      body.branchName,
      body.commitMessage,
      body.defaultBranch,
      Boolean(body.draft)
    );

    return NextResponse.json(pullRequest);
  } catch (error) {
    return githubErrorResponse(error);
  }
}

function githubErrorResponse(error: unknown) {
  if (error instanceof GitHubApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unable to open pull request" },
    { status: 400 }
  );
}
