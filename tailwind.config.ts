import type { Config } from 'tailwindcss';

/**
 * Slate + Cyan Ops design system.
 *
 * Token names are deliberately kept identical to the VMS project (brand / accent /
 * navy / surface / success / warning / danger) so layout and utility code ported from
 * there works unchanged — only the hue values differ.
 *
 * Palette rules (2026 ops-dashboard guidance):
 *   - Seven colours total. Nothing else gets to be saturated.
 *   - `shell` is the sidebar/chrome. It stays dark in BOTH themes — it is not content.
 *   - Saturated colour carries status meaning ONLY. Never decorative.
 *
 *   Primary   brand-600  #0891B2  cyan    buttons, active nav, focus rings
 *   Accent    accent-600 #4F46E5  indigo  links, secondary emphasis
 *   Status    pending    #F59E0B  amber
 *             matched    #10B981  emerald
 *             flagged    #EF4444  red
 *             overdue    #F97316  orange
 *   Neutral   navy/slate #64748B          meta, borders, baselines
 *
 * navy/surface/brand-50/100 and the status tints are CSS-variable driven so they flip
 * between light and dark automatically (see :root / .dark in src/index.css).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Chrome — the sidebar and top strip. Dark in both themes.
        shell: {
          900: '#0F172A', // sidebar base
          800: '#111827', // sidebar raised / hover
          700: '#1E293B', // sidebar borders
        },
        // Cyan — primary brand
        brand: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2', // primary
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#083344',
        },
        // Indigo — secondary accent
        accent: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5', // accent
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // Semantic neutrals (slate-based) — auto-flip with theme via CSS vars
        navy: {
          50: 'rgb(var(--c-navy-50) / <alpha-value>)',
          100: 'rgb(var(--c-navy-100) / <alpha-value>)',
          200: 'rgb(var(--c-navy-200) / <alpha-value>)',
          300: 'rgb(var(--c-navy-300) / <alpha-value>)',
          400: 'rgb(var(--c-navy-400) / <alpha-value>)',
          500: 'rgb(var(--c-navy-500) / <alpha-value>)',
          600: 'rgb(var(--c-navy-600) / <alpha-value>)',
          700: 'rgb(var(--c-navy-700) / <alpha-value>)',
          800: 'rgb(var(--c-navy-800) / <alpha-value>)',
          900: 'rgb(var(--c-navy-900) / <alpha-value>)',
          950: 'rgb(var(--c-navy-950) / <alpha-value>)',
        },
        surface: {
          50: 'rgb(var(--c-surface-50) / <alpha-value>)',
          100: 'rgb(var(--c-surface-100) / <alpha-value>)',
          200: 'rgb(var(--c-surface-200) / <alpha-value>)',
          300: 'rgb(var(--c-surface-300) / <alpha-value>)',
          400: 'rgb(var(--c-surface-400) / <alpha-value>)',
        },

        // ─── Status colours — the ONLY saturated colour in the UI ────────────
        // Named after gate pass states so intent is unmistakable at the call site.
        pending: {
          50: 'rgb(var(--c-pending-50) / <alpha-value>)',
          100: 'rgb(var(--c-pending-100) / <alpha-value>)',
          500: '#f59e0b',
          600: '#d97706',
          700: 'rgb(var(--c-pending-700) / <alpha-value>)',
        },
        matched: {
          50: 'rgb(var(--c-matched-50) / <alpha-value>)',
          100: 'rgb(var(--c-matched-100) / <alpha-value>)',
          500: '#10b981',
          600: '#059669',
          700: 'rgb(var(--c-matched-700) / <alpha-value>)',
        },
        flagged: {
          50: 'rgb(var(--c-flagged-50) / <alpha-value>)',
          100: 'rgb(var(--c-flagged-100) / <alpha-value>)',
          500: '#ef4444',
          600: '#dc2626',
          700: 'rgb(var(--c-flagged-700) / <alpha-value>)',
        },
        overdue: {
          50: 'rgb(var(--c-overdue-50) / <alpha-value>)',
          100: 'rgb(var(--c-overdue-100) / <alpha-value>)',
          500: '#f97316',
          600: '#ea580c',
          700: 'rgb(var(--c-overdue-700) / <alpha-value>)',
        },

        // Aliases so ported VMS code (alert-success, btn-danger…) keeps working.
        success: {
          50: 'rgb(var(--c-matched-50) / <alpha-value>)',
          100: 'rgb(var(--c-matched-100) / <alpha-value>)',
          500: '#10b981',
          600: '#059669',
          700: 'rgb(var(--c-matched-700) / <alpha-value>)',
        },
        warning: {
          50: 'rgb(var(--c-pending-50) / <alpha-value>)',
          100: 'rgb(var(--c-pending-100) / <alpha-value>)',
          500: '#f59e0b',
          600: '#d97706',
          700: 'rgb(var(--c-pending-700) / <alpha-value>)',
        },
        danger: {
          50: 'rgb(var(--c-flagged-50) / <alpha-value>)',
          100: 'rgb(var(--c-flagged-100) / <alpha-value>)',
          500: '#ef4444',
          600: '#dc2626',
          700: 'rgb(var(--c-flagged-700) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Space Grotesk"', '"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
        soft: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.03)',
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 4px 12px -4px rgb(0 0 0 / 0.04)',
        elevated: '0 4px 24px -4px rgb(0 0 0 / 0.1), 0 2px 8px -2px rgb(0 0 0 / 0.04)',
        modal: '0 20px 60px -12px rgb(0 0 0 / 0.25), 0 8px 20px -8px rgb(0 0 0 / 0.1)',
        glass: '0 8px 32px 0 rgb(15 23 42 / 0.10), inset 0 1px 0 0 rgb(255 255 255 / 0.35)',
        'glass-lg': '0 24px 70px -12px rgb(15 23 42 / 0.22), inset 0 1px 0 0 rgb(255 255 255 / 0.30)',
        // Restrained glow — cyan, and only on the primary action.
        glow: '0 0 20px -6px rgb(8 145 178 / 0.40)',
        'glow-sm': '0 0 10px -3px rgb(8 145 178 / 0.30)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        pulse_soft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        shimmer: 'shimmer 2s ease-in-out infinite',
        'pulse-soft': 'pulse_soft 2s ease-in-out infinite',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
} satisfies Config;
