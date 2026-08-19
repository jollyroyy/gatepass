// The three-dot menu on an overdue pass card (client, 2026-08-19).
//
// FOUR ACTIONS, AND NO "VIEW PASS DETAILS". The card itself is the link to the
// record — every one of them is clickable — so a menu item pointing at the same
// screen would be a second door onto one destination. That item is deliberately
// gone; the four below are the ones the client kept.
//
//   Process RGP Return      /pass/:id — where the line-by-line return entry is.
//   Contact Vendor / Person the number off the vendor profile, via
//                           `pass_contact` (044). A guard cannot read
//                           vendor_profiles directly and should not be able to;
//                           the RPC hands over ONE row for ONE pass.
//   Add Guard Remark        `add_pass_remark` (044). Append-only.
//   Export Pass PDF         /pass/:id/print, the existing printable slip.
//
// THE CONTACT IS FETCHED WHEN THE MENU OPENS, not with the list. A page of ten
// overdue cards would otherwise fire ten lookups nobody asked for, and the
// number is only wanted at the moment somebody decides to ring.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEscapeKey } from '../../lib/useEscapeKey';
import { fetchPassContact, telHref, type PassContact } from '../../lib/passActions';
import { safeErrorMessage } from '../../lib/errors';
import RemarkBox from './RemarkBox';

const Dots = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="12" cy="19" r="1.9" />
  </svg>
);

const STROKE = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const ReturnGlyph = (
  <svg {...STROKE}>
    <path d="M9 5.5L4.5 10 9 14.5" />
    <path d="M4.5 10h9.75A5.25 5.25 0 0119.5 15.25v0A5.25 5.25 0 0114.25 20.5H8" />
  </svg>
);
const PhoneGlyph = (
  <svg {...STROKE}>
    <path d="M6.2 3.75h2.4l1.35 3.6-1.8 1.35a11.4 11.4 0 005.15 5.15l1.35-1.8 3.6 1.35v2.4a2.1 2.1 0 01-2.3 2.1C10.4 17.3 6.7 13.6 4.1 6.05A2.1 2.1 0 016.2 3.75z" />
  </svg>
);
const RemarkGlyph = (
  <svg {...STROKE}>
    <path d="M4.75 5.75h14.5v9.5H10l-4 3.5v-3.5H4.75z" />
  </svg>
);
const PdfGlyph = (
  <svg {...STROKE}>
    <path d="M12 3.75v10.5m0 0l-3.25-3.25M12 14.25l3.25-3.25" />
    <path d="M4.75 15.75v2.5a2 2 0 002 2h10.5a2 2 0 002-2v-2.5" />
  </svg>
);

type Props = {
  passId: string;
  passNumber: string;
  /** The name printed on the pass — what the menu falls back to when no vendor
   *  profile carries a contact person. */
  partyName: string;
};

export default function OverdueCardMenu({ passId, passNumber, partyName }: Props): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [remarking, setRemarking] = useState(false);
  const [contact, setContact] = useState<PassContact | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEscapeKey(() => setOpen(false), open);

  // Outside click closes it. Pointerdown rather than click, so a press that
  // lands on the card underneath does not also navigate away mid-close.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: PointerEvent): void {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // One lookup per opening of a menu that has not yet resolved one.
  useEffect(() => {
    if (!open || contact !== null) return undefined;
    let cancelled = false;
    fetchPassContact(passId)
      .then((c) => {
        if (!cancelled) setContact(c);
      })
      .catch((err) => {
        if (!cancelled) setContactError(safeErrorMessage(err, 'Could not look up a contact.'));
      });
    return () => {
      cancelled = true;
    };
  }, [open, contact, passId]);

  const tel = telHref(contact?.phone ?? null);
  const who = contact?.contactPerson || partyName;

  return (
    <div className="gpo-menu-wrap" ref={wrap}>
      <button
        type="button"
        className="gpo-dots"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${passNumber}`}
        onClick={() => setOpen((v) => !v)}
      >
        {Dots}
      </button>

      {open && (
        <div className="gpo-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="gpo-menu-item"
            onClick={() => {
              setOpen(false);
              navigate(`/pass/${passId}`);
            }}
          >
            <span className="gpo-menu-glyph gb-ink-blue">{ReturnGlyph}</span>
            <span>
              Process RGP Return
              <span className="gpo-menu-note">Return pending items</span>
            </span>
          </button>

          {tel ? (
            <a role="menuitem" className="gpo-menu-item" href={tel} onClick={() => setOpen(false)}>
              <span className="gpo-menu-glyph gb-ink-green">{PhoneGlyph}</span>
              <span>
                Contact Vendor / Person
                <span className="gpo-menu-note">{`${who} · ${contact?.phone ?? ''}`}</span>
              </span>
            </a>
          ) : (
            <span className="gpo-menu-item gpo-menu-item-dead" role="menuitem" aria-disabled="true">
              <span className="gpo-menu-glyph gb-ink-green">{PhoneGlyph}</span>
              <span>
                Contact Vendor / Person
                <span className="gpo-menu-note">
                  {contactError
                    ?? (contact === null ? 'Looking up a number…' : 'No number on file for this vendor')}
                </span>
              </span>
            </span>
          )}

          <button
            type="button"
            role="menuitem"
            className="gpo-menu-item"
            onClick={() => {
              setOpen(false);
              setRemarking(true);
            }}
          >
            <span className="gpo-menu-glyph gb-ink-orange">{RemarkGlyph}</span>
            <span>
              Add Guard Remark
              <span className="gpo-menu-note">Add a follow-up remark</span>
            </span>
          </button>

          {/* A new tab, not this one: the guard loses their place in the stack
            * otherwise, and the print view has no way back into it. */}
          <a
            role="menuitem"
            className="gpo-menu-item"
            href={`/pass/${passId}/print`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <span className="gpo-menu-glyph gb-ink-purple">{PdfGlyph}</span>
            <span>
              Export Pass PDF
              <span className="gpo-menu-note">Download gate pass</span>
            </span>
          </a>
        </div>
      )}

      {remarking && (
        <RemarkBox passId={passId} passNumber={passNumber} onClose={() => setRemarking(false)} />
      )}
    </div>
  );
}
