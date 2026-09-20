# Pulse

SaaS production error tracker: ingest API, AI agent, JavaScript SDK, and a live dashboard.

Pulse traces client crashes, groups them, opens a GitHub PR on the **client repo / base branch**, and emails the **client inbox**. GitHub and PR email belong to the client app, not to Pulse.

## Stack

- API: Fastify, Socket.IO, Zod, better-sqlite3
- Agent: Gemini, Octokit PRs, Nodemailer (`@pulse/agent`)
- SDK: browser + Node (`window.onerror`, unhandled rejections, breadcrumbs)
- Dashboard: React, Vite, Tailwind, Recharts

## Run Pulse itself

```bash
cd pulse
npm run setup
npm run dev
```

- Dashboard: http://127.0.0.1:5173
- API health: http://127.0.0.1:8787/health
- Demo DSN: `http://127.0.0.1:8787/ingest/pk_live_demo_pulse`

Pulse `.env` only needs SaaS keys:

```env
GEMINI_API_KEY=your_gemini_api_key
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
```

Pulse sends mail with those SMTP credentials. Whether a client wants PR emails is `ISENABLEDSENDEMAIL` in **that client app**, not in Pulse.

## Install Pulse in a client app

Create a project in the Pulse dashboard (**Setup**) and put the DSN plus the client's GitHub and PR email in **that app's** `.env`.

```bash
npm install @pulse/sdk
```

```env
PULSE_DSN=http://127.0.0.1:8787/ingest/YOUR_PROJECT_KEY
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

Production uses the same key with your Pulse host:

`https://pulse.yourdomain.com/ingest/YOUR_PROJECT_KEY`

## Flow

```
Client SDK  →  register GitHub + PR email
Client SDK  →  POST /ingest/:key  →  SQLite group  →  live dashboard
                                      ↓
                               new error/fatal
                                      ↓
              Gemini fix → PR on client base branch → email client inbox
```
