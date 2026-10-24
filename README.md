# Pulse

SaaS production error tracker: ingest API, AI agent, JavaScript SDK, and a live dashboard.

Pulse traces client crashes, groups them, opens a GitHub PR on the **client repo / base branch**, and emails the **client inbox**. GitHub and PR email belong to the client app, not to Pulse. The agent reads stack-matched files from GitHub only.

## Stack

- API: Fastify, Socket.IO, Zod, Mongoose, MongoDB
- Agent: Gemini, Octokit PRs, Nodemailer (`@pulse/agent`)
- SDK: browser + Node (`window.onerror`, unhandled rejections, breadcrumbs)
- Dashboard: React, Vite, Tailwind, Recharts

## Run Pulse

Use Node.js 22 LTS. The API stores Pulse data in MongoDB. Set `MONGODB_URI` and optionally `MONGODB_DB_NAME` (defaults to `pulse`) in the Pulse API environment.

```bash
npm install
npm run setup
npm run dev
```

Configure `.env` with `NODE_ENV`, `HOST`, `PORT`, `DASHBOARD_URL`, `MONGODB_URI`, `AI_API_KEY`, `SMTP_USER`, and `SMTP_PASS`. Create a project in the dashboard and copy that project's DSN into the client app. Agent processing and invitation emails are handled inline by the API.

To preserve data from an existing Pulse SQLite database, run `npm run db:migrate -w api` once before starting the API. The migration is idempotent and leaves the SQLite file untouched.

Pulse sends mail with those SMTP credentials. Whether a client wants PR emails is `ISENABLEDSENDEMAIL` in **that client app**, not in Pulse.

## Install Pulse in a client app

Create a project in the Pulse dashboard (**Setup**) and put the DSN plus the client's GitHub and PR email in **that app's** `.env`.

```bash
npm install @pulse/sdk
```

```env
PULSE_DSN=https://pulse.yourdomain.com/ingest/YOUR_PROJECT_KEY
PULSE_ENVIRONMENT=production
PULSE_RELEASE=1.0.0
PULSE_NOTIFY_EMAIL=alerts@company.com
GITHUB_TOKEN=ghp_your_token
GITHUB_REPO=owner/repo
GITHUB_BASE_BRANCH=main
ISENABLEDSENDEMAIL=true
```

```json
{
  "scripts": {
    "start": "node --import @pulse/sdk/register src/server.js"
  }
}
```

On startup the SDK tells Pulse the repo, base branch, PR email, and whether to send that email. No route changes in the client.

For a fine-grained GitHub personal access token, select the exact client repository and grant **Contents: Read and write** and **Pull requests: Read and write**. Organization repositories may also require an administrator to approve the token or authorize it for SSO. Store this token in the Pulse project's GitHub settings, not in the Pulse server `.env`.

Before opening a PR, Pulse checks patched-file syntax and crash signatures, then asks Gemini to review the patch and available related tests. It does not execute the client repository's test suite; run that suite in the client project's CI before merging the PR.

## Flow

```
Client SDK  →  register GitHub + PR email
Client SDK  →  POST /ingest/:key  →  MongoDB issue/event collections  →  live dashboard
                                      ↓
                               new error/fatal
                                      ↓
              Gemini fix → PR on client base branch → email client inbox
```
