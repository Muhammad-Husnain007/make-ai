import { createContext, useContext, useMemo, useState } from 'react';
import { applyTheme, persistTheme, readTheme } from '../lib/theme.js';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof document === 'undefined') return 'dark';
    const current = document.documentElement.classList.contains('light') ? 'light' : readTheme();
    applyTheme(current);
    return current;
  });

  const value = useMemo(() => ({
    theme,
    setTheme(next) {
      setThemeState(persistTheme(next));
    },
    toggle() {
      setThemeState(persistTheme(theme === 'dark' ? 'light' : 'dark'));
    },
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
