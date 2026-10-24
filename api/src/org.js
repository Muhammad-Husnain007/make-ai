import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { sendInviteEmail } from '@pulse/agent';
import { AdminNotification, Company, CompanyMember, Invitation, Issue, Project, Session, User } from './db.js';
import { createProject } from './store.js';
import { stripPasswordFields } from './safeJson.js';

export const PLATFORM_OWNER_EMAIL = 'hasnainilyas007@gmail.com';
export const PR_PRICE_USD = 0.05;
const INVITE_MS = 14 * 24 * 60 * 60 * 1000;
const publicAppUrl = (origin) => String(origin || process.env.DASHBOARD_URL || '').replace(/\/$/, '');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const fail = (message, statusCode) => { const err = new Error(message); err.statusCode = statusCode; throw err; };
const parseFlag = (value) => value === true || value === 1 || value === '1' || /^(true|yes|on)$/i.test(String(value || '').trim());
function validEmail(email) {
  const value = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 160) fail('Enter a valid email address.', 400);
  return value;
}
export function isPlatformOwner(email) { return normalizeEmail(email) === PLATFORM_OWNER_EMAIL; }
export async function hydrateUser(user) {
  if (!user) return null;
  const memberships = await CompanyMember.find({ user_id: user.id }).sort({ created_at: 1 }).lean();
  const companies = await Company.find({ id: { $in: memberships.map((m) => m.company_id) } }).lean();
  const byId = new Map(companies.map((c) => [c.id, c]));
  const membershipsView = memberships.filter((m) => byId.has(m.company_id)).map((m) => ({ id: m.company_id, name: byId.get(m.company_id).name, role: m.role, canInvite: m.role === 'owner' || Boolean(m.can_invite) }));
  const company = membershipsView[0] || null; const platformOwner = isPlatformOwner(user.email);
  return stripPasswordFields({ id: user.id, name: user.name, email: user.email, createdAt: user.created_at, platformOwner, company, companies: membershipsView, canInviteCompanies: platformOwner, canInviteMembers: Boolean(company?.canInvite) });
}
export async function canSignIn(user) { const hydrated = user?.platformOwner != null ? user : await hydrateUser(user); return Boolean(hydrated?.platformOwner || hydrated?.company); }
export async function scopeFromUser(user) {
  const hydrated = user?.platformOwner != null ? user : await hydrateUser(user);
  if (hydrated?.platformOwner) return { all: true, projectIds: null, companyIds: hydrated.companies.map((item) => item.id) };
  const companyIds = (hydrated?.companies || []).map((item) => item.id);
  const projects = await Project.find({ company_id: { $in: companyIds } }, { id: 1 }).lean();
  return { all: false, projectIds: projects.map((p) => p.id), companyIds };
}
export async function canAccessProject(user, projectId) { const scope = await scopeFromUser(user); return scope.all || scope.projectIds.includes(projectId); }
export async function roomsForUser(user) {
  const hydrated = user?.platformOwner != null ? user : await hydrateUser(user);
  return hydrated?.platformOwner ? ['platform'] : (hydrated?.companies || []).map((item) => `company:${item.id}`);
}
export function roomsForProject(project) { const rooms = ['platform']; if (project?.company_id) rooms.push(`company:${project.company_id}`); return rooms; }

