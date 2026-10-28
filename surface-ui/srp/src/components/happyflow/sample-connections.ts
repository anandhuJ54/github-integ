/**
 * The Happyflow prototype's sample Connections data, in one place (srp/connections-page-schema, task 8): the eleven accounts, NORA's two notes and the directories card the
 * Connections screen used to hold inline, and `sampleConnectionsModel`, the same values in the shape of `ConnectionsModel`. The sample view (no real seat) is built from this;
 * a real seat is built from the API (`connectionsModel` in utils/connections-model.ts). Nothing here is read from or written to the database.
 */
import {
  CARD_META,
  type ConnCard,
  type ConnThink,
  type ConnType,
  type ConnectionKey,
  type ConnectionsModel,
} from "@v3/srp/utils/connections-model";

// Demo data (Happyflow prototype)

export const THINKS: ConnThink[] = [
  {
    t: "Search Console is one tap away.",
    d: "It's part of your Google sign-in. It shows me which searches find your page.",
    cta: "Connect it",
    connect: "Search Console",
  },
  {
    t: "Your Website / CMS would let me apply fixes.",
    d: "Right now I can only hand them to your webmaster.",
    cta: "Connect it",
    connect: "Website / CMS",
  },
];

/** [key, name, type, status, powers] */
export const ACC: [ConnectionKey, string, ConnType, string, string][] = [
  [
    "google_business",
    "Google Business Profile",
    "on",
    "Connected · synced today",
    "GBP lane (67 of 68), hours, photos, reviews",
  ],
  [
    "search_console",
    "Search Console",
    "connect",
    "Part of the Google sign-in, not yet granted",
    "Indexing and search queries for Website Analytics",
  ],
  ["youtube", "YouTube", "on", "Connected through Google", "Videos lane"],
  ["facebook", "Facebook", "on", "Connected", "Connections lane, posting"],
  ["instagram", "Instagram", "connect", "", "Connections lane, posting"],
  ["linkedin", "LinkedIn", "on", "Connected", "Connections lane, photo, credentials hints"],
  ["x", "X", "connect", "", "Connections lane"],
  ["zillow", "Zillow", "matched", "Matched, no sign-in needed", "Reviews shown on the profile"],
  ["yelp", "Yelp", "partial", "Match found · replies need Yelp's partner access", "Listing check"],
  ["website_cms", "Website / CMS", "connect", "", "Lets NORA apply website fixes"],
  ["loan_system", "Loan system (Encompass)", "connect", "", "Review requests after each closing"],
];

export const LOCKED = {
  title: "Publish your details to Apple Maps, Bing and 28 directories.",
  text: "Unlock with Engage, included in Amplify.",
};

/** The sample page: the prototype's four connected accounts and two matched ones, both suggestions, the directories card. */
export function sampleConnectionsModel(): ConnectionsModel {
  const cards: ConnCard[] = ACC.map(([key, name, type, status, powers]) => ({
    key,
    name,
    ...CARD_META[key],
    type,
    status,
    powers,
  }));
  return {
    mode: "sample",
    seatKey: "sample",
    isMock: true,
    connected: cards.filter((c) => c.type === "on").length,
    matched: cards.filter((c) => c.type === "matched" || c.type === "partial").length,
    cards,
    suggest: [
      { key: "search_console", name: "Search Console" },
      { key: "website_cms", name: "Website / CMS" },
    ],
    thinks: THINKS,
    locked: LOCKED,
  };
}
