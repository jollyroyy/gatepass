/**
 * `gate_passes.visitor_company` has no separate columns for address/phone, so
 * RaisePass packs all three into one JSON string:
 * `{"n": name, "a": address, "v": phone}` ("c" for contact person is also
 * read, for forward compatibility, though nothing currently writes it).
 * Older passes have a plain company name in this column instead — JSON.parse
 * throws on that, which is the signal to fall back to treating it as the name.
 */
export interface CompanyInfo {
  name: string;
  contact: string;
  address: string;
  phone: string;
}

export function parseCompanyInfo(raw: string | null | undefined): CompanyInfo {
  if (!raw) return { name: '', contact: '', address: '', phone: '' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.n) {
      return { name: parsed.n, contact: parsed.c || '', address: parsed.a || '', phone: parsed.v || '' };
    }
  } catch {
    // legacy plain-text company name
  }
  return { name: raw, contact: '', address: '', phone: '' };
}
