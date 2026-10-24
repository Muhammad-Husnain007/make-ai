import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { nanoid } from 'nanoid';
import { sendOtpEmail } from '@pulse/agent';
import { RegisterOtp, ResetOtp, Session, User } from './db.js';
import { acceptInvite, canSignIn, getInvite, hydrateUser, pendingInviteForEmail } from './org.js';
import { stripPasswordFields } from './safeJson.js';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_MS = 10 * 60 * 1000;
const plain = (doc) => doc?.toObject ? doc.toObject() : doc;

async function serializeUser(user) { return user ? stripPasswordFields(await hydrateUser(plain(user))) : null; }
async function hashPassword(password) {
  const salt = randomBytes(16); const key = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${Buffer.from(key).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex'); const expected = Buffer.from(hashHex, 'hex');
  const key = await scryptAsync(password, salt, 64); const actual = Buffer.from(key);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function validateName(name) {
  const value = String(name || '').trim();
  if (value.length < 2 || value.length > 80) { const err = new Error('Name must be 2–80 characters.'); err.statusCode = 400; throw err; }
  return value;
}
function validateEmail(email) {
  const value = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 160) { const err = new Error('Enter a valid email address.'); err.statusCode = 400; throw err; }
  return value;
}
function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8 || value.length > 200) { const err = new Error('Password must be at least 8 characters.'); err.statusCode = 400; throw err; }
  return value;
}
async function createSession(userId) {
  const now = new Date(); const token = randomBytes(32).toString('hex');
  await Session.deleteMany({ expires_at: { $lt: now.toISOString() } });
  await Session.create({ token, user_id: userId, expires_at: new Date(now.getTime() + SESSION_MS).toISOString(), created_at: now.toISOString() });
  return token;
}
function hashOtp(email, otp) { return createHash('sha256').update(`${email}:${otp}`).digest('hex'); }
function otpMatches(email, otp, storedHash) {
  const actual = Buffer.from(hashOtp(email, otp), 'hex'); const expected = Buffer.from(String(storedHash || ''), 'hex');
  return expected.length === actual.length && expected.length > 0 && timingSafeEqual(expected, actual);
}
function invalidOtp() { const err = new Error('Enter a valid verification code.'); err.statusCode = 400; return err; }

