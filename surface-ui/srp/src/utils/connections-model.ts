/**
 * The Connections page's view model (srp/connections-page-schema, task 8): the one object the Connections screen reads, instead of constants.
 *
 * `connectionsModel(data, seatId)` maps the API's response (`GET /srp/seat/professional/{id}/connections`) to it; `sampleConnectionsModel`
 * (components/happyflow/sample-connections.ts) builds the same shape from the prototype's constants, so the sample page (no real seat) is unchanged. Pure: no React, no network.
 *
 * Unknown stays unknown: a missing account has no card, a missing directories card is null. Connect (the buttons and NORA's notes) is an on-screen simulation in the screen;
 * nothing here writes, and no token or sign-in exists anywhere.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";

// --- the API response (contracts/srp/openapi.json, ConnectionsResponse) ------------------------------------------

export type ConnectionKey =
  | "google_business"
  | "search_console"
  | "youtube"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "x"
  | "zillow"
  | "yelp"
  | "website_cms"
  | "loan_system";
export type ConnectionState = "connected" | "available" | "matched" | "partial";

export type ConnectionsApi = {
  as_of: string;
  data: "mock" | "live" | null;
  ready: boolean;
  accounts:
    | {
        key: ConnectionKey;
        name: string;
        state: ConnectionState;
        status: string;
        powers: string;
        synced_at: string | null;
      }[]
    | null;
  summary: { connected: number; matched: number } | null;
  suggest: { key: ConnectionKey; name: string }[] | null;
  notes: { title: string; body: string; cta: string; connect: ConnectionKey }[] | null;
  locked: { title: string; text: string } | null;
};

// --- the view model ---------------------------------------------------------------------------------------------

export type ConnType = "on" | "connect" | "matched" | "partial";
export type ConnCard = {
  key: ConnectionKey;
  name: string;
  /** The round monogram and its colour: the page's, fixed per account. */
  mono: string;
  color: string;
  type: ConnType;
  status: string;
  powers: string;
};
export type ConnThink = { t: string; d: string; cta: string; connect: string };

export type ConnectionsModel = {
  mode: "sample" | "real";
  /** What remounts the screen when the seat changes, so one seat's Connect clicks never carry over: the seat's id, or "sample". */
  seatKey: string;
  /** True when the values are mock data from the local database or the prototype's sample: the page says so. */
  isMock: boolean;
  /** The stored counts under the title: connected accounts, and matched or partial ones. The page adds the browser's Connect clicks to `connected`. */
  connected: number;
  matched: number;
  cards: ConnCard[];
  /** The unconnected accounts among Search Console and Website / CMS, which the header sentence and NORA's notes name. */
  suggest: { key: ConnectionKey; name: string }[];
  thinks: ConnThink[];
  /** The locked directories card; null when the plan has it or the plan is unknown. */
  locked: { title: string; text: string } | null;
};

/** The monogram and colour of each account's round badge (the page's). */
export const CARD_META: Record<ConnectionKey, { mono: string; color: string }> = {
  google_business: { mono: "G", color: "#4285f4" },
  search_console: { mono: "SC", color: "#34a853" },
  youtube: { mono: "YT", color: "#ea4335" },
  facebook: { mono: "f", color: "#1877f2" },
  instagram: { mono: "IG", color: "#d6249f" },
  linkedin: { mono: "in", color: "#0a66c2" },
  x: { mono: "X", color: "#202124" },
  zillow: { mono: "Z", color: "#006aff" },
  yelp: { mono: "Y", color: "#d32323" },
  website_cms: { mono: "W", color: "#5f6368" },
  loan_system: { mono: "E", color: "#7b4ce0" },
};

const TYPE: Record<ConnectionState, ConnType> = {
  connected: "on",
  available: "connect",
  matched: "matched",
  partial: "partial",
};

// --- the mapping ----------------------------------------------------------------------------------------------------

/** The model for a ready response, or null when the seat has no Connections data yet (the caller then shows the sample view). */
export function connectionsModel(
  data: ConnectionsApi | null | undefined,
  seatId = "",
): ConnectionsModel | null {
  if (!data || !data.ready || !data.accounts) return null;
  const name = new Map(data.accounts.map((a) => [a.key, a.name]));
  return {
    mode: "real",
    seatKey: seatId,
    isMock: data.data !== "live",
    connected: data.summary?.connected ?? 0,
    matched: data.summary?.matched ?? 0,
    cards: data.accounts.map((a) => ({
      key: a.key,
      name: a.name,
      ...CARD_META[a.key],
      type: TYPE[a.state],
      status: a.status,
      powers: a.powers,
    })),
    suggest: (data.suggest ?? []).map((s) => ({ key: s.key, name: s.name })),
    thinks: (data.notes ?? []).map((n) => ({
      t: n.title,
      d: n.body,
      cta: n.cta,
      connect: name.get(n.connect) ?? n.connect,
    })),
    locked: data.locked ? { title: data.locked.title, text: data.locked.text } : null,
  };
}

/** The cache key of a seat's Connections data: one entry per seat, so two seats never share data. */
export const connectionsKey = (seatId: string) => ["seat-connections-v1", seatId] as const;

export function loadConnectionsData(seatId: string): Promise<ConnectionsApi> {
  return api.get<ConnectionsApi>(
    `/srp/seat/professional/${encodeURIComponent(seatId)}/connections`,
  );
}

/** The seat's Connections data. A failure (a Supabase session gets 501, a seat that is not yours 403) is not shown: the page falls back to the sample view. */
export function useConnectionsApi(seatId: string, enabled = true) {
  return useQuery({
    queryKey: connectionsKey(seatId),
    queryFn: () => loadConnectionsData(seatId),
    enabled: enabled && Boolean(seatId),
    retry: false,
    staleTime: 60_000,
  });
}
