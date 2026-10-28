/** Demo edits live only in this browser (localStorage); nothing is written to the database. */
export const STORE_KEY = "hf-demo-profile";

/** The browser key of the edits: the sample page keeps the original key; a real seat's edits are kept per seat, so one person's edits never show on another's profile. */
export const storeKeyFor = (seatId: string | null): string =>
  seatId ? `${STORE_KEY}:${seatId}` : STORE_KEY;

export type Stored<F extends Record<string, string>> = {
  f: F;
  src: Partial<Record<keyof F, string>>;
};

/** The saved demo edits merged over `initial`, or null if there are none or they are unreadable. */
export function loadStored<F extends Record<string, string>>(
  initial: F,
  key: string = STORE_KEY,
): Stored<F> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored<F> | null;
    const plain = (x: unknown): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x);
    return v && plain(v.f) ? { f: { ...initial, ...v.f }, src: plain(v.src) ? v.src : {} } : null;
  } catch {
    return null;
  }
}

/** Saves the edits, or clears them when no field has a source (nothing was changed). */
export function saveStored<F extends Record<string, string>>(
  f: F,
  src: Partial<Record<keyof F, string>>,
  key: string = STORE_KEY,
): void {
  try {
    // only the fields the person edited are kept: every other fact comes from the current data, so a later change shows
    const edited = Object.fromEntries(Object.entries(f).filter(([k]) => k in src));
    if (Object.keys(src).length)
      window.localStorage.setItem(key, JSON.stringify({ f: edited, src }));
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — edits still apply for this visit */
  }
}
