import { NextRequest, NextResponse } from "next/server";
import { GitHubApiError, compareFileReferencesWithBaseBranch } from "@/lib/github/client";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { guardContentLength, guardPostRequest } from "@/lib/server/requestGuards";
import { validateCompareFilesPayload } from "@/lib/server/uploadValidation";
import { DEFAULT_MAX_TOTAL_UPLOAD_BYTES } from "@/lib/security/pathRules";
import type { CompareFilePayload, CompareFilesResult } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "github:compare-files", { limit: 30 }) ?? guardContentLength(request, DEFAULT_MAX_TOTAL_UPLOAD_BYTES * 2);
  if (guard) {
    return guard;
  }

  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const payload = validateCompareFilesPayload(await request.json());
    const comparison = await compareFileReferencesWithBaseBranch(
      credentials.accessToken,
      credentials.user.login,
      payload.repoFullName,
      payload.baseBranch,
      payload.files
    );

    console.info("folder_to_github_compare_requested", {
      repoFullName: payload.repoFullName,
      baseBranch: comparison.baseBranch,
      fileCount: payload.files.length,
      changedFilesCount: comparison.changedFilesCount,
      unchangedFilesCount: comparison.unchangedFilesCount,
      totalBytes: payload.totalBytes
    });

    const response: CompareFilesResult = {
      baseBranch: comparison.baseBranch,
      changedFiles: comparison.changedFiles.map(toMetadata),
      unchangedFiles: comparison.unchangedFiles.map(toMetadata),
      changedFilesCount: comparison.changedFilesCount,
      unchangedFilesCount: comparison.unchangedFilesCount,
      changedBytes: comparison.changedBytes,
      unchangedBytes: comparison.unchangedBytes
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to compare files with GitHub" },
      { status: 400 }
    );
  }
}

function toMetadata(file: CompareFilePayload) {
  return {
    path: file.path,
    size: file.size
  };
}