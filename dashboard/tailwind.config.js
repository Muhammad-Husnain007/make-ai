import colors from 'tailwindcss/colors';

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        white: 'rgb(var(--pulse-white) / <alpha-value>)',
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
        },
        zinc: {
          ...colors.zinc,
          100: 'rgb(var(--z-100) / <alpha-value>)',
          200: 'rgb(var(--z-200) / <alpha-value>)',
          300: 'rgb(var(--z-300) / <alpha-value>)',
          400: 'rgb(var(--z-400) / <alpha-value>)',
          500: 'rgb(var(--z-500) / <alpha-value>)',
        },
        orange: {
          ...colors.orange,
          100: 'rgb(var(--o-100) / <alpha-value>)',
          200: 'rgb(var(--o-200) / <alpha-value>)',
          300: 'rgb(var(--o-300) / <alpha-value>)',
        },
        red: {
          ...colors.red,
          200: 'rgb(var(--r-200) / <alpha-value>)',
          300: 'rgb(var(--r-300) / <alpha-value>)',
        },
        emerald: {
          ...colors.emerald,
          300: 'rgb(var(--e-300) / <alpha-value>)',
        },
        sky: {
          ...colors.sky,
          300: 'rgb(var(--s-300) / <alpha-value>)',
        },
        amber: {
          ...colors.amber,
          100: 'rgb(var(--a-100) / <alpha-value>)',
          200: 'rgb(var(--a-200) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
