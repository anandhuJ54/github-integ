import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchDoc, SearchKind } from "@v3/ui/lib/search";

/**
 * Per-visitor lists (saved shortlist, recently viewed, compare selection).
 * localStorage only — no login required and nothing is sent to the server.
 */
export type ListedDoc = {
  id: string;
  entity_id: string;
  entity_type: SearchKind;
  slug: string | null;
  name: string;
  title: string | null;
  city: string | null;
  state: string | null;
  gcid: string | null;
  photo_url: string | null;
  rating: number | null;
  review_count: number | null;
  rank_score: number | null;
  categoryLabel?: string | null;
};

export const SAVED_KEY = "exp:saved";
export const RECENT_KEY = "exp:recent";
export const COMPARE_KEY = "exp:compare";

const CHANGED = "exp:lists-changed";

export function toListedDoc(
  doc: SearchDoc & { categoryLabel?: string | null },
  categoryLabel?: string | null,
): ListedDoc {
  return {
    id: doc.id,
    entity_id: doc.entity_id,
    entity_type: doc.entity_type,
    slug: doc.slug,
    name: doc.name,
    title: doc.title,
    city: doc.city,
    state: doc.state,
    gcid: doc.gcid,
    photo_url: doc.photo_url,
    rating: doc.rating,
    review_count: doc.review_count,
    rank_score: doc.rank_score,
    categoryLabel: categoryLabel ?? doc.categoryLabel ?? null,
  };
}

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — lists simply do not persist */
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
}

function useStoredList<T>(key: string): [T[], (next: T[]) => void, boolean] {
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(read<T>(key));
    setReady(true);
    const sync = () => setItems(read<T>(key));
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);

  const set = useCallback(
    (next: T[]) => {
      setItems(next);
      write(key, next);
    },
    [key],
  );

  return [items, set, ready];
}

export function useSavedList() {
  const [items, set, ready] = useStoredList<ListedDoc>(SAVED_KEY);
  return {
    items,
    ready,
    count: items.length,
    has: (id: string) => items.some((item) => item.id === id),
    toggle: (doc: ListedDoc) =>
      set(items.some((item) => item.id === doc.id) ? items.filter((item) => item.id !== doc.id) : [doc, ...items]),
    remove: (id: string) => set(items.filter((item) => item.id !== id)),
    clear: () => set([]),
  };
}

export function useRecentlyViewed() {
  const [items, set, ready] = useStoredList<ListedDoc>(RECENT_KEY);
  const record = useCallback(
    (doc: ListedDoc) => {
      const current = read<ListedDoc>(RECENT_KEY).filter((item) => item.id !== doc.id);
      write(RECENT_KEY, [doc, ...current].slice(0, 12));
    },
    [],
  );
  return { items, ready, record, clear: () => set([]) };
}

export const COMPARE_MAX = 3;

export function useCompare() {
  const [items, set, ready] = useStoredList<ListedDoc>(COMPARE_KEY);
  return {
    items,
    ready,
    count: items.length,
    has: (id: string) => items.some((item) => item.id === id),
    toggle: (doc: ListedDoc) => {
      if (items.some((item) => item.id === doc.id)) {
        set(items.filter((item) => item.id !== doc.id));
        return;
      }
      if (items.length >= COMPARE_MAX) return;
      set([...items, doc]);
    },
    remove: (id: string) => set(items.filter((item) => item.id !== id)),
    clear: () => set([]),
  };
}

/**
 * Records the current profile in the visitor's "recently viewed" strip.
 * Keyed on the id only, so a re-created doc object cannot re-trigger a write.
 */
export function useRecordView(doc: ListedDoc | null) {
  const latest = useRef(doc);
  latest.current = doc;
  const id = doc?.id ?? "";
  useEffect(() => {
    const current = latest.current;
    if (!id || !current) return;
    const rest = read<ListedDoc>(RECENT_KEY).filter((item) => item.id !== id);
    write(RECENT_KEY, [current, ...rest].slice(0, 12));
  }, [id]);
}
