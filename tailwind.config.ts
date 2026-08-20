import type { Config } from 'tailwindcss';

/**
 * Quest Gold + Charcoal design system.
 *
 * Token names are deliberately kept identical to the VMS project (brand / accent /
 * navy / surface / success / warning / danger) so layout and utility code ported from
 * there works unchanged — only the hue values differ. `navy` is therefore a NAME, not a
 * colour: it is the warm-stone neutral ramp. Do not rename it to "stone"; every ported
 * file would have to change with it.
 *
 * Sourced from questmall.in's own stylesheet (verified 2026-07-29, `css/custom.css`):
 *   gold      #d0ad68 / #d09918   .btn-primary, card titles, section headings
 *   charcoal  #404041 / #404042   nav text, headings, page header band
 *   maroon    #740e0c             "offer valid" accent
 *   off-white #fff9eb / #f5f5f5   warm section + footer backgrounds
 *
 * Palette rules:
 *   - `shell` is the sidebar/chrome. It stays dark in BOTH themes — it is not content.
 *   - Saturated colour carries status meaning ONLY. Never decorative.
 *
 *   Primary   brand-600  #C6A15B  brass gold  buttons, active nav, focus rings
 *   Accent    accent-600 #2B3FA0  royal blue  links, secondary emphasis
 *   Status    pending    #F59E0B  amber
 *             matched    #10B981  emerald
 *             flagged    #EF4444  red
 *             overdue    #F97316  orange
 *   Neutral   navy/surface        warm stone — meta, borders, baselines
 *
 * TEXT ON GOLD IS CHARCOAL, NEVER WHITE. White on #C6A15B is ~2.4:1 and fails WCAG AA;
 * `shell.ink` on the same gold is ~9.1:1. That is also the luxury-retail convention the
 * client's own site follows. The `brand.ink` alias exists so call sites read as intent
 * ("the colour that goes on top of brand") rather than as a coincidence of two tokens.
 *
 * The three warm hues — brass gold, amber pending, orange overdue — are deliberately
 * close in hue and separated by SATURATION instead: the gold is muted (S≈48%), the two
 * status hues are vivid (S≈92%). Status also never appears as a solid fill the way the
 * primary button does; it appears as a tinted pill with dark text. Keep it that way, or
 * the separation collapses.
 *
 * navy/surface/brand-50/100 and the status tints are CSS-variable driven so they flip
 * between light and dark automatically (see :root / .dark in src/index.css).
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // `.dark` on <html> is the shipped default, and it is still what every theme
  // switch toggles — but the GUARD'S SHELL is a fixed-light island (`.gb-main`
  // in index.css, put on <main> by AppShell for a guard), because the client's
  // mock-up is a light design. A `dark:` utility is a literal class, so the
  // light neutral ramp `.gb-main` re-declares cannot reach one; this variant is
  // what stops it applying inside that subtree at all. It is the same
  // zero-specificity shape Tailwind v4 ships by default, so a `dark:` utility
  // still wins over its base pair by source order, not by specificity.
  darkMode: ['variant', '&:where(.dark, .dark *):not(:where(.gb-main:not(:where(.gb-themed, .gb-themed *)), .gb-main:not(:where(.gb-themed, .gb-themed *)) *))'],
  theme: {
    extend: {
      colors: {
        // Chrome — the sidebar. Warm charcoal-black, dark in both themes.
        shell: {
          900: '#16161A', // sidebar base
          800: '#1E1E23', // sidebar raised / hover
          700: '#2C2C33', // sidebar borders
          ink: '#101014', // text that sits ON gold
        },
        // Brass gold — primary brand, from questmall.in's #d0ad68
        brand: {
          50: 'rgb(var(--c-brand-50) / <alpha-value>)',
          100: 'rgb(var(--c-brand-100) / <alpha-value>)',
          200: '#EBD9B4',
          300: '#DFC68F',
          400: '#D8B878',
          500: '#D0AD68', // the client's literal gold
          600: '#C6A15B', // primary — pair with shell.ink, never white
          700: '#A8853F', // hover
          800: '#866A31',
          900: '#6B5528',
          950: '#3E3014',
          ink: '#101014', // alias of shell.ink, read at brand call sites
        },
        // Royal blue — secondary accent, taken from the facade's lighting
        accent: {
          50: '#EEF1FB',
          100: '#DDE3F7',
          200: '#BCC7EF',
          300: '#93A3E2',
          400: '#6B7ED2',
          500: '#4859BE',
          600: '#2B3FA0', // accent
          700: '#223284',
          800: '#1B2868',
          900: '#151F50',
        },
        // Semantic neutrals (warm stone) — auto-flip with theme via CSS vars
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
        // The client's own heading face. Antic Didone ships ONE weight (400) — never
        // apply font-bold to it, the browser will synthesise a smeared faux-bold. Its
        // presence comes from size and letter-spacing, not weight.
        display: ['"Antic Didone"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      // ── Type scale — Minor Third (1.2), seven steps + the KPI numeral ──────
      // Size, weight and tracking travel TOGETHER, so a heading cannot be used
      // at the wrong weight by accident. The rule this encodes: a heading sits
      // at least two steps above, and 200 weight units heavier than, the text
      // directly beneath it. Everything read as flat before because headings
      // were a hair larger than their own subtext and no heavier.
      //
      // `font-display` (Antic Didone) is weight 400 ONLY — see fontFamily
      // above. So h1 may use the display face and take its presence from size
      // and negative tracking, while h2/h3 are Inter and carry real weight.
      // Never pair font-display with h2/h3.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '600' }],
        caption: ['0.75rem', { lineHeight: '1.125rem', fontWeight: '500' }],
        body: ['0.875rem', { lineHeight: '1.375rem', fontWeight: '400' }],
        'body-lg': ['1rem', { lineHeight: '1.5rem', fontWeight: '400' }],
        h3: ['1.125rem', { lineHeight: '1.5rem', letterSpacing: '-0.005em', fontWeight: '600' }],
        h2: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em', fontWeight: '700' }],
        h1: ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em', fontWeight: '700' }],
        // Tabular figures are applied via .tabular, not here — a KPI that
        // reflows its own width as it ticks reads as broken.
        kpi: ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em', fontWeight: '800' }],
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
        // Two soft layers — a tight contact shadow plus a wide ambient one.
        // A single heavy drop shadow is what makes a card look cheap; this
        // reads as lift without announcing itself.
        'card-premium': '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.10)',
        'card-premium-hover': '0 1px 2px rgb(0 0 0 / 0.05), 0 12px 32px -12px rgb(0 0 0 / 0.16)',
        soft: '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.03)',
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 4px 12px -4px rgb(0 0 0 / 0.04)',
        elevated: '0 4px 24px -4px rgb(0 0 0 / 0.1), 0 2px 8px -2px rgb(0 0 0 / 0.04)',
        modal: '0 20px 60px -12px rgb(0 0 0 / 0.25), 0 8px 20px -8px rgb(0 0 0 / 0.1)',
        glass: '0 8px 32px 0 rgb(22 22 26 / 0.10), inset 0 1px 0 0 rgb(255 255 255 / 0.35)',
        'glass-lg': '0 24px 70px -12px rgb(22 22 26 / 0.22), inset 0 1px 0 0 rgb(255 255 255 / 0.30)',
        // Restrained glow — gold, and only on the primary action.
        glow: '0 0 20px -6px rgb(198 161 91 / 0.45)',
        'glow-sm': '0 0 10px -3px rgb(198 161 91 / 0.35)',
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
