import mongoose from 'mongoose';

const { Schema } = mongoose;
const schema = (fields, indexes = []) => {
  const value = new Schema(fields, { versionKey: false, strict: false });
  for (const [keys, options] of indexes) value.index(keys, options);
  return value;
};

const model = (name, fields, indexes) => mongoose.models[name] || mongoose.model(name, schema(fields, indexes));
const id = { type: String, required: true, unique: true, index: true };

export const Project = model('PulseProject', {
  id, name: String, public_key: { type: String, unique: true, index: true }, created_at: String,
  notify_email: { type: String, default: '' }, github_token: String, github_repo: String,
  github_base_branch: String, send_email_enabled: { type: Boolean, default: false }, company_id: { type: String, default: null },
});
export const Issue = model('PulseIssue', {
  id, project_id: { type: String, index: true }, fingerprint: String, title: String, culprit: String,
  type: String, level: { type: String, default: 'error' }, status: { type: String, default: 'open' },
  count: { type: Number, default: 1 }, user_count: { type: Number, default: 0 }, first_seen: String, last_seen: String,
  agent_status: { type: String, default: 'idle' }, agent_summary: String, agent_solution: String,
  pr_url: String, pr_merged: { type: Boolean, default: false }, pr_closed: { type: Boolean, default: false },
  emailed_at: String, emailed_to: String, agent_pipeline: Schema.Types.Mixed, agent_error: String,
}, [[{ project_id: 1, fingerprint: 1 }, { unique: true }], [{ project_id: 1, last_seen: -1 }, {}], [{ status: 1 }, {}]]);
export const Event = model('PulseEvent', {
  id, issue_id: { type: String, index: true }, project_id: { type: String, index: true }, timestamp: { type: String, index: true },
  level: String, message: String, type: String, stack: String, url: String, environment: String, release_name: String,
  user: { type: Schema.Types.Mixed, default: {} }, tags: { type: Schema.Types.Mixed, default: {} },
  breadcrumbs: { type: [Schema.Types.Mixed], default: [] }, extra: { type: Schema.Types.Mixed, default: {} }, sdk: String,
}, [[{ issue_id: 1, timestamp: -1 }, {}], [{ project_id: 1, timestamp: -1 }, {}]]);
export const User = model('PulseUser', { id, name: String, email: { type: String, unique: true, index: true }, password_hash: String, created_at: String });
export const Session = model('PulseSession', { token: { type: String, unique: true, index: true }, user_id: { type: String, index: true }, expires_at: String, created_at: String });
export const Company = model('PulseCompany', { id, name: String, created_at: String, address: { type: String, default: '' }, paused: { type: Boolean, default: false } });
export const CompanyMember = model('PulseCompanyMember', {
  company_id: { type: String, index: true }, user_id: { type: String, index: true }, role: String,
  created_at: String, can_invite: { type: Boolean, default: false },
}, [[{ company_id: 1, user_id: 1 }, { unique: true }]]);
export const Invitation = model('PulseInvitation', {
  id, token: { type: String, unique: true, index: true }, kind: String, email: { type: String, index: true },
  company_name: String, company_id: { type: String, default: null, index: true }, invited_by: String,
  status: { type: String, default: 'pending', index: true }, expires_at: String, created_at: String,
  can_invite: { type: Boolean, default: false }, company_address: { type: String, default: '' },
});
export const RegisterOtp = model('PulseRegisterOtp', { email: { type: String, unique: true }, name: String, otp_hash: String, verified: Boolean, expires_at: String, created_at: String });
export const ResetOtp = model('PulseResetOtp', { email: { type: String, unique: true }, otp_hash: String, verified: Boolean, expires_at: String, created_at: String });
export const AdminNotification = model('PulseAdminNotification', {
  id, company_id: String, company_name: { type: String, default: '' }, project_id: String, issue_id: String,
  title: String, message: String, read_at: { type: String, default: null }, created_at: String,
}, [[{ issue_id: 1, read_at: 1, created_at: -1 }, {}], [{ company_id: 1, created_at: -1 }, {}]]);

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required to start the Pulse API.');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || 'pulse' });
  await Promise.all(Object.values(mongoose.models).map((registeredModel) => registeredModel.init()));
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
