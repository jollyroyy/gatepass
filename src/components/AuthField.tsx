import React, { useState } from 'react';

type Props = {
  id: string;
  label: string;
  type: 'email' | 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
};

/**
 * Login-page text field: leading icon, caps label, warm ivory fill, gold focus.
 *
 * Focus is driven by React state rather than Tailwind's `focus:` variants because
 * the fill and border are inline styles — an inline `border` always beats a
 * `focus:border-*` class, so the focus ring would silently never appear.
 *
 * Every colour here is a literal, NOT a `navy-*`/`surface-*` token, on purpose.
 * The login card is a fixed ivory panel floating on a night photograph in both
 * themes — it is chrome, like the sidebar. Tokens would flip it: `text-navy-900`
 * resolves to near-white under `.dark`, which is the app's shipped default, and
 * that is invisible ink on an ivory field.
 */
export default function AuthField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  icon,
  trailing,
}: Props): React.ReactElement {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-bold mb-2 uppercase tracking-[0.14em] transition-colors duration-200"
        style={{ color: focused ? '#A8853F' : '#7C766C' }}
      >
        {label}
      </label>

      <div className="relative">
        <span
          aria-hidden
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? '#A8853F' : '#A8A39A' }}
        >
          {icon}
        </span>

        <input
          id={id}
          type={type}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="w-full rounded-xl pl-11 py-3 text-sm focus:outline-none transition-all duration-200"
          style={{
            paddingRight: trailing ? '2.75rem' : '1rem',
            color: '#262421',
            background: focused ? '#FFFFFF' : '#FAF9F7',
            border: `1px solid ${focused ? 'rgba(168,133,63,0.55)' : 'rgba(213,209,201,0.85)'}`,
            boxShadow: focused
              ? '0 0 0 4px rgba(198,161,91,0.16), inset 0 1px 2px rgba(0,0,0,0.04)'
              : 'inset 0 1px 2px rgba(0,0,0,0.04)',
          }}
        />

        {trailing && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
            {trailing}
          </span>
        )}
      </div>
    </div>
  );
}
