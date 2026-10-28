// A ready Connections API response for tests (srp/connections-page-schema): the shape of GET /srp/seat/professional/{id}/connections, for a seat whose every value differs
// from the prototype's.
import type {
  ConnectionKey,
  ConnectionState,
  ConnectionsApi,
} from "@v3/srp/utils/connections-model";

const account = (
  key: ConnectionKey,
  name: string,
  state: ConnectionState,
  status: string,
  powers: string,
  synced_at: string | null = state === "available" ? null : "2026-10-24T09:00:00Z",
) => ({ key, name, state, status, powers, synced_at });

export const api = (over: Partial<ConnectionsApi> = {}): ConnectionsApi => ({
  as_of: "2026-10-27T10:00:00Z",
  data: "mock",
  ready: true,
  accounts: [
    account(
      "google_business",
      "Google Business Profile",
      "connected",
      "Connected · synced Oct 24",
      "GBP lane (41 of 68), hours, photos, reviews",
    ),
    account(
      "search_console",
      "Search Console",
      "connected",
      "Connected",
      "Indexing and search queries for Website Analytics",
    ),
    account("youtube", "YouTube", "available", "", "Videos lane"),
    account("facebook", "Facebook", "available", "", "Connections lane, posting"),
    account("instagram", "Instagram", "connected", "Connected", "Connections lane, posting"),
    account(
      "linkedin",
      "LinkedIn",
      "connected",
      "Connected",
      "Connections lane, photo, credentials hints",
    ),
    account("x", "X", "available", "", "Connections lane"),
    account("zillow", "Zillow", "available", "", "Reviews shown on the profile"),
    account("yelp", "Yelp", "matched", "Matched, no sign-in needed", "Listing check"),
    account("website_cms", "Website / CMS", "available", "", "Lets NORA apply website fixes"),
    account(
      "loan_system",
      "Loan system (Encompass)",
      "connected",
      "Connected",
      "Review requests after each closing",
    ),
  ],
  summary: { connected: 5, matched: 1 },
  suggest: [{ key: "website_cms", name: "Website / CMS" }],
  notes: [
    {
      title: "Your Website / CMS would let me apply fixes.",
      body: "Right now I can only hand them to your webmaster.",
      cta: "Connect it",
      connect: "website_cms",
    },
  ],
  locked: null,
  ...over,
});
