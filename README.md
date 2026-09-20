# Pulse

Real-time production error tracker: ingest API, AI agent worker, JavaScript SDK, and a live dashboard.

## Stack

- API: Fastify, Socket.IO, Zod, better-sqlite3
- Agent: Gemini, Octokit PRs, Nodemailer (`@pulse/agent`)
- SDK: browser + Node (`window.onerror`, unhandled rejections, breadcrumbs)
- Dashboard: React, Vite, Tailwind, Recharts

Errors are fingerprinted and grouped. New events stream into the UI over WebSockets.

## Run Pulse itself

```bash
cd pulse
npm run setup
npm run dev
```

- Dashboard: http://127.0.0.1:5173
- API health: http://127.0.0.1:8787/health
- Demo DSN: `http://127.0.0.1:8787/ingest/pk_live_demo_pulse`

Set `GEMINI_API_KEY`, `GITHUB_TOKEN`, and SMTP in `pulse/.env`. The **PR alert inbox is not only in .env** — pick it per project in **Setup**.

## Install Pulse in any company app

Pulse is a product. The app does **not** import Pulse source folders. Install the SDK, set one env var, preload it on start.

```bash
npm install @pulse/sdk
```

```env
PULSE_DSN=http://127.0.0.1:8787/ingest/YOUR_PROJECT_KEY
PULSE_ENVIRONMENT=production
PULSE_RELEASE=1.0.0
```

```json
{
  "scripts": {
    "start": "node --import @pulse/sdk/register src/server.js"
  }
}
```

No route changes. No custom error-handler edits. The SDK hooks process crashes and Express `app.use(err, req, res, next)` handlers automatically.

Create the project + DSN in the Pulse dashboard (**Setup**). Production uses the same key with your Pulse host:

`https://pulse.yourdomain.com/ingest/YOUR_PROJECT_KEY`


## Flow

```
Any app SDK  →  POST /ingest/:key  →  SQLite group  →  live dashboard
                                      ↓
                               new error/fatal
                                      ↓
                    Gemini fix → GitHub PR → email saved on that project
```

Issue detail shows which inbox was used. Change it anytime from Setup; the next issue uses the new address.
