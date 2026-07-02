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

export type FileMetadata = {
  path: string;
  size: number;
};

export type CompareFileStatus = "new" | "modified" | "unchanged" | "deleted";

export type CompareFileMetadata = FileMetadata & {
  status: CompareFileStatus;
};

export type CompareFilePayload = FileMetadata & {
  sha: string;
};

export type CompareFilesResult = {
  baseBranch: string;
  changedFiles: CompareFileMetadata[];
  unchangedFiles: CompareFileMetadata[];
  deletedFiles: CompareFileMetadata[];
  changedFilesCount: number;
  unchangedFilesCount: number;
  deletedFilesCount: number;
  newFilesCount: number;
  modifiedFilesCount: number;
  matchingPathsCount: number;
  existingFilesCount: number;
  changedBytes: number;
  unchangedBytes: number;
  deletedBytes: number;
};

export type CreatePullRequestPayload = {
  repoFullName: string;
  branchName: string;
  commitMessage: string;
  files: UploadFilePayload[];
  deletePaths?: string[];
  baseBranch?: string;
  draft?: boolean;
};

export type CreatePullRequestResult = {
  branchName: string;
  commitSha: string;
  pullRequestUrl: string;
  pullRequestNumber: number;
  uploadedFilesCount?: number;
  deletedFilesCount?: number;
  unchangedFilesCount?: number;
};
