import nodemailer from 'nodemailer';

function normalizeNotifyEmail(value) {
  const emails = String(value || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  return [...new Set(emails)].join(', ');
}

function transporter() {
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass },
  });
}

export function isSendEmailEnabled(project) {
  const raw = project?.send_email_enabled;
  if (raw === 1 || raw === true) return true;
  if (raw === 0 || raw === false || raw == null) return false;
  return /^(true|1|yes|on)$/i.test(String(raw).trim());
}

export function resolveNotifyEmail(project, issue) {
  return normalizeNotifyEmail(project?.notify_email || issue?.notify_email);
}

export async function sendInviteEmail({ to, inviteUrl, companyName, kind, invitedBy }) {
  const mailer = transporter();
  if (!mailer) return { ok: false, reason: 'SMTP_USER / SMTP_PASS missing' };
  const fromAddress = process.env.SMTP_USER || process.env.GMAIL_USER;
  const asOwner = kind === 'company';
  const subject = asOwner
    ? `[Pulse] You are invited to own ${companyName}`
    : `[Pulse] Join ${companyName} on Pulse`;
  const intro = `${invitedBy || 'Pulse'} invited ${to} to ${asOwner ? 'become the company owner of' : 'join'} ${companyName}.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;color:#111">
      <h2 style="margin-bottom:8px">Pulse invitation</h2>
      <p>${escapeHtml(invitedBy || 'Pulse')} invited <strong>${escapeHtml(to)}</strong> to ${asOwner ? 'become the company owner of' : 'join'} <strong>${escapeHtml(companyName)}</strong>.</p>
      <p>${asOwner ? 'As owner you can set up the project, use the Pulse agent, and invite your company members.' : 'You will get access to this company dashboard.'}</p>
      <p><a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#f97316;color:#111;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">View invitation</a></p>
      <p style="color:#6b7280;font-size:12px">If the button does not work, open this link:<br>${escapeHtml(inviteUrl)}</p>
    </div>
  `;
  try {
    const info = await mailer.sendMail({
      from: { name: 'Pulse', address: fromAddress },
      to,
      subject,
      text: `${intro}\n\nView invitation: ${inviteUrl}\n`,
      html,
    });
    return { ok: true, to, id: info.messageId };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function sendOtpEmail({ to, otp }) {
  const mailer = transporter();
  if (!mailer) return { ok: false, reason: 'SMTP_USER / SMTP_PASS missing' };
  const fromAddress = process.env.SMTP_USER || process.env.GMAIL_USER;
  try {
    await mailer.sendMail({
      from: { name: 'Pulse', address: fromAddress },
      to,
      subject: 'Your Pulse verification code',
      text: `Your Pulse verification code is ${otp}. It expires in 10 minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;color:#111">
          <h2 style="margin-bottom:8px">Pulse verification</h2>
          <p>Your 6-digit code is:</p>
          <p style="font-size:28px;letter-spacing:8px;font-weight:700">${escapeHtml(otp)}</p>
          <p style="color:#6b7280;font-size:12px">This code expires in 10 minutes.</p>
        </div>
      `,
    });
    return { ok: true, to };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function emailFixReport({ issue, event, analysis, prUrl, error, to, project }) {
  if (!isSendEmailEnabled(project)) {
    return { ok: true, skipped: true, to: '', reason: 'Client email sending is off. Set ISENABLEDSENDEMAIL=true in the client app.' };
  }
  const mailTo = normalizeNotifyEmail(to) || resolveNotifyEmail(null, issue);
  if (!mailTo) {
    return { ok: true, skipped: true, to: '', reason: 'Client PR email missing. Set PULSE_NOTIFY_EMAIL in the client app.' };
  }
  const mailer = transporter();
  if (!mailer) {
    return { ok: false, reason: 'SMTP_USER / SMTP_PASS missing' };
  }
  const from = process.env.SMTP_USER || process.env.GMAIL_USER;
  const subject = prUrl
    ? `[Pulse] Fix PR opened: ${issue.title}`.slice(0, 120)
    : `[Pulse] AI fix ready: ${issue.title}`.slice(0, 120);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;color:#111">
      <h2 style="margin-bottom:8px">Pulse AI agent</h2>
      <p><strong>Issue:</strong> ${escapeHtml(issue.title)}</p>
      <p><strong>Project:</strong> ${escapeHtml(issue.project_name || 'Pulse')}</p>
      <p><strong>Level:</strong> ${escapeHtml(issue.level)} · <strong>Culprit:</strong> ${escapeHtml(issue.culprit || 'n/a')}</p>
      <p><strong>Environment:</strong> ${escapeHtml(event?.environment || 'n/a')}</p>
      ${prUrl ? `<p><strong>Pull request:</strong> <a href="${escapeHtml(prUrl)}">${escapeHtml(prUrl)}</a></p>` : ''}
      <p>The PR is based on the client's current GitHub base-branch files, with the AI patch applied on top.</p>
      <h3>Root cause</h3>
      <p>${escapeHtml(analysis?.rootCause || 'Not available')}</p>
      <h3>Solution</h3>
      <pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml(analysis?.solution || analysis?.summary || 'Not available')}</pre>
      <h3>Stack</h3>
      <pre style="background:#111827;color:#d1d5db;padding:12px;border-radius:8px;white-space:pre-wrap">${escapeHtml((event?.stack || '').slice(0, 4000))}</pre>
    </div>
  `;

  await mailer.sendMail({
    from,
    to: mailTo,
    subject,
    html,
  });
  return { ok: true, to: mailTo };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
