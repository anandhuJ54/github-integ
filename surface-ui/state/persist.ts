import type { RootState } from "./store";

export type StorageKind = "local" | "session";

function area(kind: StorageKind): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStored(kind: StorageKind, key: string): string | null {
  try {
    return area(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * One persisted value: `select` derives a string from the store, written under `key` whenever it
 * changes. Only what a rule selects is persisted; tokens and the session are never selected.
 */
export type PersistRule = {
  kind: StorageKind;
  key: string;
  select: (state: RootState) => string | null;
  /** Remove the stored value when `select` returns null. Off by default: null keeps the last value. */
  clearOnNull?: boolean;
};

type Persistable = { getState: () => RootState; subscribe: (listener: () => void) => () => void };

/** Keep the rules' values in browser storage in step with the store. Returns the unsubscribe. */
export function persistOnChange(rules: PersistRule[], store: Persistable): () => void {
  const last = new Map<string, string | null>();
  const sync = () => {
    const state = store.getState();
    for (const rule of rules) {
      const next = rule.select(state);
      const id = `${rule.kind}:${rule.key}`;
      if (last.has(id) && last.get(id) === next) continue;
      last.set(id, next);
      try {
        const storage = area(rule.kind);
        if (!storage) continue;
        if (next === null) {
          if (rule.clearOnNull) storage.removeItem(rule.key);
        } else {
          storage.setItem(rule.key, next);
        }
      } catch {
        /* storage full or blocked: the value just is not remembered */
      }
    }
  };
  sync();
  return store.subscribe(sync);
}