async function serializeInvite(row) {
  if (!row) return null;
  const user = await User.findOne({ email: normalizeEmail(row.email) }, { id: 1 }).lean();
  const company = row.company_id ? await Company.findOne({ id: row.company_id }, { name: 1 }).lean() : null;
  const invitedBy = row.invited_by ? await User.findOne({ id: row.invited_by }, { name: 1 }).lean() : null;
  const status = row.status === 'pending' && row.expires_at < new Date().toISOString() ? 'expired' : row.status;
  return { id: row.id, token: row.token, kind: row.kind, email: row.email, companyName: company?.name || row.company_name, companyId: row.company_id || null, invitedByName: invitedBy?.name || '', canInvite: Boolean(row.can_invite), status, expiresAt: row.expires_at, createdAt: row.created_at, registered: Boolean(user), inviteUrl: `${publicAppUrl()}/invitations/${row.token}` };
}
async function expireInvites() { await Invitation.updateMany({ status: 'pending', expires_at: { $lt: new Date().toISOString() } }, { $set: { status: 'expired' } }); }
export async function pendingInviteForEmail(email) { await expireInvites(); return Invitation.findOne({ email: normalizeEmail(email), status: 'pending', expires_at: { $gte: new Date().toISOString() } }).sort({ kind: 1, created_at: -1 }).lean(); }
export async function declineInvite(token) {
  await expireInvites(); const row = await Invitation.findOne({ token }).lean();
  if (!row) fail('Invitation not found.', 404);
  if (row.status === 'declined') return serializeInvite(row);
  if (row.status !== 'pending') fail('This invitation can no longer be declined.', 400);
  await Invitation.updateOne({ id: row.id }, { $set: { status: 'declined' } }); return serializeInvite({ ...row, status: 'declined' });
}
export async function getInvite(token) {
  await expireInvites(); const row = await Invitation.findOne({ token }).lean();
  return row ? serializeInvite(row) : null;
}
async function sendInvite({ email, kind, companyName, invitedBy, origin, token }) {
  const inviteUrl = `${publicAppUrl(origin)}/invitations/${token}`;
  const mailed = await sendInviteEmail({ to: email, inviteUrl, companyName, kind, invitedBy: invitedBy.name }).catch((error) => ({ ok: false, reason: error.message }));
  return { inviteUrl, mailed };
}
export async function inviteCompany({ actor, companyName, email, address, origin }) {
  if (!isPlatformOwner(actor.email)) fail('Only the Pulse owner can invite companies.', 403);
  const name = String(companyName || '').trim().slice(0, 80); if (name.length < 2) fail('Company name must be at least 2 characters.', 400);
  const to = validEmail(email); if (isPlatformOwner(to)) fail('The Pulse owner already has platform access.', 400);
  await expireInvites();
  if (await Invitation.exists({ email: to, kind: 'company', company_id: null, status: 'pending' })) fail('A pending company invitation already exists for this email.', 409);
  const token = randomBytes(24).toString('hex'); const now = new Date();
  const invitation = { id: nanoid(), token, kind: 'company', email: to, company_name: name, company_id: null, invited_by: actor.id, status: 'pending', expires_at: new Date(now.getTime() + INVITE_MS).toISOString(), created_at: now.toISOString(), can_invite: false, company_address: String(address || '').trim().slice(0, 200) };
  await Invitation.create(invitation);
  const delivery = await sendInvite({ email: to, kind: 'company', companyName: name, invitedBy: actor, origin, token });
  return { invite: await serializeInvite(invitation), ...delivery };
}
export async function resendInvite({ actor, inviteId, origin }) {
  const hydrated = await hydrateUser(actor); const row = await Invitation.findOne({ id: inviteId }).lean();
  if (!row) fail('Invitation not found.', 404);
  if (row.status !== 'pending') fail('Only pending invitations can be resent.', 400);
  if (row.kind === 'company' && !hydrated.platformOwner) fail('Only the Pulse owner can resend company invitations.', 403);
  if (row.kind === 'member' && (!hydrated.canInviteMembers || hydrated.company.id !== row.company_id)) fail('You cannot resend this invitation.', 403);
  const delivery = await sendInvite({ email: row.email, kind: row.kind, companyName: row.company_name, invitedBy: actor, origin, token: row.token });
  return { invite: await serializeInvite(row), ...delivery };
}
export async function inviteMember({ actor, email, origin, canInvite = false }) {
  const hydrated = await hydrateUser(actor); if (!hydrated?.canInviteMembers) fail('You cannot invite members.', 403);
  const to = validEmail(email); if (to === normalizeEmail(actor.email)) fail('You already own this dashboard.', 400);
  const companyId = hydrated.company.id;
  const user = await User.findOne({ email: to }, { id: 1 }).lean();
  if (user && await CompanyMember.exists({ user_id: user.id, company_id: companyId })) fail('This person is already a member.', 409);
  await expireInvites();
  if (await Invitation.exists({ email: to, kind: 'member', company_id: companyId, status: 'pending' })) fail('A pending member invitation already exists for this email.', 409);
  const token = randomBytes(24).toString('hex'); const now = new Date();
  const invitation = { id: nanoid(), token, kind: 'member', email: to, company_name: hydrated.company.name, company_id: companyId, invited_by: actor.id, status: 'pending', expires_at: new Date(now.getTime() + INVITE_MS).toISOString(), created_at: now.toISOString(), can_invite: hydrated.company.role === 'owner' && parseFlag(canInvite), company_address: '' };
  await Invitation.create(invitation);
  const delivery = await sendInvite({ email: to, kind: 'member', companyName: hydrated.company.name, invitedBy: actor, origin, token });
  return { invite: await serializeInvite(invitation), ...delivery };
}
export async function removeMember({ actor, userId }) {
  const hydrated = await hydrateUser(actor); if (!hydrated?.canInviteMembers) fail('You cannot remove members.', 403);
  const targetId = String(userId || '').trim(); if (!targetId) fail('Member not found.', 404); if (targetId === actor.id) fail('You cannot remove yourself.', 400);
  const membership = await CompanyMember.findOne({ company_id: hydrated.company.id, user_id: targetId }).lean();
  if (!membership) fail('Member not found.', 404); if (membership.role === 'owner') fail('The company owner cannot be removed.', 403);
  await Promise.all([CompanyMember.deleteOne({ _id: membership._id }), Session.deleteMany({ user_id: targetId })]);
  return { ok: true, userId: targetId };
}
export async function revokeInvite({ actor, inviteId }) {
  const hydrated = await hydrateUser(actor); const row = await Invitation.findOne({ id: inviteId }).lean();
  if (!row) fail('Invitation not found.', 404); if (row.status !== 'pending') fail('Only pending invitations can be cancelled.', 400);
  if (row.kind === 'company' && !hydrated.platformOwner) fail('Only the Pulse owner can cancel company invitations.', 403);
  if (row.kind === 'member' && (!hydrated.canInviteMembers || hydrated.company.id !== row.company_id)) fail('You cannot cancel this invitation.', 403);
  await Invitation.updateOne({ id: row.id }, { $set: { status: 'revoked' } }); return { ok: true, inviteId: row.id };
}
export async function acceptInvite(token, user) {
  const row = await Invitation.findOne({ token }).lean(); if (!row) fail('Invitation not found.', 404);
  if (user && normalizeEmail(user.email) !== normalizeEmail(row.email)) fail(`Sign in as ${row.email} to accept this invitation.`, 403);
  const account = user || await User.findOne({ email: normalizeEmail(row.email) }).lean();
  if (!account) { const err = new Error('Register with this email to accept this invitation.'); err.statusCode = 409; err.needsRegister = true; throw err; }
  if (row.status === 'accepted') { if (normalizeEmail(account.email) === normalizeEmail(row.email)) return hydrateUser(account); fail('This invitation was already accepted.', 409); }
  if (row.status !== 'pending' || row.expires_at < new Date().toISOString()) fail('This invitation has expired.', 410);
  if (row.kind === 'company') {
    if (await CompanyMember.exists({ user_id: account.id })) fail('You already belong to a company.', 409);
    const company = { id: nanoid(), name: String(row.company_name || 'Company').trim(), created_at: new Date().toISOString(), address: String(row.company_address || '').trim().slice(0, 200), paused: false };
    await Company.create(company);
    await CompanyMember.create({ company_id: company.id, user_id: account.id, role: 'owner', created_at: company.created_at, can_invite: true });
    await createProject(company.name, row.email, company.id);
  } else {
    if (!row.company_id || !await Company.exists({ id: row.company_id })) fail('Company no longer exists.', 404);
    if (await CompanyMember.exists({ company_id: row.company_id, user_id: account.id })) fail('You are already a member of this company.', 409);
    await CompanyMember.create({ company_id: row.company_id, user_id: account.id, role: 'member', created_at: new Date().toISOString(), can_invite: Boolean(row.can_invite) });
  }
  await Invitation.updateOne({ id: row.id }, { $set: { status: 'accepted' } }); return hydrateUser(account);
}

