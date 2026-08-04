import React from 'react';

interface DepartmentNameCodeFieldsProps {
  name: string;
  code: string;
  nameErr: string | null;
  codeErr: string | null;
  onNameChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  autoFocus?: boolean;
}

/** Shared Name + Code fields for the Add/Edit Department modals — keeps DepartmentsTab under the line cap. */
export default function DepartmentNameCodeFields({
  name,
  code,
  nameErr,
  codeErr,
  onNameChange,
  onCodeChange,
  autoFocus,
}: DepartmentNameCodeFieldsProps): React.ReactElement {
  return (
    <>
      <div>
        <label className="label">Department Name</label>
        <input
          className={`input ${nameErr ? 'input-error' : ''}`}
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Quality Assurance"
          autoFocus={autoFocus}
        />
        {nameErr && <p className="field-error">{nameErr}</p>}
      </div>
      <div>
        <label className="label">Code</label>
        <input
          className={`input ${codeErr ? 'input-error' : ''}`}
          required
          maxLength={10}
          value={code}
          onChange={(e) => onCodeChange(e.target.value.toUpperCase().slice(0, 10))}
          placeholder="e.g. QA"
        />
        {codeErr && <p className="field-error">{codeErr}</p>}
      </div>
    </>
  );
}
