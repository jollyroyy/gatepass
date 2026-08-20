// One labelled input on a settings card — label, box, its own error and its own
// hint. Extracted so a settings card reads as the settings it holds rather than
// as N copies of the same markup.
//
// It was `MailField.tsx` until 056 gave the panel a second card. Nothing about
// it was ever mail-specific except the filename, and a second identical
// component is worse than a rename.
//
// The error sits UNDER the field it belongs to, never as a summary at the top:
// this form has three addresses and a port on it, and "that is not valid" at
// the top of a card cannot say which one.
import React from 'react';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  inputMode?: 'numeric';
  autoComplete?: string;
}

export default function SettingField({
  id, label, value, onChange, error, hint,
  type = 'text', placeholder, inputMode, autoComplete,
}: Props): React.ReactElement {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900 mb-1">
        {label}
      </label>
      <input
        id={id}
        className="input w-full"
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p className="text-xs text-flagged-600 mt-1">{error}</p>}
      {!error && hint && <p className="text-xs text-navy-500 mt-1">{hint}</p>}
    </div>
  );
}
