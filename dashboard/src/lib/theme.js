export const THEME_KEY = 'pulse_theme';

export function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

export function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(value);
  root.style.colorScheme = value;
  return value;
}

export function persistTheme(theme) {
  const value = applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, value); } catch {}
  return value;
}
