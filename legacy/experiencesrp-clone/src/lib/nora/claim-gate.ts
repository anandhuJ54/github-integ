import type { IdentityKey } from "@/lib/category-brief";

/*
 * Claim gate — the pure half (docs/nora-os-skills-registry.md §5.2).
 *
 * Trust tiers (power scales with proof, not with entry):
 *   T0 authenticated        — view / preview / sandbox interview. No public changes.
 *   T1 identity + email     — organize / confirm the graph, set the work agreement.
 *   T2 ownership proven     — change NAP, publish, alter competitive signals, buy.
 *
 * Silent-first: score what we already hold (OAuth identity vs the published record, the
 * category brief's identity keys, a GBP Place ID match) BEFORE asking for anything. Only
 * when that falls short is ONE explained OTP sent to an on-file channel. A Place ID match on
 * a location the claimant manages is dispositive → instant T2.
 *
 * Verification keys come from the category brief (entityTypes[].claim.keys) — there is no
 * per-category code here. Keys map onto the published record by schema.org property.
 *
 * No I/O: the capability handlers (claim-capabilities.server.ts) load the rows and call
 * these; tests/claim-gate.test.ts covers every transition and refusal.
 */

export type Tier = 0 | 1 | 2;
export const TIERS: readonly Tier[] = [0, 1, 2];
export const TIER_LABEL: Record<Tier, string> = {
  0: "T0 · authenticated",
  1: "T1 · identity + email verified",
  2: "T2 · ownership proven",
};

/** Actions by the minimum tier that unlocks them. Harmful actions sit behind T2. */
export const TIER_ACTIONS: Record<Tier, readonly string[]> = {
  0: ["view", "preview", "sandbox_interview"],
  1: ["organize_graph", "confirm_facts", "set_work_agreement", "edit_bio", "request_reviews"],
  2: ["change_nap", "publish", "alter_competitive_signals", "purchase", "delegate", "transfer"],
};
export type GateAction = (typeof TIER_ACTIONS)[Tier][number];

/** Minimum tier for an action; unknown actions are treated as harmful (T2). */
export function requiredTier(action: string): Tier {
  for (const t of TIERS) if (TIER_ACTIONS[t].includes(action)) return t;
  return 2;
}

/** Pure: may a holder of `tier` (null = no binding) perform `action`? */
export function tierAllows(tier: Tier | null | undefined, action: string): boolean {
  if (tier == null) return false;
  return tier >= requiredTier(action);
}

/** Pure: tiers only ever go up inside one claim; out-of-range proposals are refused. */
export function advanceTier(current: Tier, proposed: number): Tier {
  if (!Number.isInteger(proposed) || proposed < 0 || proposed > 2)
    throw new Error(`invalid trust tier ${proposed}`);
  return Math.max(current, proposed) as Tier;
}

/* ───────── Record + claimant shapes ───────── */

/** The published record (professionals / organizations row), normalised. */
export type ClaimRecord = {
  recordType: "professional" | "organization";
  id: string;
  name: string | null;
  email: string | null;
  websiteUrl: string | null;
  telephone: string | null;
  licenseNumber: string | null;
  placeId: string | null;
  claimed: boolean;
  ownerUserId: string | null;
  active: boolean;
  /**
   * Single-pro office (exp_office_mode = 'single_pro'): the record IS the professional (identity,
   * licence key, owner) and `placeId` is the LOCATION's Place ID (the pro's own is the fallback).
   * The grant binds both records. Absent / null for every other mode.
   */
  office?: {
    mode: "single_pro";
    professionalId: string;
    locationId: string;
    placeIdSource: "location" | "professional" | null;
  } | null;
};

export type Claimant = {
  userId: string;
  email: string | null;
  /** True when the OAuth provider asserts the email (Google / work OAuth). */
  emailVerified: boolean;
  name: string | null;
};

export type ExistingClaim = { userId: string; status: string; trustTier: number };

/** Category brief view of this entity type: is it claimable and with which keys. */
export type BriefClaim = { claimable: boolean; keys: IdentityKey[] } | null;

/** GBP managed-locations lookup result (null = integration not live; never faked). */
export type ManagedLocations = { placeIds: string[] } | null;

export const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "live.com",
  "msn.com",
]);

