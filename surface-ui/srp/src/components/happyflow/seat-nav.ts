/**
 * Happyflow screens live inside the professional seat (/seat/$kind/$id/*), under the seat's own
 * "Viewing as" bar and sidebar. This maps the prototype's navigation targets onto seat routes.
 */
import { useCallback } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";

export type HfRoute =
  | "home"
  | "day7"
  | "events"
  | "recap"
  | "srs"
  | "find"
  | "interview"
  | "reviews"
  | "profile"
  | "connections"
  | "website"
  | "insights"
  | "network"
  | "settings";

/** Height of the Happyflow frame inside the seat page body (view-as bar + page padding). */
export const HF_EMBED_HEIGHT = "max(600px, calc(100vh - 124px))";

export type HfNavParams = { kind: string; id: string };
export type HfNavTarget = {
  to: string;
  params: HfNavParams;
  /** Present only for the seat index (home screens); `from` is carried over from the current URL. */
  search?: { day?: 7 | 24; events?: 1 };
};

/** Where a Happyflow navigation target goes. Pure, so the mapping can be tested without a router. */
export function hfNavTarget(to: HfRoute, params: HfNavParams): HfNavTarget {
  const home = (day?: 7 | 24, events?: 1): HfNavTarget => ({
    to: "/seat/$kind/$id",
    params,
    search: { ...(day ? { day } : {}), ...(events ? { events } : {}) },
  });
  switch (to) {
    case "home":
      return home();
    case "day7":
      return home(7);
    case "events":
      return home(7, 1);
    case "recap":
      return home(24);
    case "srs":
      return { to: "/seat/$kind/$id/nora", params };
    default:
      return { to: `/seat/$kind/$id/${to}`, params };
  }
}

export function useHfNav() {
  const navigate = useNavigate();
  const { kind = "professional", id = "" } = useParams({ strict: false }) as {
    kind?: string;
    id?: string;
  };
  return useCallback(
    (to: HfRoute) => {
      const params = { kind, id };
      const t = hfNavTarget(to, params);
      const search = t.search;
      if (search)
        return void navigate({
          to: "/seat/$kind/$id",
          params,
          search: (prev: Record<string, unknown>) => ({
            from: prev.from as string | undefined,
            day: search.day,
            events: search.events,
          }),
        });
      return void navigate({ to: t.to as "/seat/$kind/$id/profile", params });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, kind, id],
  );
}
