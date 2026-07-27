import React, { useState } from 'react';

type Props = {
  id: string;
  label: string;
  type: 'email' | 'password';
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  icon: React.ReactNode;
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
}: Props): React.ReactElement {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-bold mb-2 uppercase tracking-[0.14em] transition-colors duration-200"
        style={{ color: focused ? 'rgb(103 232 249)' : 'rgb(148 163 184)' }}
      >
        {label}
      </label>

      <div className="relative">
        <span
          aria-hidden
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
          style={{ color: focused ? 'rgb(34 211 238)' : 'rgb(100 116 139)' }}
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
          className="w-full rounded-xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-500
                     focus:outline-none transition-all duration-200"
          style={{
            background: focused ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${focused ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.12)'}`,
            boxShadow: focused ? '0 0 0 4px rgba(8,145,178,0.18)' : 'none',
          }}
        />
      </div>
    </div>
  );
}
