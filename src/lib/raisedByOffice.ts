// WHO RAISED THIS PASS, WHEN THE ANSWER IS AN OFFICE AND NOT A DEPARTMENT HEAD.
//
// Migration 069 let the sitting COO and the CEO raise material for ANY
// department. `raised_by_name` is a person's name, so beside a department they
// head none of, every timeline in the app read as though that department's own
// HOD had raised it. 071 snapshots the office onto the pass
// (`gate_passes.raised_by_office`, carried by `v_gate_passes`); this module is
// the ONE place its words are chosen.
//
// FOUR SURFACES TAKE THEIR WORDING FROM HERE, and they must never disagree:
//
//   the card strip     `passTimeline`          RAISED BY COO 09:47
//   the record's rail  `buildApprovalSteps`    Raised By (COO)
//   the activity log   `buildActivityLog`      Raised — COO
//   the printed slip   `buildSignatureBoxes`   a box headed "Issuing COO"
//
// The printed one is why this is not cosmetic: that box is headed "Issuing HOD"
// on an HOD's pass and a person signs paper underneath it.
//
// THE SNAPSHOT IS THE ONLY SOURCE. Never resolve the office by comparing
// `raised_by` against today's `approval_roles` — that table keeps only the
// CURRENT holder, so the moment a seat changes hands every past pass would be
// relabelled and the new holder credited with material their predecessor moved.
// An unrecognised value is read as no office rather than printed: the database
// CHECK admits only these two, and a heading this module has no words for must
// not reach the paper.

/** The two offices migration 069 permits to raise. Deliberately the same pair
 *  `holds_fallback_office()` names — a deputy or a time-boxed delegate is not
 *  one of them and can never appear here. */
export type RaisingOffice = 'coo' | 'ceo';

/** The office as a reader of the slip knows it. Mirrors the ladder's own
 *  `APPROVAL_ROLE_TITLES` for these two keys; kept separate so a rename of an
 *  approval RUNG's title cannot silently rewrite what "who raised this" says. */
export const RAISING_OFFICE_TITLE: Record<RaisingOffice, string> = {
  coo: 'COO',
  ceo: 'CEO',
};

/** The pass fields this module needs. Narrow on purpose — a card row, a log
 *  entry and a print job all hold enough to ask. Optional because a fixture, or
 *  a row read before 071 shipped, simply carries no such key. */
export type OfficeRaisedPass = { raised_by_office?: string | null };

/** The office that raised this pass, or null for the ordinary case: an HOD
 *  raising for a department they head. */
export function raisingOfficeOf(pass: OfficeRaisedPass): RaisingOffice | null {
  const key = pass.raised_by_office;
  return key === 'coo' || key === 'ceo' ? key : null;
}

/** The card strip's moment: "RAISED BY COO", or plain "RAISED". The strip has
 *  one line and no room for a second, so the office goes in the label itself. */
export function raisedMomentLabel(office: RaisingOffice | null): string {
  return office ? `Raised by ${RAISING_OFFICE_TITLE[office]}` : 'Raised';
}

/** The record rail's heading: "Raised By (COO)". The bracket is the ladder's
 *  own convention for naming a person or an office beside a rung
 *  (`approverLine`, `delegatedLine`), so the raise rung reads like the four
 *  underneath it rather than like a different document. */
export function raisedStepLabel(office: RaisingOffice | null): string {
  return office ? `Raised By (${RAISING_OFFICE_TITLE[office]})` : 'Raised By';
}

/** The note under that rung. An HOD raising IS their approval and has always
 *  said so; an office raising for a department it does not head has to say
 *  BOTH things, because "approved on raising" alone beside another
 *  department's name is the sentence that misled in the first place. */
export function raisedStepNote(office: RaisingOffice | null): string {
  return office
    ? `Raised by the ${RAISING_OFFICE_TITLE[office]} for this department — approved on raising`
    : 'Approved on raising';
}

/** The activity log's event. "Raised — COO" takes the same shape the log's
 *  approval rows already use ("Approved — COO"), so a reader filtering that
 *  screen for `COO` finds the raise as well as the signature. */
export function raisedEventLabel(office: RaisingOffice | null): string {
  return office ? `Raised — ${RAISING_OFFICE_TITLE[office]}` : 'Raised';
}

/** The printed slip's first box. "Issuing HOD" is the heading the paper has
 *  always carried and stays for an HOD's pass; a COO's slip says so. */
export function issuingBoxLabel(office: RaisingOffice | null): string {
  return `Issuing ${office ? RAISING_OFFICE_TITLE[office] : 'HOD'}`;
}