async function companySummaries(companies) {
  return Promise.all(companies.map(async (company) => {
    const memberships = await CompanyMember.find({ company_id: company.id }).lean();
    const owners = memberships.filter((m) => m.role === 'owner');
    const owner = owners[0] ? await User.findOne({ id: owners[0].user_id }).lean() : null;
    const projectIds = (await Project.find({ company_id: company.id }, { id: 1 }).lean()).map((p) => p.id);
    const pullRequests = await Issue.countDocuments({ project_id: { $in: projectIds }, pr_url: { $exists: true, $ne: '' } });
    return { ...company, owner_email: owner?.email || '', owner_name: owner?.name || '', member_count: memberships.length, pull_count: pullRequests };
  }));
}
export async function listTeam(actor) {
  const hydrated = await hydrateUser(actor); const companies = await Company.find().sort({ created_at: -1 }).lean();
  if (hydrated.platformOwner) {
    const rows = await Invitation.find({ kind: 'company' }).sort({ created_at: -1 }).lean();
    return { companies: await companySummaries(companies), invites: await Promise.all(rows.map(serializeInvite)), members: [] };
  }
  if (!hydrated.company) return { companies: [], invites: [], members: [] };
  const rows = await Invitation.find({ kind: 'member', company_id: hydrated.company.id }).sort({ created_at: -1 }).lean();
  const memberships = await CompanyMember.find({ company_id: hydrated.company.id }).sort({ role: 1 }).lean();
  const members = await Promise.all(memberships.map(async (membership) => {
    const user = await User.findOne({ id: membership.user_id }).lean();
    return user && { id: user.id, name: user.name, email: user.email, role: membership.role, can_invite: Boolean(membership.can_invite), created_at: membership.created_at };
  }));
  return { companies: await companySummaries(companies.filter((c) => c.id === hydrated.company.id)), invites: await Promise.all(rows.map(serializeInvite)), members: members.filter(Boolean) };
}
function requirePlatformOwner(actor) { if (!isPlatformOwner(actor?.email)) fail('Only the Pulse owner can access this.', 403); }
const money = (pulls) => Number((Number(pulls || 0) * PR_PRICE_USD).toFixed(2));
async function unreadForCompany(companyId) { return AdminNotification.countDocuments({ ...(companyId ? { company_id: companyId } : {}), read_at: null }); }
async function serializeAdminCompany(row) {
  return { id: row.id, name: row.name, address: row.address || '', email: row.owner_email || '', ownerName: row.owner_name || '', memberCount: Number(row.member_count || 0), paused: Boolean(row.paused), pullRequests: Number(row.pull_count || 0), pricePerPull: PR_PRICE_USD, totalCost: money(row.pull_count), createdAt: row.created_at, unreadNotifications: await unreadForCompany(row.id) };
}
export async function isCompanyPaused(companyId) { if (!companyId) return false; const c = await Company.findOne({ id: companyId }, { paused: 1 }).lean(); return Boolean(c?.paused); }
export async function adminOverview(actor) {
  requirePlatformOwner(actor); await expireInvites(); const rows = await companySummaries(await Company.find().lean()); const companies = await Promise.all(rows.map(serializeAdminCompany));
  const pullRequests = companies.reduce((sum, c) => sum + c.pullRequests, 0);
  return { companies: companies.length, activeCompanies: companies.filter((c) => !c.paused).length, pausedCompanies: companies.filter((c) => c.paused).length, pullRequests, pricePerPull: PR_PRICE_USD, revenue: money(pullRequests), pendingInvites: await Invitation.countDocuments({ kind: 'company', status: 'pending' }) };
}
export async function listAdminCompanies(actor) { requirePlatformOwner(actor); return Promise.all((await companySummaries(await Company.find().sort({ created_at: -1 }).lean())).map(serializeAdminCompany)); }
function serializeAdminNotification(row) { return { id: row.id, companyId: row.company_id || null, companyName: row.company_name || '', projectId: row.project_id || null, issueId: row.issue_id || null, title: row.title, message: row.message, readAt: row.read_at || null, createdAt: row.created_at }; }
export async function listAdminNotifications(actor, { companyId } = {}) {
  requirePlatformOwner(actor); const query = companyId ? { company_id: companyId } : {};
  const [rows, unread] = await Promise.all([AdminNotification.find(query).sort({ created_at: -1 }).limit(100).lean(), AdminNotification.countDocuments({ ...query, read_at: null })]);
  return { notifications: rows.map(serializeAdminNotification), unread };
}
export async function markAdminNotificationRead(actor, id) { requirePlatformOwner(actor); await AdminNotification.updateOne({ id, read_at: null }, { $set: { read_at: new Date().toISOString() } }); return listAdminNotifications(actor); }
export async function markAllAdminNotificationsRead(actor) { requirePlatformOwner(actor); await AdminNotification.updateMany({ read_at: null }, { $set: { read_at: new Date().toISOString() } }); return listAdminNotifications(actor); }
export async function getAdminCompany(actor, id) {
  requirePlatformOwner(actor); const row = (await companySummaries(await Company.find({ id }).lean()))[0]; if (!row) fail('Company not found.', 404);
  const notes = await listAdminNotifications(actor, { companyId: id }); return { ...(await serializeAdminCompany(row)), unreadNotifications: notes.unread, notifications: notes.notifications };
}
export async function setCompanyPaused(actor, id, paused) {
  requirePlatformOwner(actor); const row = await Company.findOne({ id }).lean(); if (!row) fail('Company not found.', 404);
  await Company.updateOne({ id }, { $set: { paused: Boolean(paused) } }); const updated = (await companySummaries(await Company.find({ id }).lean()))[0]; return serializeAdminCompany(updated);
}
