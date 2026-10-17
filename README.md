# Pulse

SaaS production error tracker: ingest API, AI agent, JavaScript SDK, and a live dashboard.

Pulse traces client crashes, groups them, opens a GitHub PR on the **client repo / base branch**, and emails the **client inbox**. GitHub and PR email belong to the client app, not to Pulse. The agent reads stack-matched files from GitHub only.

## Stack

- API: Fastify, Socket.IO, Zod, better-sqlite3
- Agent: Gemini, Octokit PRs, Nodemailer (`@pulse/agent`)
- SDK: browser + Node (`window.onerror`, unhandled rejections, breadcrumbs)
- Dashboard: React, Vite, Tailwind, Recharts

## Run Pulse

Use Node.js 22 LTS. The API uses `better-sqlite3`, which has native binaries for Node 22; newer Node releases may require local Python and C++ build tools.

```bash
npm install
npm run setup
npm run dev
```

Put production keys in `.env` (`NODE_ENV`, `HOST`, `PORT`, `DASHBOARD_URL`, `GEMINI_API_KEY`, `SMTP_USER`, `SMTP_PASS`, `ISQUEUEENABLE`, `REDIS_URL`). Create a project in the dashboard and copy that project's DSN into the client app.

Set `ISQUEUEENABLE=true` to run scan, fix, PR, and invitation emails as BullMQ jobs (`REDIS_URL` required). The Jobs page and `/queues/ui` dashboard show those queues. `false` keeps inline job handling.

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

## Flow

```
Client SDK  →  register GitHub + PR email
Client SDK  →  POST /ingest/:key  →  SQLite group  →  live dashboard
                                      ↓
                               new error/fatal
                                      ↓
              Gemini fix → PR on client base branch → email client inbox
```
