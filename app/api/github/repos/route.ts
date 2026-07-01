import { NextRequest, NextResponse } from "next/server";
import { GitHubApiError, createPersonalRepository, listPersonalRepositories } from "@/lib/github/client";
import { getGitHubCredentials } from "@/lib/server/githubAuth";
import { guardPostRequest } from "@/lib/server/requestGuards";
import type { CreateRepositoryPayload } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const repos = await listPersonalRepositories(credentials.accessToken, credentials.user.login);
    return NextResponse.json({ repos });
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json({ error: "Unable to load repositories" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = guardPostRequest(request, "github:repos", { limit: 15 });
  if (guard) {
    return guard;
  }

  const credentials = await getGitHubCredentials(request);
  if (!credentials) {
    return NextResponse.json({ error: "GitHub is not connected" }, { status: 401 });
  }

  try {
    const payload = readCreateRepositoryPayload(await request.json());
    const repo = await createPersonalRepository(credentials.accessToken, credentials.user.login, payload);

    console.info("folder_to_github_repo_created", {
      repoFullName: repo.fullName,
      private: repo.private
    });

    return NextResponse.json({ repo });
  } catch (error) {
    if (error instanceof GitHubApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create repository" },
      { status: 400 }
    );
  }
}

function readCreateRepositoryPayload(input: unknown): CreateRepositoryPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid repository payload");
  }

  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    throw new Error("Repository name is required");
  }

  if (record.description !== undefined && typeof record.description !== "string") {
    throw new Error("Repository description must be text");
  }

  return {
    name: record.name.trim(),
    description: record.description?.trim(),
    private: record.private !== false,
    autoInit: record.autoInit !== false
  };
}
