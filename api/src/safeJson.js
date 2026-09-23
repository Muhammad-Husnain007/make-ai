const PASSWORD_KEY = /^(password|passwd|pwd|password_hash|passwordHash|currentPassword|newPassword|confirmPassword)$/i;

export function isPasswordKey(key) {
  return PASSWORD_KEY.test(String(key || ''));
}

export function stripPasswordFields(value) {
  if (Array.isArray(value)) return value.map(stripPasswordFields);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isPasswordKey(key)) continue;
    out[key] = stripPasswordFields(item);
  }
  return out;
}
