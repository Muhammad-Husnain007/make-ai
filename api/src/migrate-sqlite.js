import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { AdminNotification, Company, CompanyMember, Event, Invitation, Issue, Project, RegisterOtp, ResetOtp, Session, User, connectDb, disconnectDb } from './db.js';
import './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.join(here, '..', 'data', 'pulse.db');
const parseJson = (value, fallback) => { try { return JSON.parse(value ?? JSON.stringify(fallback)); } catch { return fallback; } };
const asBool = (value) => Boolean(value);

const tables = [
  ['projects', Project, (row) => ({ ...row, send_email_enabled: asBool(row.send_email_enabled) })],
  ['issues', Issue, (row) => ({ ...row, pr_merged: asBool(row.pr_merged), pr_closed: asBool(row.pr_closed), agent_pipeline: parseJson(row.agent_pipeline, {}) })],
  ['events', Event, (row) => ({ ...row, user: parseJson(row.user_json, {}), tags: parseJson(row.tags_json, {}), breadcrumbs: parseJson(row.breadcrumbs_json, []), extra: parseJson(row.extra_json, {}) })],
  ['users', User, (row) => row],
  ['sessions', Session, (row) => row],
  ['companies', Company, (row) => ({ ...row, paused: asBool(row.paused) })],
  ['company_members', CompanyMember, (row) => ({ ...row, can_invite: asBool(row.can_invite) })],
  ['invitations', Invitation, (row) => ({ ...row, can_invite: asBool(row.can_invite) })],
  ['register_otps', RegisterOtp, (row) => ({ ...row, verified: asBool(row.verified) })],
  ['reset_otps', ResetOtp, (row) => ({ ...row, verified: asBool(row.verified) })],
  ['admin_notifications', AdminNotification, (row) => row],
];

async function main() {
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database was not found at ${sqlitePath}`);
  await connectDb();
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    for (const [table, Model, convert] of tables) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (!rows.length) { console.log(`${table}: 0 rows`); continue; }
      const key = ['register_otps', 'reset_otps'].includes(table) ? 'email' : table === 'sessions' ? 'token' : 'id';
      await Model.bulkWrite(rows.map((row) => {
        const doc = convert(row);
        if (table === 'events') {
          delete doc.user_json; delete doc.tags_json; delete doc.breadcrumbs_json; delete doc.extra_json;
          doc.release_name = row.release_name || '';
        }
        return { replaceOne: { filter: { [key]: doc[key] }, replacement: doc, upsert: true } };
      }), { ordered: true });
      console.log(`${table}: ${rows.length} rows migrated`);
    }
  } finally {
    sqlite.close();
    await disconnectDb();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
