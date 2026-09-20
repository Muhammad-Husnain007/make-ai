import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'pulse.db');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    culprit TEXT,
    type TEXT,
    level TEXT NOT NULL DEFAULT 'error',
    status TEXT NOT NULL DEFAULT 'open',
    count INTEGER NOT NULL DEFAULT 1,
    user_count INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    UNIQUE (project_id, fingerprint),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    level TEXT,
    message TEXT,
    type TEXT,
    stack TEXT,
    url TEXT,
    environment TEXT,
    release_name TEXT,
    user_json TEXT,
    tags_json TEXT,
    breadcrumbs_json TEXT,
    extra_json TEXT,
    sdk TEXT,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_issues_project_last ON issues(project_id, last_seen DESC);
  CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
  CREATE INDEX IF NOT EXISTS idx_events_issue_time ON events(issue_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_events_project_time ON events(project_id, timestamp DESC);
`);

function ensureColumn(table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

ensureColumn('issues', 'agent_status', "TEXT NOT NULL DEFAULT 'idle'");
ensureColumn('issues', 'agent_summary', 'TEXT');
ensureColumn('issues', 'agent_solution', 'TEXT');
ensureColumn('issues', 'pr_url', 'TEXT');
ensureColumn('issues', 'pr_merged', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('issues', 'pr_closed', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('issues', 'emailed_at', 'TEXT');
ensureColumn('issues', 'emailed_to', 'TEXT');
ensureColumn('projects', 'notify_email', "TEXT NOT NULL DEFAULT 'mh8169951@gmail.com'");

db.prepare(`
  UPDATE projects
  SET notify_email = 'mh8169951@gmail.com'
  WHERE notify_email IS NULL
     OR trim(notify_email) = ''
     OR notify_email = 'hasnainilyas007@gmail.com'
`).run();

const DEMO_KEY = 'pk_live_demo_pulse';

export function ensureDemoProject() {
  const existing = db.prepare('SELECT * FROM projects WHERE public_key = ?').get(DEMO_KEY);
  if (existing) return existing;
  const project = {
    id: nanoid(),
    name: 'Production App',
    public_key: DEMO_KEY,
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO projects (id, name, public_key, created_at) VALUES (@id, @name, @public_key, @created_at)').run(project);
  return project;
}

ensureDemoProject();

if (process.argv.includes('--init')) {
  const project = db.prepare('SELECT * FROM projects WHERE public_key = ?').get(DEMO_KEY);
  console.log(`Pulse DB ready at ${dbPath}`);
  console.log(`Demo DSN key: ${project.public_key}`);
}
