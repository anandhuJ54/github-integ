// Fix (10-digit US phone, 2026-10-13): our ETL sources store US phone numbers as 10 digits ("8605704059");
// the country code (+1) is added only on output: click-to-call links and schema.org telephone.
// Older data (State Farm) keeps its own format and is passed through unchanged.

/** True for exactly 10 digits (the stored format of our ETL sources). */
export function isUs10(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^\d{10}$/.test(v.trim());
}

/** schema.org / JSON-LD telephone: "+1" + 10 digits for 10-digit values; anything else unchanged. */
export function schemaPhone(v: string | null | undefined): string | undefined {
  if (v == null || v === '') return undefined;
  return isUs10(v) ? `+1${v.trim()}` : v;
}

/** Display text "(860) 570-4059" for 10-digit values; null when the value is not 10 digits. */
export function us10Display(v: string): string | null {
  const t = v.trim();
  const d = /^\+1\d{10}$/.test(t) ? t.slice(2) : t; // rows published before the switch (+1XXXXXXXXXX)
  return isUs10(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}
