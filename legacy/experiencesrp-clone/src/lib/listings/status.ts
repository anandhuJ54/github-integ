/** Listings status — error taxonomy + per-(entity, publisher) state machine.
 *
 *  Pure module: no I/O, no connector code. A future publisher connector reports what
 *  happened as an `ListingEvent`; `transition()` decides the next `ListingState`; and
 *  `toListingsColumns()` projects that onto the existing `listings` row
 *  (listings.status + has_drift) using the vocabulary the console already renders:
 *  not_submitted | ready | pending | published | error.
 *
 *  Taxonomy sources: the publisher ops notes in exp_listings_publishers / field_map
 *  (e.g. Data Axle "3 failed submissions = 90-day limbo", Foursquare reviewed
 *  proposals, Google quota-0-until-approved, Meta 60-day tokens). */

/** Why a submission did not go live. */
export type ListingErrorKind =
  | "validation" //  publisher rejected the payload shape/content up-front (fixable by us or the customer)
  | "auth" //        token expired / revoked / missing permission (reconnect required)
  | "quota" //       rate limit or quota (incl. Google's quota-0-until-approved) — retry later
  | "rejected" //    publisher reviewed and declined (e.g. unverifiable in teleresearch)
  | "duplicate" //   publisher matched an existing record — merge/claim instead of add
  | "limbo"; //      repeated failures put the record in a publisher hold (Data Axle: 90 days)

/** Every state a listing can be in for one publisher. */
export type ListingState =
  | "draft" //           nothing prepared yet
  | "ready" //           payload built and valid against our field map
  | "submitted" //       sent; no publisher acknowledgement yet
  | "pending_review" //  publisher accepted for review (FSQ proposals, DA teleresearch, Apple showcase)
  | "live" //            verified live on the publisher
  | "drift" //           live, but the publisher's copy no longer matches the hub
  | ListingErrorKind;

/** The values listings.status already carries (dashboard.listings.tsx STATUS_META). */
export type ListingsStatusColumn = "not_submitted" | "ready" | "pending" | "published" | "error";

export const ERROR_KINDS: readonly ListingErrorKind[] = [
  "validation",
  "auth",
  "quota",
  "rejected",
  "duplicate",
  "limbo",
];
export const LISTING_STATES: readonly ListingState[] = [
  "draft",
  "ready",
  "submitted",
  "pending_review",
  "live",
  "drift",
  ...ERROR_KINDS,
];

export interface ErrorPolicy {
  /** Can the runtime retry without a human? */
  autoRetry: boolean;
  /** Who has to act to clear it. */
  owner: "us" | "customer" | "publisher";
  /** Counts toward the consecutive-failure limbo threshold. */
  countsAsFailure: boolean;
  /** One-line operator guidance. */
  action: string;
}

export const ERROR_POLICY: Record<ListingErrorKind, ErrorPolicy> = {
  validation: {
    autoRetry: false,
    owner: "us",
    countsAsFailure: true,
    action: "Fix the field(s) against the publisher field map, then resubmit.",
  },
  auth: {
    autoRetry: false,
    owner: "customer",
    countsAsFailure: false,
    action: "Reconnect the account / refresh the token, then resubmit.",
  },
  quota: {
    autoRetry: true,
    owner: "us",
    countsAsFailure: false,
    action: "Back off and retry; request a quota increase if persistent.",
  },
  rejected: {
    autoRetry: false,
    owner: "customer",
    countsAsFailure: true,
    action: "Review the publisher's reason; correct the record or verify the business.",
  },
  duplicate: {
    autoRetry: false,
    owner: "us",
    countsAsFailure: false,
    action: "Claim or merge the existing publisher record instead of adding a new one.",
  },
  limbo: {
    autoRetry: false,
    owner: "publisher",
    countsAsFailure: false,
    action: "Publisher hold — wait out the hold window (or escalate via the account manager).",
  },
};

/** Consecutive counted failures before a publisher places the record in limbo. */
export const LIMBO_FAILURE_THRESHOLD = 3;
/** Default limbo hold (Data Axle: 90 days). */
export const LIMBO_DAYS = 90;

export type ListingEvent =
  | { type: "prepare" } //                         payload built + valid
  | { type: "submit" }
  | { type: "accepted_for_review" }
  | { type: "verified_live" }
  | { type: "drift_detected"; fields?: string[] }
  | { type: "resynced" } //                        publisher copy matches the hub again
  | { type: "failed"; kind: Exclude<ListingErrorKind, "limbo"> }
  | { type: "limbo_placed" } //                    publisher explicitly reports a hold
  | { type: "limbo_expired" }
  | { type: "reset" }; //                          operator/customer cleared the error (fix, reconnect, claim)

export interface MachineState {
  state: ListingState;
  /** Consecutive counted failures (validation/rejected) since the last success or reset. */
  failures: number;
}

