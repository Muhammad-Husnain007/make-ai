import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.jsx';

export function ThemeToggle({ labeled = false, className = '' }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      className={labeled
        ? `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/4 hover:text-white ${className}`
        : `rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white ${className}`}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Light theme' : 'Dark theme'}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      {labeled && <span>{isDark ? 'Light theme' : 'Dark theme'}</span>}
    </button>
  );
}
