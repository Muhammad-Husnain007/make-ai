import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { db } from './db.js';
import { createProject } from './store.js';
import { enqueueInvite } from './queue.js';
import { stripPasswordFields } from './safeJson.js';

export const PLATFORM_OWNER_EMAIL = 'hasnainilyas007@gmail.com';
export const PR_PRICE_USD = 0.05;
const INVITE_MS = 14 * 24 * 60 * 60 * 1000;

function publicAppUrl(origin) {
  return String(origin || process.env.DASHBOARD_URL || '').replace(/\/$/, '');
}

const stmts = {
  insertCompany: db.prepare('INSERT INTO companies (id, name, created_at) VALUES (?, ?, ?)'),
  companyById: db.prepare('SELECT * FROM companies WHERE id = ?'),
  insertMember: db.prepare('INSERT INTO company_members (company_id, user_id, role, created_at, can_invite) VALUES (?, ?, ?, ?, ?)'),
  memberships: db.prepare(`
    SELECT m.company_id, m.role, m.can_invite, m.created_at, c.name AS company_name
    FROM company_members m
    JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = ?
    ORDER BY m.created_at ASC
  `),
  memberOf: db.prepare('SELECT * FROM company_members WHERE company_id = ? AND user_id = ?'),
  deleteMember: db.prepare('DELETE FROM company_members WHERE company_id = ? AND user_id = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  revokeInvite: db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?"),
  inviteById: db.prepare(`
    SELECT i.*, u.name AS invited_by_name, u.email AS invited_by_email, c.name AS live_company_name
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    LEFT JOIN companies c ON c.id = i.company_id
    WHERE i.id = ?
  `),
  members: db.prepare(`
    SELECT u.id, u.name, u.email, m.role, m.can_invite, m.created_at
    FROM company_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.company_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.name
  `),
  insertInvite: db.prepare(`
    INSERT INTO invitations (id, token, kind, email, company_name, company_id, invited_by, status, expires_at, created_at, can_invite)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `),
  inviteByToken: db.prepare(`
    SELECT i.*, u.name AS invited_by_name, u.email AS invited_by_email, c.name AS live_company_name
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    LEFT JOIN companies c ON c.id = i.company_id
    WHERE i.token = ?
  `),
  pendingInvite: db.prepare(`
    SELECT * FROM invitations
    WHERE email = ? AND kind = ? AND IFNULL(company_id, '') = IFNULL(?, '') AND status = 'pending'
  `),
  pendingByEmail: db.prepare(`
    SELECT * FROM invitations
    WHERE email = ? AND status = 'pending' AND expires_at >= ?
    ORDER BY CASE kind WHEN 'company' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `),
  userByEmail: db.prepare('SELECT id, name, email, created_at FROM users WHERE email = ?'),
  declineInvite: db.prepare("UPDATE invitations SET status = 'declined' WHERE id = ?"),
  markAccepted: db.prepare("UPDATE invitations SET status = 'accepted' WHERE id = ?"),
  expireOld: db.prepare("UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at < ?"),
  listCompanyInvites: db.prepare(`
    SELECT i.*, u.name AS invited_by_name
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    WHERE i.kind = 'company'
    ORDER BY i.created_at DESC
  `),
  listMemberInvites: db.prepare(`
    SELECT i.*, u.name AS invited_by_name
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    WHERE i.kind = 'member' AND i.company_id = ?
    ORDER BY i.created_at DESC
  `),
  listCompanies: db.prepare(`
    SELECT c.*,
      (SELECT u.email FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = c.id AND m.role = 'owner' LIMIT 1) AS owner_email,
      (SELECT u.name FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = c.id AND m.role = 'owner' LIMIT 1) AS owner_name,
      (SELECT COUNT(*) FROM company_members m WHERE m.company_id = c.id) AS member_count,
      (
        SELECT COUNT(*) FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.company_id = c.id AND i.pr_url IS NOT NULL AND trim(i.pr_url) != ''
      ) AS pull_count
    FROM companies c
    ORDER BY c.created_at DESC
  `),
  companyAdminById: db.prepare(`
    SELECT c.*,
      (SELECT u.email FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = c.id AND m.role = 'owner' LIMIT 1) AS owner_email,
      (SELECT u.name FROM company_members m JOIN users u ON u.id = m.user_id WHERE m.company_id = c.id AND m.role = 'owner' LIMIT 1) AS owner_name,
      (SELECT COUNT(*) FROM company_members m WHERE m.company_id = c.id) AS member_count,
      (
        SELECT COUNT(*) FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.company_id = c.id AND i.pr_url IS NOT NULL AND trim(i.pr_url) != ''
      ) AS pull_count
    FROM companies c
    WHERE c.id = ?
  `),
  setPaused: db.prepare('UPDATE companies SET paused = ? WHERE id = ?'),
  setAddress: db.prepare('UPDATE companies SET address = ? WHERE id = ?'),
  setInviteAddress: db.prepare('UPDATE invitations SET company_address = ? WHERE token = ?'),
  pendingCompanyInvites: db.prepare("SELECT COUNT(*) AS n FROM invitations WHERE kind = 'company' AND status = 'pending'"),
  projectIdsForCompanies: db.prepare('SELECT id FROM projects WHERE company_id = ?'),
  projectCompany: db.prepare('SELECT id, company_id FROM projects WHERE id = ?'),
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  const value = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 160) {
    const err = new Error('Enter a valid email address.');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function parseFlag(value) {
  if (value === true || value === 1 || value === '1') return 1;
  return /^(true|yes|on)$/i.test(String(value || '').trim()) ? 1 : 0;
}

function fail(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  throw err;
}

export function isPlatformOwner(email) {
  return normalizeEmail(email) === PLATFORM_OWNER_EMAIL;
}

export function canSignIn(user) {
  const hydrated = user?.platformOwner != null ? user : hydrateUser(user);
  return Boolean(hydrated?.platformOwner || hydrated?.company);
}

export function hydrateUser(user) {
  if (!user) return null;
  stmts.expireOld.run(new Date().toISOString());
  const platformOwner = isPlatformOwner(user.email);
  const memberships = stmts.memberships.all(user.id).map((row) => ({
    id: row.company_id,
    name: row.company_name,
    role: row.role,
    canInvite: row.role === 'owner' || Boolean(row.can_invite),
  }));
  const company = memberships[0] || null;
  return stripPasswordFields({
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at,
    platformOwner,
    company,
    companies: memberships,
    canInviteCompanies: platformOwner,
    canInviteMembers: Boolean(company?.canInvite),
  });
}

export function scopeFromUser(user) {
  const hydrated = user?.platformOwner != null ? user : hydrateUser(user);
  if (hydrated?.platformOwner) return { all: true, projectIds: null, companyIds: hydrated.companies.map((item) => item.id) };
  const companyIds = (hydrated?.companies || []).map((item) => item.id);
  const projectIds = companyIds.flatMap((id) => stmts.projectIdsForCompanies.all(id).map((row) => row.id));
  return { all: false, projectIds, companyIds };
}

export function canAccessProject(user, projectId) {
  const scope = scopeFromUser(user);
  if (scope.all) return true;
  return scope.projectIds.includes(projectId);
}

export function roomsForUser(user) {
  const hydrated = user?.platformOwner != null ? user : hydrateUser(user);
  if (hydrated?.platformOwner) return ['platform'];
  return (hydrated?.companies || []).map((item) => `company:${item.id}`);
}

export function roomsForProject(project) {
  const rooms = ['platform'];
  if (project?.company_id) rooms.push(`company:${project.company_id}`);
  return rooms;
}

function serializeInvite(row) {
  if (!row) return null;
  const expired = row.status === 'pending' && row.expires_at < new Date().toISOString();
  const status = expired ? 'expired' : row.status;
  return {
    id: row.id,
    token: row.token,
    kind: row.kind,
    email: row.email,
    companyName: row.live_company_name || row.company_name,
    companyId: row.company_id,
    invitedByName: row.invited_by_name,
    canInvite: Boolean(row.can_invite),
    status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    registered: Boolean(stmts.userByEmail.get(normalizeEmail(row.email))),
    inviteUrl: `${publicAppUrl()}/invite/${row.token}`,
  };
}

export function pendingInviteForEmail(email) {
  stmts.expireOld.run(new Date().toISOString());
  const row = stmts.pendingByEmail.get(normalizeEmail(email), new Date().toISOString());
  return row || null;
}

export function declineInvite(token) {
  stmts.expireOld.run(new Date().toISOString());
  const row = stmts.inviteByToken.get(token);
  if (!row) fail('Invitation not found.', 404);
  if (row.status === 'declined') return serializeInvite({ ...row, status: 'declined' });
  if (row.status !== 'pending') fail('This invitation can no longer be declined.', 400);
  stmts.declineInvite.run(row.id);
  return serializeInvite({ ...row, status: 'declined' });
}

export function getInvite(token) {
  stmts.expireOld.run(new Date().toISOString());
  const row = stmts.inviteByToken.get(token);
  if (!row) return null;
  if (row.status === 'pending' && row.expires_at < new Date().toISOString()) {
    db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ?").run(row.id);
    return serializeInvite({ ...row, status: 'expired' });
  }
  return serializeInvite(row);
}

async function sendInvite({ email, kind, companyName, invitedBy, origin, token }) {
  const inviteUrl = `${publicAppUrl(origin)}/invite/${token}`;
  const mailed = await enqueueInvite({
    to: email,
    inviteUrl,
    companyName,
    kind,
    invitedBy: invitedBy.name,
  }).catch((error) => ({ ok: false, reason: error.message }));
  return { inviteUrl, mailed };
}

export async function inviteCompany({ actor, companyName, email, address, origin }) {
  if (!isPlatformOwner(actor.email)) fail('Only the Pulse owner can invite companies.', 403);
  const name = String(companyName || '').trim().slice(0, 80);
  if (name.length < 2) fail('Company name must be at least 2 characters.', 400);
  const to = validEmail(email);
  if (isPlatformOwner(to)) fail('The Pulse owner already has platform access.', 400);
  const companyAddress = String(address || '').trim().slice(0, 200);
  stmts.expireOld.run(new Date().toISOString());
  if (stmts.pendingInvite.get(to, 'company', '')) fail('A pending company invitation already exists for this email.', 409);
  const token = randomBytes(24).toString('hex');
  const now = new Date();
  stmts.insertInvite.run(
    nanoid(),
    token,
    'company',
    to,
    name,
    null,
    actor.id,
    new Date(now.getTime() + INVITE_MS).toISOString(),
    now.toISOString(),
    0,
  );
  if (companyAddress) stmts.setInviteAddress.run(companyAddress, token);
  const delivery = await sendInvite({ email: to, kind: 'company', companyName: name, invitedBy: actor, origin, token });
  return { invite: getInvite(token), ...delivery };
}

export async function resendInvite({ actor, inviteId, origin }) {
  const hydrated = hydrateUser(actor);
  const row = db.prepare(`
    SELECT i.*, u.name AS invited_by_name, u.email AS invited_by_email, c.name AS live_company_name
    FROM invitations i
    JOIN users u ON u.id = i.invited_by
    LEFT JOIN companies c ON c.id = i.company_id
    WHERE i.id = ?
  `).get(inviteId);
  if (!row) fail('Invitation not found.', 404);
  if (row.status !== 'pending') fail('Only pending invitations can be resent.', 400);
  if (row.kind === 'company' && !hydrated.platformOwner) fail('Only the Pulse owner can resend company invitations.', 403);
  if (row.kind === 'member') {
    if (!hydrated.canInviteMembers || hydrated.company.id !== row.company_id) {
      fail('You cannot resend this invitation.', 403);
    }
  }
  const delivery = await sendInvite({
    email: row.email,
    kind: row.kind,
    companyName: row.live_company_name || row.company_name,
    invitedBy: actor,
    origin,
    token: row.token,
  });
  return { invite: serializeInvite(row), ...delivery };
}

export async function inviteMember({ actor, email, origin, canInvite = false }) {
  const hydrated = hydrateUser(actor);
  if (!hydrated?.canInviteMembers) fail('You cannot invite members.', 403);
  const to = validEmail(email);
  if (to === normalizeEmail(actor.email)) fail('You already own this dashboard.', 400);
  const companyId = hydrated.company.id;
  if (db.prepare('SELECT 1 FROM users u JOIN company_members m ON m.user_id = u.id WHERE u.email = ? AND m.company_id = ?').get(to, companyId)) {
    fail('This person is already a member.', 409);
  }
  stmts.expireOld.run(new Date().toISOString());
  if (stmts.pendingInvite.get(to, 'member', companyId)) fail('A pending member invitation already exists for this email.', 409);
  const grantInvite = hydrated.company.role === 'owner' ? parseFlag(canInvite) : 0;
  const token = randomBytes(24).toString('hex');
  const now = new Date();
  stmts.insertInvite.run(
    nanoid(),
    token,
    'member',
    to,
    hydrated.company.name,
    companyId,
    actor.id,
    new Date(now.getTime() + INVITE_MS).toISOString(),
    now.toISOString(),
    grantInvite,
  );
  const delivery = await sendInvite({
    email: to,
    kind: 'member',
    companyName: hydrated.company.name,
    invitedBy: actor,
    origin,
    token,
  });
  return { invite: getInvite(token), ...delivery };
}

export function removeMember({ actor, userId }) {
  const hydrated = hydrateUser(actor);
  if (!hydrated?.canInviteMembers) fail('You cannot remove members.', 403);
  const targetId = String(userId || '').trim();
  if (!targetId) fail('Member not found.', 404);
  if (targetId === actor.id) fail('You cannot remove yourself.', 400);
  const companyId = hydrated.company.id;
  const membership = stmts.memberOf.get(companyId, targetId);
  if (!membership) fail('Member not found.', 404);
  if (membership.role === 'owner') fail('The company owner cannot be removed.', 403);
  stmts.deleteMember.run(companyId, targetId);
  stmts.deleteUserSessions.run(targetId);
  return { ok: true, userId: targetId };
}

export function revokeInvite({ actor, inviteId }) {
  const hydrated = hydrateUser(actor);
  const row = stmts.inviteById.get(inviteId);
  if (!row) fail('Invitation not found.', 404);
  if (row.status !== 'pending') fail('Only pending invitations can be cancelled.', 400);
  if (row.kind === 'company' && !hydrated.platformOwner) fail('Only the Pulse owner can cancel company invitations.', 403);
  if (row.kind === 'member') {
    if (!hydrated.canInviteMembers || hydrated.company.id !== row.company_id) {
      fail('You cannot cancel this invitation.', 403);
    }
  }
  stmts.revokeInvite.run(row.id);
  return { ok: true, inviteId: row.id };
}

export function acceptInvite(token, user) {
  const row = stmts.inviteByToken.get(token);
  if (!row) fail('Invitation not found.', 404);
  if (user && normalizeEmail(user.email) !== normalizeEmail(row.email)) {
    fail(`Sign in as ${row.email} to accept this invitation.`, 403);
  }
  const account = user || stmts.userByEmail.get(normalizeEmail(row.email));
  if (!account) {
    const err = new Error('Register with this email to accept this invitation.');
    err.statusCode = 409;
    err.needsRegister = true;
    throw err;
  }
  if (row.status === 'accepted') {
    if (normalizeEmail(account.email) === normalizeEmail(row.email)) return hydrateUser(account);
    fail('This invitation was already accepted.', 409);
  }
  if (row.status !== 'pending' || row.expires_at < new Date().toISOString()) fail('This invitation has expired.', 410);
  const now = new Date().toISOString();
  if (row.kind === 'company') {
    if (stmts.memberships.all(account.id).length) fail('You already belong to a company.', 409);
    const companyId = nanoid();
    const companyName = String(row.company_name || 'Company').trim();
    stmts.insertCompany.run(companyId, companyName, now);
    stmts.insertMember.run(companyId, account.id, 'owner', now, 1);
    if (row.company_address) stmts.setAddress.run(String(row.company_address).trim().slice(0, 200), companyId);
    createProject(companyName, row.email, companyId);
  } else {
    if (!row.company_id || !stmts.companyById.get(row.company_id)) fail('Company no longer exists.', 404);
    if (stmts.memberOf.get(row.company_id, account.id)) fail('You are already a member of this company.', 409);
    stmts.insertMember.run(row.company_id, account.id, 'member', now, row.can_invite ? 1 : 0);
  }
  stmts.markAccepted.run(row.id);
  return hydrateUser(account);
}

export function listTeam(actor) {
  const hydrated = hydrateUser(actor);
  if (hydrated.platformOwner) {
    return {
      companies: stmts.listCompanies.all(),
      invites: stmts.listCompanyInvites.all().map(serializeInvite),
      members: [],
    };
  }
  if (!hydrated.company) return { companies: [], invites: [], members: [] };
  return {
    companies: stmts.listCompanies.all().filter((row) => row.id === hydrated.company.id),
    invites: stmts.listMemberInvites.all(hydrated.company.id).map(serializeInvite),
    members: stmts.members.all(hydrated.company.id),
  };
}

function requirePlatformOwner(actor) {
  if (!isPlatformOwner(actor?.email)) fail('Only the Pulse owner can access this.', 403);
}

function money(pulls) {
  return Number((Number(pulls || 0) * PR_PRICE_USD).toFixed(2));
}

function unreadForCompany(id) {
  if (!id) return 0;
  return Number(db.prepare('SELECT COUNT(*) AS n FROM admin_notifications WHERE company_id = ? AND read_at IS NULL').get(id)?.n || 0);
}

function serializeAdminCompany(row) {
  if (!row) return null;
  const pullRequests = Number(row.pull_count || 0);
  return {
    id: row.id,
    name: row.name,
    address: row.address || '',
    email: row.owner_email || '',
    ownerName: row.owner_name || '',
    memberCount: Number(row.member_count || 0),
    paused: Boolean(row.paused),
    pullRequests,
    pricePerPull: PR_PRICE_USD,
    totalCost: money(pullRequests),
    createdAt: row.created_at,
    unreadNotifications: unreadForCompany(row.id),
  };
}

export function isCompanyPaused(companyId) {
  if (!companyId) return false;
  return Boolean(stmts.companyById.get(companyId)?.paused);
}

export function adminOverview(actor) {
  requirePlatformOwner(actor);
  stmts.expireOld.run(new Date().toISOString());
  const companies = stmts.listCompanies.all().map(serializeAdminCompany);
  const pullRequests = companies.reduce((sum, company) => sum + company.pullRequests, 0);
  return {
    companies: companies.length,
    activeCompanies: companies.filter((company) => !company.paused).length,
    pausedCompanies: companies.filter((company) => company.paused).length,
    pullRequests,
    pricePerPull: PR_PRICE_USD,
    revenue: money(pullRequests),
    pendingInvites: Number(stmts.pendingCompanyInvites.get()?.n || 0),
  };
}

export function listAdminCompanies(actor) {
  requirePlatformOwner(actor);
  return stmts.listCompanies.all().map(serializeAdminCompany);
}

function serializeAdminNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id || null,
    companyName: row.company_name || '',
    projectId: row.project_id || null,
    issueId: row.issue_id || null,
    title: row.title,
    message: row.message,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

export function listAdminNotifications(actor, { companyId } = {}) {
  requirePlatformOwner(actor);
  const rows = companyId
    ? db.prepare(`
        SELECT * FROM admin_notifications
        WHERE company_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `).all(companyId)
    : db.prepare(`
        SELECT * FROM admin_notifications
        ORDER BY created_at DESC
        LIMIT 100
      `).all();
  const unread = companyId
    ? db.prepare('SELECT COUNT(*) AS n FROM admin_notifications WHERE company_id = ? AND read_at IS NULL').get(companyId)
    : db.prepare('SELECT COUNT(*) AS n FROM admin_notifications WHERE read_at IS NULL').get();
  return {
    notifications: rows.map(serializeAdminNotification),
    unread: Number(unread?.n || 0),
  };
}

export function markAdminNotificationRead(actor, id) {
  requirePlatformOwner(actor);
  db.prepare('UPDATE admin_notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(new Date().toISOString(), id);
  return listAdminNotifications(actor);
}

export function markAllAdminNotificationsRead(actor) {
  requirePlatformOwner(actor);
  db.prepare('UPDATE admin_notifications SET read_at = ? WHERE read_at IS NULL').run(new Date().toISOString());
  return listAdminNotifications(actor);
}

export function getAdminCompany(actor, id) {
  requirePlatformOwner(actor);
  const row = stmts.companyAdminById.get(id);
  if (!row) fail('Company not found.', 404);
  const notes = listAdminNotifications(actor, { companyId: id });
  return {
    ...serializeAdminCompany(row),
    unreadNotifications: notes.unread,
    notifications: notes.notifications,
  };
}

export function setCompanyPaused(actor, id, paused) {
  requirePlatformOwner(actor);
  const row = stmts.companyAdminById.get(id);
  if (!row) fail('Company not found.', 404);
  stmts.setPaused.run(paused ? 1 : 0, id);
  return serializeAdminCompany(stmts.companyAdminById.get(id));
}
