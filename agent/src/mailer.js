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

export function isSendEmailEnabled() {
  return /^(true|1|yes|on)$/i.test(String(process.env.ISENABLEDSENDEMAIL ?? '').trim());
}

export function resolveNotifyEmail(project, issue) {
  return normalizeNotifyEmail(project?.notify_email || issue?.notify_email);
}

export async function emailFixReport({ issue, event, analysis, prUrl, error, to }) {
  if (!isSendEmailEnabled()) {
    return { ok: true, skipped: true, to: '' };
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
      ${error ? `<p style="color:#b91c1c"><strong>Agent note:</strong> ${escapeHtml(error)}</p>` : ''}
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
