import { NextRequest, NextResponse } from "next/server";
import { GitHubApiError, createPullRequestFromFiles } from "@/lib/github/client";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { DEFAULT_MAX_TOTAL_UPLOAD_BYTES } from "@/lib/security/pathRules";
import { guardContentLength, guardPostRequest } from "@/lib/server/requestGuards";
import { validateUploadPayload } from "@/lib/server/uploadValidation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "github:create-pr", { limit: 20 }) ?? guardContentLength(request, DEFAULT_MAX_TOTAL_UPLOAD_BYTES * 2);
  if (guard) {
    return guard;
  }

  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const payload = validateUploadPayload(await request.json());

    console.info("folder_to_github_pr_requested", {
      repoFullName: payload.repoFullName,
      branchName: payload.branchName,
      fileCount: payload.files.length,
      totalBytes: payload.totalBytes
    });

    const result = await createPullRequestFromFiles(
      credentials.accessToken,
      credentials.user.login,
      payload.repoFullName,
      payload.branchName,
      payload.commitMessage,
      payload.files,
      payload.baseBranch,
      payload.draft
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create pull request" },
      { status: 400 }
    );
  }
}