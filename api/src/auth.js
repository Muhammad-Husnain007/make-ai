import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import { sendOtpEmail } from '@pulse/agent';
import { db } from './db.js';
import { acceptInvite, canSignIn, getInvite, hydrateUser, pendingInviteForEmail } from './org.js';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const stmts = {
  insertUser: db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  sessionWithUser: db.prepare(`
    SELECT u.id, u.name, u.email, u.created_at, s.token, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  upsertOtp: db.prepare(`
    INSERT INTO register_otps (email, name, otp_hash, verified, expires_at, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, otp_hash = excluded.otp_hash, verified = 0, expires_at = excluded.expires_at, created_at = excluded.created_at
  `),
  otpByEmail: db.prepare('SELECT * FROM register_otps WHERE email = ?'),
  markOtpVerified: db.prepare('UPDATE register_otps SET verified = 1 WHERE email = ?'),
  deleteOtp: db.prepare('DELETE FROM register_otps WHERE email = ?'),
  upsertResetOtp: db.prepare(`
    INSERT INTO reset_otps (email, otp_hash, verified, expires_at, created_at)
    VALUES (?, ?, 0, ?, ?)
    ON CONFLICT(email) DO UPDATE SET otp_hash = excluded.otp_hash, verified = 0, expires_at = excluded.expires_at, created_at = excluded.created_at
  `),
  resetOtpByEmail: db.prepare('SELECT * FROM reset_otps WHERE email = ?'),
  markResetOtpVerified: db.prepare('UPDATE reset_otps SET verified = 1 WHERE email = ?'),
  deleteResetOtp: db.prepare('DELETE FROM reset_otps WHERE email = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE email = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
};

function serializeUser(user) {
  return hydrateUser(user);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${Buffer.from(key).toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const key = await scryptAsync(password, salt, 64);
  const actual = Buffer.from(key);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateName(name) {
  const value = String(name || '').trim();
  if (value.length < 2 || value.length > 80) {
    const err = new Error('Name must be 2–80 characters.');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function validateEmail(email) {
  const value = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 160) {
    const err = new Error('Enter a valid email address.');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 200) {
    const err = new Error('Password must be at least 8 characters.');
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function createSession(userId) {
  stmts.deleteExpired.run(new Date().toISOString());
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  stmts.insertSession.run(
    token,
    userId,
    new Date(now.getTime() + SESSION_MS).toISOString(),
    now.toISOString(),
  );
  return token;
}

const LOCAL_OTP = '123456';
const OTP_MS = 10 * 60 * 1000;

function isLocalRuntime() {
  return process.env.NODE_ENV !== 'production';
}

function hashOtp(email, otp) {
  return createHash('sha256').update(`${email}:${otp}`).digest('hex');
}

function otpMatches(email, otp, storedHash) {
  const actual = Buffer.from(hashOtp(email, otp), 'hex');
  const expected = Buffer.from(String(storedHash || ''), 'hex');
  return expected.length === actual.length && expected.length > 0 && timingSafeEqual(actual, expected);
}

export async function requestRegisterOtp({ name, email }) {
  const cleanName = validateName(name);
  const cleanEmail = validateEmail(email);
  if (stmts.userByEmail.get(cleanEmail)) {
    const err = new Error('An account with this email already exists.');
    err.statusCode = 409;
    throw err;
  }
  const local = isLocalRuntime();
  const otp = local ? LOCAL_OTP : String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  stmts.upsertOtp.run(
    cleanEmail,
    cleanName,
    hashOtp(cleanEmail, otp),
    new Date(now.getTime() + OTP_MS).toISOString(),
    now.toISOString(),
  );
  if (!local) {
    const mailed = await sendOtpEmail({ to: cleanEmail, otp });
    if (!mailed.ok) {
      const err = new Error(mailed.reason || 'Could not send the verification email.');
      err.statusCode = 502;
      throw err;
    }
  }
  return { ok: true, local, email: cleanEmail };
}

export function verifyRegisterOtp({ email, otp }) {
  const cleanEmail = validateEmail(email);
  const code = String(otp || '').trim();
  const row = stmts.otpByEmail.get(cleanEmail);
  if (!row || row.expires_at < new Date().toISOString()) {
    const err = new Error('Enter a valid verification code.');
    err.statusCode = 400;
    throw err;
  }
  const localOk = isLocalRuntime() && code === LOCAL_OTP;
  if (!localOk && !otpMatches(cleanEmail, code, row.otp_hash)) {
    const err = new Error('Enter a valid verification code.');
    err.statusCode = 400;
    throw err;
  }
  stmts.markOtpVerified.run(cleanEmail);
  return { ok: true, email: cleanEmail };
}

function requireVerifiedOtp(email, otp) {
  const row = stmts.otpByEmail.get(email);
  if (!row || !row.verified || row.expires_at < new Date().toISOString()) {
    const err = new Error('Verify the email code before setting a password.');
    err.statusCode = 400;
    throw err;
  }
  const code = String(otp || '').trim();
  const localOk = isLocalRuntime() && code === LOCAL_OTP;
  if (!localOk && !otpMatches(email, code, row.otp_hash)) {
    const err = new Error('Enter a valid verification code.');
    err.statusCode = 400;
    throw err;
  }
  if (row.name) return row.name;
  return '';
}

export async function registerUser({ name, email, password, inviteToken, otp }) {
  const cleanName = validateName(name);
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(password);
  requireVerifiedOtp(cleanEmail, otp);
  if (inviteToken) {
    const invite = getInvite(inviteToken);
    if (!invite || invite.status !== 'pending') {
      const err = new Error('This invitation is invalid or expired.');
      err.statusCode = 400;
      throw err;
    }
    if (invite.email !== cleanEmail) {
      const err = new Error(`Register with ${invite.email} to accept this invitation.`);
      err.statusCode = 400;
      throw err;
    }
  }
  if (stmts.userByEmail.get(cleanEmail)) {
    const err = new Error('An account with this email already exists.');
    err.statusCode = 409;
    throw err;
  }
  const user = {
    id: nanoid(),
    name: cleanName,
    email: cleanEmail,
    created_at: new Date().toISOString(),
  };
  stmts.insertUser.run(user.id, user.name, user.email, await hashPassword(cleanPassword), user.created_at);
  stmts.deleteOtp.run(cleanEmail);
  const pending = inviteToken ? getInvite(inviteToken) : pendingInviteForEmail(cleanEmail);
  const pendingToken = pending?.status === 'pending' ? pending.token : (inviteToken || pending?.token || null);
  const serialized = serializeUser(user);
  if (!canSignIn(serialized)) {
    return { user: serialized, token: null, needsInvite: true, inviteToken: pendingToken || null };
  }
  return { user: serialized, token: createSession(user.id) };
}

export async function loginUser({ email, password, inviteToken }) {
  const cleanEmail = validateEmail(email);
  const cleanPassword = String(password || '');
  const row = stmts.userByEmail.get(cleanEmail);
  const ok = row ? await verifyPassword(cleanPassword, row.password_hash) : await verifyPassword(cleanPassword, '00:00');
  if (!row || !ok) {
    const err = new Error('Invalid email or password.');
    err.statusCode = 401;
    throw err;
  }
  if (inviteToken) acceptInvite(inviteToken, row);
  const serialized = serializeUser(row);
  if (!canSignIn(serialized)) {
    const pending = pendingInviteForEmail(cleanEmail);
    const err = new Error(pending
      ? 'You have a pending Pulse invitation. Open it to continue.'
      : 'You do not have access yet. Wait for a Pulse invitation.');
    err.statusCode = 403;
    err.inviteToken = pending?.token || null;
    throw err;
  }
  return { user: serialized, token: createSession(row.id) };
}

export async function requestResetOtp({ email }) {
  const cleanEmail = validateEmail(email);
  const user = stmts.userByEmail.get(cleanEmail);
  if (!user) {
    const err = new Error('No account exists with this email.');
    err.statusCode = 404;
    throw err;
  }
  const local = isLocalRuntime();
  const otp = local ? LOCAL_OTP : String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  stmts.upsertResetOtp.run(
    cleanEmail,
    hashOtp(cleanEmail, otp),
    new Date(now.getTime() + OTP_MS).toISOString(),
    now.toISOString(),
  );
  if (!local) {
    const mailed = await sendOtpEmail({ to: cleanEmail, otp });
    if (!mailed.ok) {
      const err = new Error(mailed.reason || 'Could not send the verification email.');
      err.statusCode = 502;
      throw err;
    }
  }
  return { ok: true, local, email: cleanEmail };
}

export function verifyResetOtp({ email, otp }) {
  const cleanEmail = validateEmail(email);
  const code = String(otp || '').trim();
  const row = stmts.resetOtpByEmail.get(cleanEmail);
  if (!row || row.expires_at < new Date().toISOString()) {
    const err = new Error('Enter a valid verification code.');
    err.statusCode = 400;
    throw err;
  }
  const localOk = isLocalRuntime() && code === LOCAL_OTP;
  if (!localOk && !otpMatches(cleanEmail, code, row.otp_hash)) {
    const err = new Error('Enter a valid verification code.');
    err.statusCode = 400;
    throw err;
  }
  stmts.markResetOtpVerified.run(cleanEmail);
  return { ok: true, email: cleanEmail };
}

export async function resetPassword({ email, otp, password }) {
  const cleanEmail = validateEmail(email);
  const cleanPassword = validatePassword(password);
  const row = stmts.resetOtpByEmail.get(cleanEmail);
  if (!row || !row.verified || row.expires_at < new Date().toISOString()) {
    const err = new Error('Verify the email code before setting a new password.');
    err.statusCode = 400;
    throw err;
  }
  const code = String(otp || '').trim();
  const localOk = isLocalRuntime() && code === LOCAL_OTP;
  if (!localOk && !otpMatches(cleanEmail, code, row.otp_hash)) {
    const err = new Error('Enter a valid verification code.');
    err.statusCode = 400;
    throw err;
  }
  const user = stmts.userByEmail.get(cleanEmail);
  if (!user) {
    const err = new Error('No account exists with this email.');
    err.statusCode = 404;
    throw err;
  }
  stmts.updatePassword.run(await hashPassword(cleanPassword), cleanEmail);
  stmts.deleteResetOtp.run(cleanEmail);
  stmts.deleteUserSessions.run(user.id);
  const serialized = serializeUser(user);
  if (!canSignIn(serialized)) {
    return { user: serialized, token: null, needsInvite: true };
  }
  return { user: serialized, token: createSession(user.id) };
}

export function getUserByToken(token) {
  if (!token) return null;
  stmts.deleteExpired.run(new Date().toISOString());
  const row = stmts.sessionWithUser.get(token);
  if (!row || row.expires_at < new Date().toISOString()) {
    if (row) stmts.deleteSession.run(token);
    return null;
  }
  const user = serializeUser(row);
  if (!canSignIn(user)) {
    stmts.deleteUserSessions.run(row.id);
    return null;
  }
  return user;
}

export function logoutToken(token) {
  if (token) stmts.deleteSession.run(token);
}

export function readBearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}
