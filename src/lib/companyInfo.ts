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

const PACKED_KEYS = ['n', 'c', 'a', 'v'] as const;

export function parseCompanyInfo(raw: string | null | undefined): CompanyInfo {
  if (!raw) return { name: '', contact: '', address: '', phone: '' };
  try {
    const parsed = JSON.parse(raw);
    // Recognise the packed shape by its KEYS, not by whether the name is
    // non-empty. Testing `parsed.n` for truthiness meant `{"n":"","a":"","v":""}`
    // — what RaisePass writes whenever the optional vendor fields are left
    // blank — failed the check and fell through to the legacy branch, which
    // returned the raw JSON blob AS the company name. Every such pass rendered
    // `Vendor {"n":"","a":"","v":""}` on the detail page, the slip and the gate
    // cards.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const isPacked = PACKED_KEYS.some((k) => k in parsed);
      if (isPacked) {
        return {
          name: parsed.n || '',
          contact: parsed.c || '',
          address: parsed.a || '',
          phone: parsed.v || '',
        };
      }
    }
  } catch {
    // legacy plain-text company name
  }
  return { name: raw, contact: '', address: '', phone: '' };
}
