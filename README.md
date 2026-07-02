# Folder to GitHub

A secure browser-based tool for selecting a local project folder, reviewing what will be committed, blocking likely secrets, and opening a pull request in a personal GitHub repository through the GitHub API.

The app does not use local Git, SSH, GitHub Desktop, terminal Git commands, or local `.git/config`. Browser-selected `.git/` folders are ignored completely.

## Security model

- GitHub tokens are submitted only to the backend and are never stored in localStorage.
- Auth state is stored in an HTTP-only session cookie, while each user's access token is encrypted in server-side session storage.
- Token sessions expire automatically. Set `SESSION_TTL_HOURS` to control the duration; the default is 48 hours.
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

- Empty files
- Files over `MAX_FILE_SIZE_BYTES`, default 5 MB
- Common binary/archive/media/font/database/cache file types
- Files whose first bytes look binary

## Secret scanning

The scanner blocks common private key markers, GitHub tokens, AWS key patterns, database URLs with embedded credentials, JWT secret assignments, and long token/password-style assignments.

This is a safety net, not a formal data-loss-prevention system. Review the file list before opening a pull request.

## GitHub auth setup

Public app flow: each visitor pastes their own fine-grained GitHub token in the app. The backend verifies the token, stores it in that visitor's encrypted session, and expires it automatically. There is no shared GitHub token for all users.

OAuth setup is optional: create a GitHub App and use its Client ID and Client Secret for the web authorization flow.

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

5. Add the GitHub Client ID and Client Secret to your deployment if you want OAuth sign-in in addition to token sessions.

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

Recommended public production variables:

- Supabase server-only variables: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `SESSION_TTL_HOURS=48`, optional

Optional OAuth/GitHub App production variables:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Optional session encryption override:

- `SESSION_SECRET`

If `SESSION_SECRET` is not set, the app uses the server-side Supabase key to encrypt sessions. Set `SESSION_SECRET` only if you want a separate encryption secret.

Optional self-hosted shared-token variables:

- `GITHUB_TOKEN`
- `ALLOW_SERVER_TOKEN_AUTH=true`

Create the Supabase tables by running [supabase/settings-schema.sql](/Users/mnizami/Documents/Codex/2026-07-01/build-a-secure-browser-based-folder/supabase/settings-schema.sql) in the Supabase SQL editor. User sessions are encrypted before being stored in the `user_sessions` table and expire using `SESSION_TTL_HOURS`. Keep `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, database passwords, and Postgres URLs server-only. Never use `NEXT_PUBLIC_` for those values.

The old Settings storage path is still available for private/self-hosted setups, but public hosted users should connect with their own session token on the main page.

Vercel Blob variables such as `BLOB_STORE_ID` and `BLOB_WEBHOOK_PUBLIC_KEY` do not give the app a writable settings store. They identify the Blob store / webhook verification path, but writing or overwriting a settings object would require `BLOB_READ_WRITE_TOKEN` and a Blob-backed storage implementation. This app currently uses Supabase first, then Redis/Upstash as a fallback, for durable runtime Settings storage in production.

Vercel Functions currently limit request and response bodies to 4.5 MB. Keep `MAX_TOTAL_UPLOAD_BYTES` below that practical payload size for hosted Vercel deployments, or use this app locally/self-hosted for larger folder uploads.

## Flow

1. Paste a GitHub token to create your expiring browser session.
2. Select a local project folder in the browser.
3. Review ignored, skipped, blocked, and approved files.
4. Choose a personal GitHub repository.
5. Enter a new branch name and commit message.
6. Compare approved files with GitHub to see new, modified, and unchanged files. This comparison sends file metadata and hashes, not file contents.
7. Create a pull request. Files already identical to the base branch are skipped automatically.

If every file appears as new, the selected base branch does not contain matching commit paths yet. Merge the previous pull request into that base branch, or choose the branch that already contains the uploaded project files before comparing again.

## API routes

- `GET /api/auth/github/start` starts the GitHub authorization flow.
- `GET /api/auth/github/callback` exchanges the authorization code and creates a session.
- `POST /api/auth/token` verifies a personal access token and creates an encrypted expiring session.
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
- Public hosted users connect with their own GitHub token in an expiring encrypted session. Supabase is used for durable server-side session storage when configured.
- If a branch already exists, the app tries numbered suffixes before reporting a conflict.
