// The two overdue-card actions that need the database (migration 044): the
// vendor's phone number, and a follow-up remark against the pass.
//
// The other two actions on that card are routes, not calls — `Process RGP
// Return` opens /pass/:id, where the line-by-line return entry lives, and
// `Export Pass PDF` opens /pass/:id/print. Neither belongs here.
//
// BOTH RPCs REFUSE A PASS THE CALLER CANNOT SEE, server-side, and both throw
// the database's own words rather than a sentence invented here — the rule the
// rest of src/lib follows.
import { gp } from '../supabaseClient';

export interface PassContact {
  company: string | null;
  contactPerson: string | null;
  phone: string | null;
}

/**
 * Who to ring about this pass, or nulls when the vendor has no profile.
 *
 * `phone` null is a normal answer, not a failure: the number lives on a vendor
 * profile an HOD may never have created. The menu says "no number on file" and
 * offers nothing to press — it must never dial a guess.
 */
export async function fetchPassContact(passId: string): Promise<PassContact> {
  const { data, error } = await gp().rpc('pass_contact', { p_pass_id: passId });
  if (error) throw error;
  const row = (data as { company: string | null; contact_person: string | null; phone: string | null }[] | null)?.[0];
  return {
    company: row?.company ?? null,
    contactPerson: row?.contact_person ?? null,
    phone: row?.phone ?? null,
  };
}

/** A `tel:` href, or null when there is nothing dialable. Strips the spaces and
 *  brackets a human typed into the field; keeps a leading `+`. */
export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  return digits.length >= 6 ? `tel:${cleaned}` : null;
}

export interface PassRemark {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

/** Newest first — the order `list_pass_remarks` returns them in. */
export async function fetchPassRemarks(passId: string): Promise<PassRemark[]> {
  const { data, error } = await gp().rpc('list_pass_remarks', { p_pass_id: passId });
  if (error) throw error;
  const rows = (data as { id: string; body: string; author_name: string | null; created_at: string }[] | null) ?? [];
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorName: r.author_name,
    createdAt: r.created_at,
  }));
}

/** Append-only: there is no edit and no delete, here or in the schema. */
export async function addPassRemark(passId: string, body: string): Promise<void> {
  const { error } = await gp().rpc('add_pass_remark', {
    p_pass_id: passId,
    p_body: body.trim(),
  });
  if (error) throw error;
}
