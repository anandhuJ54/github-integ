/** Demo edits live only in this browser (localStorage); nothing is written to the database. */
export const STORE_KEY = "hf-demo-profile";

export type Stored<F extends Record<string, string>> = {
  f: F;
  src: Partial<Record<keyof F, string>>;
};

/** The saved demo edits merged over `initial`, or null if there are none or they are unreadable. */
export function loadStored<F extends Record<string, string>>(initial: F): Stored<F> | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored<F> | null;
    return v && typeof v === "object" && v.f ? { f: { ...initial, ...v.f }, src: v.src ?? {} } : null;
  } catch {
    return null;
  }
}

/** Saves the edits, or clears them when no field has a source (nothing was changed). */
export function saveStored<F extends Record<string, string>>(f: F, src: Partial<Record<keyof F, string>>): void {
  try {
    if (Object.keys(src).length) window.localStorage.setItem(STORE_KEY, JSON.stringify({ f, src }));
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage unavailable — edits still apply for this visit */
  }
}
