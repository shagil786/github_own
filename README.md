# Folder to GitHub

A secure browser-based tool for selecting a local project folder, reviewing what will be committed, blocking likely secrets, and opening a pull request in a personal GitHub repository through the GitHub API.

The app does not use local Git, SSH, GitHub Desktop, terminal Git commands, or local `.git/config`. Browser-selected `.git/` folders are ignored completely.

## Security model

- GitHub tokens are never exposed to frontend code.
- Auth state is stored in an HTTP-only session cookie, while the access token is kept in encrypted server-side session storage.
- The browser filters ignored files and scans text files before upload.
- The server revalidates paths, limits, ignore rules, and secret scan results before calling GitHub.
- Ignored, skipped, or blocked files are not uploaded to the backend by the normal UI flow.
- The file preview first shows locally approved files. The optional GitHub comparison step sends only paths, sizes, and Git blob hashes, then narrows that list to files that differ from the selected base branch.
- Uploaded file contents are held only in request memory while the branch, commit, and PR are created.
- If the user runs the comparison first, PR creation uploads only changed file contents. The backend still compares uploaded text files against the selected base branch and only commits files that are new or changed.
- Server logs include only metadata such as repo name, branch name, file count, and total bytes.
- Only personal repositories owned by the signed-in GitHub user and writable by that user are listed or accepted.

## What gets ignored or skipped

Ignored by default:

- `.git/`
- `node_modules/`
- `dist/`
- `build/`
- `.next/`
- `coverage/`
- `.env`
- `.env.*`
- `*.pem`
- `*.key`
- `.DS_Store`
- OS metadata, package-manager debug logs, cache folders

Skipped by default:

- Files over `MAX_FILE_SIZE_BYTES`, default 5 MB
- Common binary/archive/media/font/database/cache file types
- Files whose first bytes look binary

## Secret scanning

The scanner blocks common private key markers, GitHub tokens, AWS key patterns, database URLs with embedded credentials, JWT secret assignments, and long token/password-style assignments.

This is a safety net, not a formal data-loss-prevention system. Review the file list before opening a pull request.

## GitHub auth setup

Fastest personal setup: use **Settings** and choose **Personal access token**. Paste a fine-grained token that has access only to the personal repositories this tool should update.

OAuth setup: create a GitHub App and use its Client ID and Client Secret for the web authorization flow.

1. In GitHub, go to Developer settings, then GitHub Apps, then create a new app under your personal account.
2. Set the callback URL to:

   ```text
   http://localhost:3000/api/auth/github/callback
   ```

3. Enable user authorization for the app if GitHub asks whether users should authorize during install/sign-in.
4. Grant the app the minimum repository permissions needed:

   ```text
   Contents: Read and write
   Pull requests: Read and write
   Metadata: Read-only
   ```

5. Open the app, go to **Settings**, choose **OAuth app**, and save the GitHub Client ID, Client Secret, application URL, and session secret.

Fallback: a standard GitHub OAuth App also works with the same callback URL. The implementation requests `repo read:user` because it must create branches, commits, and pull requests in private personal repositories.

Relevant GitHub docs:

- GitHub App registration: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
- GitHub App login/OAuth callback flow: https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-login-with-github-button-with-a-github-app
- Git Data API overview: https://docs.github.com/en/rest/git

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run dev
   ```

3. Open:

   ```text
   http://localhost:3000
   ```

4. Go to **Settings** and save either:

   - Personal access token mode: paste your GitHub token.
   - OAuth/GitHub App mode: save client ID, client secret, application URL, and session secret.

Environment variables from `.env.local` are still supported as a deployment fallback, but the local product flow uses the Settings page. Saved settings are encrypted server-side in `.app-data`, which is ignored by Git.

## Deploy to Vercel

Inside the running app, the **Deploy** button is dynamic. It uses the currently selected GitHub repository and that repository's default branch, usually `main`, instead of the temporary upload branch created for a pull request.

To deploy this tool itself, open Vercel's clone flow with the GitHub URL for the repository where you host this app:

```text
https://vercel.com/new/clone?repository-url=<encoded GitHub repository URL>
```

Set these environment variables in Vercel:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `SETTINGS_ENCRYPTION_KEY`

For hosted production, use OAuth mode and keep runtime Settings disabled unless you explicitly set `ALLOW_RUNTIME_SETTINGS=true`.

Vercel Functions currently limit request and response bodies to 4.5 MB. Keep `MAX_TOTAL_UPLOAD_BYTES` below that practical payload size for hosted Vercel deployments, or use this app locally/self-hosted for larger folder uploads.

## Flow

1. Sign in with GitHub.
2. Select a local project folder in the browser.
3. Review ignored, skipped, blocked, and approved files.
4. Choose a personal GitHub repository.
5. Enter a new branch name and commit message.
6. Compare approved files with GitHub to see changed files and unchanged files that will be skipped. This comparison sends file metadata and hashes, not file contents.
7. Create a pull request. Files already identical to the base branch are skipped automatically.

## API routes

- `GET /api/auth/github/start` starts the GitHub authorization flow.
- `GET /api/auth/github/callback` exchanges the authorization code and creates a session.
- `POST /api/auth/logout` clears the session.
- `GET /api/github/me` returns safe session user metadata.
- `GET /api/github/repos` lists writable personal repositories.
- `GET /api/settings/github` returns safe GitHub settings metadata.
- `POST /api/settings/github` saves GitHub settings server-side.
- `POST /api/github/branches` creates a branch from the repo default branch.
- `POST /api/github/commit-files` commits validated files to a branch.
- `POST /api/github/open-pull-request` opens a pull request.
- `POST /api/github/initialize-repo` creates the first README commit for an empty repository.
- `POST /api/github/compare-files` compares approved file paths and Git blob hashes with the selected base branch and returns metadata for changed and unchanged files.
- `POST /api/github/create-pr` performs the normal end-to-end branch, commit, and PR flow.

## Notes

- The backend uses GitHub's REST Git Data API. It never shells out to `git`.
- This app is designed for personal/self-hosted use. For multi-user production, replace the in-memory session store with a durable encrypted store such as Redis or a database-backed session table.
- If a branch already exists, the app tries numbered suffixes before reporting a conflict.