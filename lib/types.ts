export type AuthenticatedUser = {
  id: number;
  login: string;
  avatarUrl: string;
};

export type GitHubRepository = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  ownerLogin: string;
  canPush: boolean;
};

export type CreateRepositoryPayload = {
  name: string;
  description?: string;
  private: boolean;
  autoInit?: boolean;
};

export type UploadFilePayload = {
  path: string;
  content: string;
  size: number;
};

export type CreatePullRequestPayload = {
  repoFullName: string;
  branchName: string;
  commitMessage: string;
  files: UploadFilePayload[];
  baseBranch?: string;
  draft?: boolean;
};

export type CreatePullRequestResult = {
  branchName: string;
  commitSha: string;
  pullRequestUrl: string;
  pullRequestNumber: number;
};