export class IllegalTransition extends Error {
  constructor(
    public readonly from: ListingState,
    public readonly event: ListingEvent["type"],
  ) {
    super(`Illegal listings transition: ${from} --${event}-->`);
    this.name = "IllegalTransition";
  }
}

const isError = (s: ListingState): s is ListingErrorKind =>
  (ERROR_KINDS as readonly string[]).includes(s);

/** Which events each state accepts. "failed" is accepted wherever a publisher call can happen. */
const ALLOWED: Record<ListingState, ReadonlyArray<ListingEvent["type"]>> = {
  draft: ["prepare"],
  ready: ["submit", "prepare"],
  submitted: ["accepted_for_review", "verified_live", "failed", "limbo_placed"],
  pending_review: ["verified_live", "failed", "limbo_placed"],
  live: ["drift_detected", "submit", "failed"],
  drift: ["resynced", "submit", "failed", "drift_detected"],
  validation: ["reset", "prepare"],
  auth: ["reset"],
  quota: ["submit", "reset"],
  rejected: ["reset", "prepare"],
  duplicate: ["reset", "verified_live"],
  limbo: ["limbo_expired"],
};

export function canTransition(from: ListingState, event: ListingEvent["type"]): boolean {
  return ALLOWED[from].includes(event);
}

export function initialState(): MachineState {
  return { state: "draft", failures: 0 };
}

/** Pure transition. Throws IllegalTransition for events the current state does not accept. */
export function transition(cur: MachineState, ev: ListingEvent): MachineState {
  if (!canTransition(cur.state, ev.type)) throw new IllegalTransition(cur.state, ev.type);
  switch (ev.type) {
    case "prepare":
      return { ...cur, state: "ready" };
    case "submit":
      return { ...cur, state: "submitted" };
    case "accepted_for_review":
      return { ...cur, state: "pending_review" };
    case "verified_live":
      return { state: "live", failures: 0 };
    case "drift_detected":
      return { ...cur, state: "drift" };
    case "resynced":
      return { ...cur, state: "live" };
    case "failed": {
      const counts = ERROR_POLICY[ev.kind].countsAsFailure;
      const failures = cur.failures + (counts ? 1 : 0);
      if (counts && failures >= LIMBO_FAILURE_THRESHOLD) return { state: "limbo", failures };
      return { state: ev.kind, failures };
    }
    case "limbo_placed":
      return { ...cur, state: "limbo" };
    case "limbo_expired":
      return { state: "draft", failures: 0 };
    case "reset":
      // A reset clears the error but keeps the failure count: limbo is about consecutive
      // failed submissions, and only a live verification (or the hold expiring) clears it.
      return { ...cur, state: cur.state === "duplicate" ? "draft" : "ready" };
  }
}

/** Projection onto the existing listings columns. */
export function toListingsColumns(state: ListingState): {
  status: ListingsStatusColumn;
  has_drift: boolean;
} {
  if (isError(state)) return { status: "error", has_drift: false };
  switch (state) {
    case "draft":
      return { status: "not_submitted", has_drift: false };
    case "ready":
      return { status: "ready", has_drift: false };
    case "submitted":
    case "pending_review":
      return { status: "pending", has_drift: false };
    case "live":
      return { status: "published", has_drift: false };
    case "drift":
      return { status: "published", has_drift: true };
  }
}

/** Best-effort reverse read of an existing listings row (the column is coarser than the machine). */
export function fromListingsColumns(row: {
  status: string | null;
  has_drift?: boolean | null;
}): ListingState {
  switch (row.status) {
    case "ready":
      return "ready";
    case "pending":
      return "submitted";
    case "published":
      return row.has_drift ? "drift" : "live";
    case "error":
      return "validation"; // kind is not stored on listings; treat as needs-fix until a connector records it
    default:
      return "draft";
  }
}

/** Classify a raw publisher response into the taxonomy. Connector-agnostic. */
export function classifyPublisherError(e: {
  httpStatus?: number;
  code?: string;
  message?: string;
}): Exclude<ListingErrorKind, "limbo"> {
  const code = (e.code ?? "").toUpperCase();
  const msg = (e.message ?? "").toLowerCase();
  if (
    e.httpStatus === 401 ||
    e.httpStatus === 403 ||
    /UNAUTHENTICATED|PERMISSION_DENIED|INVALID_GRANT|OAUTH/.test(code) ||
    /token (expired|revoked)|unauthori[sz]ed/.test(msg)
  )
    return "auth";
  if (
    e.httpStatus === 429 ||
    /RESOURCE_EXHAUSTED|RATE_LIMIT|QUOTA/.test(code) ||
    /quota|rate limit|too many requests/.test(msg)
  )
    return "quota";
  if (
    e.httpStatus === 409 ||
    /ALREADY_EXISTS|DUPLICATE/.test(code) ||
    /duplicate|already exists/.test(msg)
  )
    return "duplicate";
  if (/REJECTED|DENIED|UNVERIFIABLE/.test(code) || /rejected|unverifiable|declined/.test(msg))
    return "rejected";
  return "validation";
}