export function normalizeName(s: string | null | undefined) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function emailDomain(email: string | null | undefined) {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at === -1 ? "" : e.slice(at + 1);
}
export function websiteHost(url: string | null | undefined) {
  if (!url) return "";
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}
/** a@b.com is a domain match for b.com and for any subdomain of it (agents.b.com). */
export function domainMatches(emailDom: string, host: string) {
  if (!emailDom || !host) return false;
  return host === emailDom || host.endsWith(`.${emailDom}`) || emailDom.endsWith(`.${host}`);
}
export function namesMatch(a: string | null | undefined, b: string | null | undefined) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  return x.length > 2 && y.length > 2 && (x === y || x.includes(y) || y.includes(x));
}
export function normalizeKey(s: string | null | undefined) {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export function maskEmail(email: string | null | undefined) {
  const e = (email ?? "").trim();
  const at = e.indexOf("@");
  if (at < 1) return "";
  return `${e[0]}${"•".repeat(Math.max(1, Math.min(6, at - 1)))}${e.slice(at)}`;
}

/** Brief identity key (by schema.org property) → which record field verifies it. */
export const KEY_FIELD: Record<string, keyof ClaimRecord> = {
  name: "name",
  email: "email",
  url: "websiteUrl",
  telephone: "telephone",
  "hasCredential.identifier": "licenseNumber",
  identifier: "licenseNumber",
};
export function keyField(k: Pick<IdentityKey, "schemaProperty" | "key">) {
  return KEY_FIELD[k.schemaProperty] ?? KEY_FIELD[k.key] ?? null;
}
/** Does the brief ask for a credential id (licence number) as a verification key? */
export function briefWantsCredential(brief: BriefClaim) {
  return !!brief?.keys.some((k) => keyField(k) === "licenseNumber");
}

/* ───────── Refusals ───────── */

export type Refusal =
  | "record_not_found"
  | "record_inactive"
  | "not_claimable"
  | "already_owner"
  | "claimed_by_other";

export const REFUSAL_MESSAGE: Record<Refusal, string> = {
  record_not_found: "Profile not found.",
  record_inactive: "This profile is not active.",
  not_claimable: "This profile type cannot be claimed for its category.",
  already_owner: "You already own this profile.",
  claimed_by_other: "This profile has already been claimed.",
};

/** Pure: should the claim be refused before any scoring? Never accuses — just stops. */
export function claimRefusal(
  record: ClaimRecord | null,
  claimant: Pick<Claimant, "userId">,
  existing: ExistingClaim[],
  brief: BriefClaim,
): Refusal | null {
  if (!record) return "record_not_found";
  if (!record.active) return "record_inactive";
  if (brief && !brief.claimable) return "not_claimable";
  const verified = existing.filter((c) => c.status === "verified");
  if (verified.some((c) => c.userId === claimant.userId)) return "already_owner";
  if (record.claimed && record.ownerUserId === claimant.userId) return "already_owner";
  if (verified.length || record.claimed) return "claimed_by_other";
  return null;
}

/* ───────── Silent precheck ───────── */

export type Signal = { matched: boolean; weight: number; detail?: string };
export type TierPath =
  | "gbp_place_id"
  | "email_exact"
  | "domain_identity"
  | "otp_email"
  | "staff_review"
  | "none";

export type Precheck = {
  confidence: number;
  signals: Record<string, Signal>;
  tier: Tier;
  path: TierPath;
  /** Keys the brief asked for that the record cannot check (no value on file). */
  uncheckable: string[];
};

/** Weights mirror the pre-gate submitClaim scoring so the queue's confidence stays comparable. */
export const WEIGHTS = {
  email_domain: 35,
  email_exact: 15,
  name: 35,
  license: 30,
  place_id: 100,
} as const;

/**
 * Pure: score the signals we already hold and derive the silent tier.
 *   T2 — a Place ID the claimant manages (GBP) equals the record's Place ID (dispositive).
 *   T1 — name match AND either the verified OAuth email equals the on-file email, or a
 *        non-generic email domain matches the record's website domain AND (when the brief
 *        asks for a credential id) the licence number matches.
 *   T0 — otherwise (the challenge / manual review decide).
 */
export function scorePrecheck(a: {
  record: ClaimRecord;
  claimant: Claimant;
  brief: BriefClaim;
  licenseNumber?: string | null;
  managed: ManagedLocations;
}): Precheck {
  const { record, claimant } = a;
  const signals: Record<string, Signal> = {};
  let score = 0;
  const uncheckable: string[] = [];

  const userDom = emailDomain(claimant.email);
  const generic = GENERIC_EMAIL_DOMAINS.has(userDom);
  const host = websiteHost(record.websiteUrl);
  const recDom = emailDomain(record.email);
  const domainMatch =
    !!userDom && !generic && (userDom === recDom || domainMatches(userDom, host));
  signals.email_domain = {
    matched: domainMatch,
    weight: WEIGHTS.email_domain,
    detail: userDom ? `@${userDom}` : "",
  };
  if (domainMatch) score += WEIGHTS.email_domain;

  const exact =
    !!record.email &&
    !!claimant.email &&
    claimant.emailVerified &&
    claimant.email.trim().toLowerCase() === record.email.trim().toLowerCase();
  signals.email_exact = { matched: exact, weight: WEIGHTS.email_exact };
  if (exact) score += WEIGHTS.email_exact;

  const nameOk = namesMatch(claimant.name, record.name);
  signals.name = { matched: nameOk, weight: WEIGHTS.name };
  if (nameOk) score += WEIGHTS.name;

  const wantsCredential = briefWantsCredential(a.brief);
  const lic = normalizeKey(a.licenseNumber);
  const recLic = normalizeKey(record.licenseNumber);
  const licOk = lic.length > 0 && recLic.length > 0 && lic === recLic;
  signals.license = {
    matched: licOk,
    weight: WEIGHTS.license,
    detail: lic ? "provided" : "none",
  };
  if (licOk) score += WEIGHTS.license;
  if (wantsCredential && !recLic) uncheckable.push("licenseNumber");

  for (const k of a.brief?.keys ?? []) {
    const f = keyField(k);
    if (f && f !== "licenseNumber" && f !== "name" && !record[f]) uncheckable.push(String(f));
  }

  const placeOk =
    !!a.managed &&
    !!record.placeId &&
    a.managed.placeIds.some((p) => p && p === record.placeId);
  signals.place_id = {
    matched: placeOk,
    weight: WEIGHTS.place_id,
    detail:
      (a.managed ? `${a.managed.placeIds.length} managed` : "not_configured") +
      (record.office?.placeIdSource ? ` · place id from ${record.office.placeIdSource}` : ""),
  };

  let tier: Tier = 0;
  let path: TierPath = "none";
  if (placeOk) {
    tier = 2;
    path = "gbp_place_id";
  } else if (nameOk && exact) {
    tier = 1;
    path = "email_exact";
  } else if (nameOk && domainMatch && (!wantsCredential || licOk)) {
    tier = 1;
    path = "domain_identity";
  }
  const confidence = placeOk ? 100 : Math.min(100, score);
  return { confidence, signals, tier, path, uncheckable: [...new Set(uncheckable)] };
}

/* ───────── Next step ───────── */

export type NextStep = "grant" | "challenge" | "license" | "manual_review";

/**
 * Pure: what the gate does after the precheck. OTP is offered ONCE per claim, only when the
 * silent check fell short and an on-file email exists and transport is live.
 */
export function decideNext(a: {
  tier: Tier;
  confidence: number;
  recordEmail: string | null;
  transportReady: boolean;
  challengeIssued: boolean;
  licenseProvided: boolean;
  briefWantsCredential: boolean;
  recordHasLicense: boolean;
}): NextStep {
  if (a.tier >= 1) return "grant";
  if (a.recordEmail && a.transportReady && !a.challengeIssued) return "challenge";
  if (
    a.briefWantsCredential &&
    a.recordHasLicense &&
    !a.licenseProvided &&
    a.confidence >= 50
  )
    return "license";
  return "manual_review";
}

/** claim_queue.status for a gate state (values allowed by claim_queue_status_check). */
export function queueStatus(next: NextStep | "granted" | "released" | "rejected"): string {
  switch (next) {
    case "granted":
      return "auto_approved";
    case "released":
      return "released";
    case "rejected":
      return "rejected";
    case "manual_review":
      return "manual_review";
    default:
      return "pending";
  }
}

/** The submitClaim response status the claim page already renders. */
export type UiStatus = "approved" | "needs_verification" | "manual_review" | "already_claimed";
export function uiStatus(next: NextStep | "granted" | Refusal): UiStatus {
  if (next === "granted" || next === "grant" || next === "already_owner") return "approved";
  if (next === "challenge" || next === "license") return "needs_verification";
  if (next === "claimed_by_other") return "already_claimed";
  return "manual_review";
}

/* ───────── OTP ───────── */

export const OTP_TTL_MINUTES = 15;
export const OTP_MAX_ATTEMPTS = 5;
export type OtpOutcome = "verified" | "mismatch" | "expired" | "locked" | "none";

/** Pure mirror of exp_claim_gate_verify_otp, for tests and UI copy. */
export function otpOutcome(a: {
  challenge: { status: string; expiresAt: string; attempts: number } | null;
  matches: boolean;
  now?: Date;
}): OtpOutcome {
  const c = a.challenge;
  if (!c || c.status !== "sent") return "none";
  if (new Date(c.expiresAt).getTime() <= (a.now ?? new Date()).getTime()) return "expired";
  if (c.attempts >= OTP_MAX_ATTEMPTS) return "locked";
  return a.matches ? "verified" : "mismatch";
}
