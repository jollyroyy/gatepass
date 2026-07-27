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
 * Login-page text field: leading icon, floating-caps label, dark glass fill.
 *
 * Focus is driven by React state rather than Tailwind's `focus:` variants because
 * the fill and border are inline styles — an inline `border` always beats a
 * `focus:border-*` class, so the focus ring would silently never appear.
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
        style={{ color: focused ? 'rgb(8 145 178)' : 'rgb(100 116 139)' }}
      >
        {label}
      </label>

      <div className="relative">
        <span
          aria-hidden
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? 'rgb(8 145 178)' : 'rgb(148 163 184)' }}
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
          className="w-full rounded-xl pl-11 py-3 text-sm text-navy-900 placeholder:text-slate-400
                     focus:outline-none transition-all duration-200"
          style={{
            paddingRight: trailing ? '2.75rem' : '1rem',
            background: focused ? '#f8fafc' : '#ffffff',
            border: `1px solid ${focused ? 'rgba(8,145,178,0.50)' : 'rgba(203,213,225,0.70)'}`,
            boxShadow: focused
              ? '0 0 0 4px rgba(8,145,178,0.12), inset 0 1px 2px rgba(0,0,0,0.04)'
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
