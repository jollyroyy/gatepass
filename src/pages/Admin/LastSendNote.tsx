// The last approval letter this system tried to send — where it went, and the
// provider's own refusal when it did not go.
//
// It exists because the settings above it can be perfectly saved and still
// deliver nothing: while the mail account is unverified the provider accepts
// exactly one recipient address, and refuses any other with a 403. That
// refusal was recorded in `gatepass.email_log` (047, 050) and shown nowhere,
// so the only symptom of a wrong setting was an inbox that stayed empty.
//
// The provider's text is printed VERBATIM, not summarised: it names the
// address it will accept and what to do about it, which is more than any
// sentence written here could.
import React from 'react';
import { formatDateTime } from '../../lib/formatDate';

export interface SendAttempt {
  recipient: string;
  subject: string | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

interface Props {
  attempt: SendAttempt | null;
}

export default function LastSendNote({ attempt }: Props): React.ReactElement | null {
  // No log row is not a failure state — it is a system that has not sent an
  // approval letter yet, and an empty box saying so would be noise.
  if (!attempt) return null;

  return (
    <div className={attempt.ok ? 'alert-info' : 'alert-warning'}>
      <p className="font-semibold">
        {attempt.ok ? 'Last letter delivered to' : 'Last letter was refused'}{' '}
        {attempt.ok ? attempt.recipient : ''}
      </p>
      {!attempt.ok && <p className="text-sm mt-1">Aimed at {attempt.recipient}.</p>}
      <p className="text-xs mt-1">{formatDateTime(attempt.created_at)}</p>
      {attempt.error && (
        <p className="text-xs mt-1 break-words font-mono">{attempt.error}</p>
      )}
    </div>
  );
}