export async function requestRegisterOtp({ name, email }) {
  const cleanName = validateName(name); const cleanEmail = validateEmail(email);
  if (await User.exists({ email: cleanEmail })) { const err = new Error('An account with this email already exists.'); err.statusCode = 409; throw err; }
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0'); const now = new Date();
  await RegisterOtp.findOneAndUpdate({ email: cleanEmail }, { $set: { name: cleanName, otp_hash: hashOtp(cleanEmail, otp), verified: false, expires_at: new Date(now.getTime() + OTP_MS).toISOString(), created_at: now.toISOString() } }, { upsert: true, new: true });
  const mailed = await sendOtpEmail({ to: cleanEmail, otp });
  if (!mailed.ok) { const err = new Error(mailed.reason || 'Could not send the verification email.'); err.statusCode = 502; throw err; }
  return { ok: true, email: cleanEmail };
}
export async function verifyRegisterOtp({ email, otp }) {
  const cleanEmail = validateEmail(email); const row = await RegisterOtp.findOne({ email: cleanEmail }).lean();
  if (!row || row.expires_at < new Date().toISOString() || !otpMatches(cleanEmail, String(otp || '').trim(), row.otp_hash)) throw invalidOtp();
  await RegisterOtp.updateOne({ email: cleanEmail }, { $set: { verified: true } });
  return { ok: true, email: cleanEmail };
}
async function requireVerifiedOtp(email, otp) {
  const row = await RegisterOtp.findOne({ email }).lean();
  if (!row || !row.verified || row.expires_at < new Date().toISOString()) { const err = new Error('Verify the email code before setting a password.'); err.statusCode = 400; throw err; }
  if (!otpMatches(email, String(otp || '').trim(), row.otp_hash)) throw invalidOtp();
  return row.name || '';
}
export async function registerUser({ name, email, password, inviteToken, otp }) {
  const cleanName = validateName(name); const cleanEmail = validateEmail(email); const cleanPassword = validatePassword(password);
  const otpName = await requireVerifiedOtp(cleanEmail, otp);
  if (inviteToken) {
    const invite = await getInvite(inviteToken);
    if (!invite || invite.status !== 'pending') { const err = new Error('This invitation is invalid or expired.'); err.statusCode = 400; throw err; }
    if (invite.email !== cleanEmail) { const err = new Error(`Register with ${invite.email} to accept this invitation.`); err.statusCode = 400; throw err; }
  }
  if (await User.exists({ email: cleanEmail })) { const err = new Error('An account with this email already exists.'); err.statusCode = 409; throw err; }
  const user = { id: nanoid(), name: cleanName || otpName, email: cleanEmail, password_hash: await hashPassword(cleanPassword), created_at: new Date().toISOString() };
  await User.create(user); await RegisterOtp.deleteOne({ email: cleanEmail });
  const pending = inviteToken ? await getInvite(inviteToken) : await pendingInviteForEmail(cleanEmail);
  const pendingToken = pending?.status === 'pending' ? pending.token : (inviteToken || pending?.token || null);
  const serialized = await serializeUser(user);
  if (!await canSignIn(serialized)) return { user: serialized, token: null, needsInvite: true, inviteToken: pendingToken || null };
  return { user: serialized, token: await createSession(user.id) };
}
export async function loginUser({ email, password, inviteToken }) {
  const cleanEmail = validateEmail(email); const cleanPassword = String(password || ''); const row = await User.findOne({ email: cleanEmail }).lean();
  const ok = row ? await verifyPassword(cleanPassword, row.password_hash) : await verifyPassword(cleanPassword, '00:00');
  if (!row || !ok) { const err = new Error('Invalid email or password.'); err.statusCode = 401; throw err; }
  if (inviteToken) await acceptInvite(inviteToken, row);
  const serialized = await serializeUser(row);
  if (!await canSignIn(serialized)) {
    const pending = await pendingInviteForEmail(cleanEmail); const err = new Error(pending ? 'You have a pending Pulse invitation. Open it to continue.' : 'You do not have access yet. Wait for a Pulse invitation.');
    err.statusCode = 403; err.inviteToken = pending?.token || null; throw err;
  }
  return { user: serialized, token: await createSession(row.id) };
}
export async function requestResetOtp({ email }) {
  const cleanEmail = validateEmail(email); const user = await User.findOne({ email: cleanEmail }).lean();
  if (!user) { const err = new Error('No account exists with this email.'); err.statusCode = 404; throw err; }
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0'); const now = new Date();
  await ResetOtp.findOneAndUpdate({ email: cleanEmail }, { $set: { otp_hash: hashOtp(cleanEmail, otp), verified: false, expires_at: new Date(now.getTime() + OTP_MS).toISOString(), created_at: now.toISOString() } }, { upsert: true });
  const mailed = await sendOtpEmail({ to: cleanEmail, otp });
  if (!mailed.ok) { const err = new Error(mailed.reason || 'Could not send the verification email.'); err.statusCode = 502; throw err; }
  return { ok: true, email: cleanEmail };
}
export async function verifyResetOtp({ email, otp }) {
  const cleanEmail = validateEmail(email); const row = await ResetOtp.findOne({ email: cleanEmail }).lean();
  if (!row || row.expires_at < new Date().toISOString() || !otpMatches(cleanEmail, String(otp || '').trim(), row.otp_hash)) throw invalidOtp();
  await ResetOtp.updateOne({ email: cleanEmail }, { $set: { verified: true } }); return { ok: true, email: cleanEmail };
}
export async function resetPassword({ email, otp, password }) {
  const cleanEmail = validateEmail(email); const cleanPassword = validatePassword(password); const row = await ResetOtp.findOne({ email: cleanEmail }).lean();
  if (!row || !row.verified || row.expires_at < new Date().toISOString()) { const err = new Error('Verify the email code before setting a new password.'); err.statusCode = 400; throw err; }
  if (!otpMatches(cleanEmail, String(otp || '').trim(), row.otp_hash)) throw invalidOtp();
  const user = await User.findOne({ email: cleanEmail }).lean();
  if (!user) { const err = new Error('No account exists with this email.'); err.statusCode = 404; throw err; }
  await User.updateOne({ email: cleanEmail }, { $set: { password_hash: await hashPassword(cleanPassword) } });
  await Promise.all([ResetOtp.deleteOne({ email: cleanEmail }), Session.deleteMany({ user_id: user.id })]);
  const serialized = await serializeUser(user);
  if (!await canSignIn(serialized)) return { user: serialized, token: null, needsInvite: true };
  return { user: serialized, token: await createSession(user.id) };
}
export async function getUserByToken(token) {
  if (!token) return null;
  const now = new Date().toISOString();
  const session = await Session.findOne({ token }).lean();
  if (!session || session.expires_at < now) { if (session) await Session.deleteOne({ token }); return null; }
  const user = await User.findOne({ id: session.user_id }).lean();
  if (!user) { await Session.deleteOne({ token }); return null; }
  const serialized = await serializeUser(user);
  if (!await canSignIn(serialized)) { await Session.deleteMany({ user_id: user.id }); return null; }
  return serialized;
}
export async function logoutToken(token) { if (token) await Session.deleteOne({ token }); }
export function readBearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}
