import { createHash } from 'node:crypto';

function normalizeMessage(message) {
  return String(message || '')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#id')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function topFrames(stack) {
  return String(stack || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && (line.startsWith('at ') || /:\d+:\d+/.test(line)))
    .slice(0, 4)
    .map((line) => line
      .replace(/https?:\/\/[^/]+/g, '')
      .replace(/:\d+:\d+/g, ':N:N')
      .replace(/\d+/g, 'N')
      .replace(/\\/g, '/'));
}

export function fingerprintEvent({ type, message, stack }) {
  const payload = [type || 'Error', normalizeMessage(message), ...topFrames(stack)].join('|');
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

export function culpritFromStack(stack) {
  const line = String(stack || '')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith('at ') || item.includes('.js') || item.includes('.tsx') || item.includes('.ts'));
  if (!line) return '';
  return line.replace(/^at\s+/, '').slice(0, 180);
}
