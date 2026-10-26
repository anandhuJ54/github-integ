import { expect, test, describe } from "bun:test";
import {
  advanceTier,
  briefWantsCredential,
  claimRefusal,
  decideNext,
  domainMatches,
  maskEmail,
  otpOutcome,
  queueStatus,
  requiredTier,
  scorePrecheck,
  tierAllows,
  uiStatus,
  websiteHost,
  type BriefClaim,
  type ClaimRecord,
  type Claimant,
} from "../src/lib/nora/claim-gate";
import { otpHash } from "../src/lib/nora/claim-otp.server";

const record = (o: Partial<ClaimRecord> = {}): ClaimRecord => ({
  recordType: "professional",
  id: "p1",
  name: "Jane Agent",
  email: null,
  websiteUrl: "https://www.statefarm.com/agent/us/ky/x/jane-agent",
  telephone: "+15555550100",
  licenseNumber: "KY-12345",
  placeId: "ChIJ123",
  claimed: false,
  ownerUserId: null,
  active: true,
  ...o,
});
const claimant = (o: Partial<Claimant> = {}): Claimant => ({
  userId: "u1",
  email: "jane.agent@statefarm.com",
  emailVerified: true,
  name: "Jane Agent",
  ...o,
});
const key = (key: string, schemaProperty = key) => ({
  key,
  label: key,
  schemaProperty,
  source: "derived" as const,
});
const briefWithCredential: BriefClaim = {
  claimable: true,
  keys: [key("name"), key("email"), key("credential_id", "hasCredential.identifier")],
};
const briefPlain: BriefClaim = { claimable: true, keys: [key("name"), key("email")] };

describe("tiers", () => {
  test("harmful actions need T2; unknown actions default to T2", () => {
    expect(requiredTier("view")).toBe(0);
    expect(requiredTier("organize_graph")).toBe(1);
    expect(requiredTier("change_nap")).toBe(2);
    expect(requiredTier("something_new")).toBe(2);
    expect(tierAllows(1, "publish")).toBe(false);
    expect(tierAllows(2, "publish")).toBe(true);
    expect(tierAllows(0, "preview")).toBe(true);
    expect(tierAllows(null, "view")).toBe(false);
  });
  test("tiers only go up; out-of-range is refused", () => {
    expect(advanceTier(0, 1)).toBe(1);
    expect(advanceTier(2, 1)).toBe(2);
    expect(advanceTier(1, 1)).toBe(1);
    expect(() => advanceTier(0, 3)).toThrow();
    expect(() => advanceTier(0, -1)).toThrow();
    expect(() => advanceTier(0, 1.5)).toThrow();
  });
});

describe("refusals", () => {
  test("missing / inactive / not claimable", () => {
    expect(claimRefusal(null, claimant(), [], briefPlain)).toBe("record_not_found");
    expect(claimRefusal(record({ active: false }), claimant(), [], briefPlain)).toBe(
      "record_inactive",
    );
    expect(claimRefusal(record(), claimant(), [], { claimable: false, keys: [] })).toBe(
      "not_claimable",
    );
  });
  test("already owner vs claimed by someone else — never a silent takeover", () => {
    expect(
      claimRefusal(record(), claimant(), [{ userId: "u1", status: "verified", trustTier: 1 }], null),
    ).toBe("already_owner");
    expect(
      claimRefusal(record({ claimed: true, ownerUserId: "u1" }), claimant(), [], null),
    ).toBe("already_owner");
    expect(
      claimRefusal(record(), claimant(), [{ userId: "u2", status: "verified", trustTier: 2 }], null),
    ).toBe("claimed_by_other");
    expect(claimRefusal(record({ claimed: true, ownerUserId: "u2" }), claimant(), [], null)).toBe(
      "claimed_by_other",
    );
  });
  test("a competing PENDING claim does not refuse (it becomes a conflict at grant)", () => {
    expect(
      claimRefusal(record(), claimant(), [{ userId: "u2", status: "pending", trustTier: 0 }], null),
    ).toBeNull();
  });
});

describe("silent precheck", () => {
  test("GBP Place ID match is dispositive → T2", () => {
    const p = scorePrecheck({
      record: record(),
      claimant: claimant({ name: "Someone Else", email: "x@gmail.com" }),
      brief: briefWithCredential,
      managed: { placeIds: ["ChIJ999", "ChIJ123"] },
    });
    expect(p.tier).toBe(2);
    expect(p.path).toBe("gbp_place_id");
    expect(p.confidence).toBe(100);
  });
  test("integration not live → no Place ID signal, never faked", () => {
    const p = scorePrecheck({ record: record(), claimant: claimant(), brief: briefPlain, managed: null });
    expect(p.signals.place_id.matched).toBe(false);
    expect(p.signals.place_id.detail).toBe("not_configured");
  });
  test("verified OAuth email = on-file email + name → T1", () => {
    const p = scorePrecheck({
      record: record({ email: "Jane.Agent@statefarm.com" }),
      claimant: claimant(),
      brief: briefWithCredential,
      managed: null,
    });
    expect(p.tier).toBe(1);
    expect(p.path).toBe("email_exact");
  });
  test("unverified OAuth email never counts as exact", () => {
    const p = scorePrecheck({
      record: record({ email: "jane.agent@statefarm.com" }),
      claimant: claimant({ emailVerified: false }),
      brief: briefPlain,
      managed: null,
    });
    expect(p.signals.email_exact.matched).toBe(false);
  });
  test("domain + name clears T1 only with the brief's credential key when the brief asks for one", () => {
    const noLic = scorePrecheck({
      record: record(),
      claimant: claimant(),
      brief: briefWithCredential,
      managed: null,
    });
    expect(noLic.signals.email_domain.matched).toBe(true);
    expect(noLic.tier).toBe(0);
    const withLic = scorePrecheck({
      record: record(),
      claimant: claimant(),
      brief: briefWithCredential,
      licenseNumber: "ky 12345",
      managed: null,
    });
    expect(withLic.tier).toBe(1);
    expect(withLic.path).toBe("domain_identity");
    expect(withLic.confidence).toBe(100);
    const plain = scorePrecheck({ record: record(), claimant: claimant(), brief: briefPlain, managed: null });
    expect(plain.tier).toBe(1);
  });
  test("generic mailbox domains never match", () => {
    const p = scorePrecheck({
      record: record({ websiteUrl: "https://gmail.com" }),
      claimant: claimant({ email: "jane@gmail.com" }),
      brief: briefPlain,
      managed: null,
    });
    expect(p.signals.email_domain.matched).toBe(false);
    expect(p.tier).toBe(0);
  });
  test("name mismatch (the imposter) stays T0 even with the right domain + licence", () => {
    const p = scorePrecheck({
      record: record(),
      claimant: claimant({ name: "Rival Agent", email: "rival@statefarm.com" }),
      brief: briefWithCredential,
      licenseNumber: "KY-12345",
      managed: null,
    });
    expect(p.tier).toBe(0);
  });
  test("brief keys with no value on file are reported uncheckable", () => {
    const p = scorePrecheck({
      record: record({ licenseNumber: null, email: null }),
      claimant: claimant(),
      brief: briefWithCredential,
      managed: null,
    });
    expect(p.uncheckable.sort()).toEqual(["email", "licenseNumber"]);
    expect(briefWantsCredential(briefWithCredential)).toBe(true);
    expect(briefWantsCredential(briefPlain)).toBe(false);
  });
});

describe("next step", () => {
  const base = {
    tier: 0 as const,
    confidence: 35,
    recordEmail: "jane@x.com",
    transportReady: true,
    challengeIssued: false,
    licenseProvided: false,
    briefWantsCredential: true,
    recordHasLicense: true,
  };
  test("T1+ grants", () => {
    expect(decideNext({ ...base, tier: 1 })).toBe("grant");
    expect(decideNext({ ...base, tier: 2 })).toBe("grant");
  });
  test("OTP is offered once, only with an on-file channel and live transport", () => {
    expect(decideNext(base)).toBe("challenge");
    expect(decideNext({ ...base, challengeIssued: true })).toBe("manual_review");
    expect(decideNext({ ...base, transportReady: false })).toBe("manual_review");
    expect(decideNext({ ...base, recordEmail: null })).toBe("manual_review");
  });
  test("licence prompt when the brief wants it, the record has it and confidence is decent", () => {
    expect(decideNext({ ...base, transportReady: false, confidence: 70 })).toBe("license");
    expect(decideNext({ ...base, transportReady: false, confidence: 70, licenseProvided: true })).toBe(
      "manual_review",
    );
    expect(decideNext({ ...base, transportReady: false, confidence: 70, recordHasLicense: false })).toBe(
      "manual_review",
    );
  });
  test("statuses stay inside claim_queue_status_check and the page's states", () => {
    const allowed = ["pending", "auto_approved", "manual_review", "approved", "rejected", "conflict", "released"];
    for (const s of ["grant", "challenge", "license", "manual_review", "granted", "released", "rejected"] as const)
      expect(allowed).toContain(queueStatus(s));
    expect(uiStatus("granted")).toBe("approved");
    expect(uiStatus("challenge")).toBe("needs_verification");
    expect(uiStatus("license")).toBe("needs_verification");
    expect(uiStatus("claimed_by_other")).toBe("already_claimed");
    expect(uiStatus("already_owner")).toBe("approved");
    expect(uiStatus("manual_review")).toBe("manual_review");
  });
});

describe("OTP", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const live = { status: "sent", expiresAt: "2026-10-11T12:10:00Z", attempts: 0 };
  test("outcomes", () => {
    expect(otpOutcome({ challenge: null, matches: true, now })).toBe("none");
    expect(otpOutcome({ challenge: live, matches: true, now })).toBe("verified");
    expect(otpOutcome({ challenge: live, matches: false, now })).toBe("mismatch");
    expect(otpOutcome({ challenge: { ...live, expiresAt: "2026-10-11T11:59:00Z" }, matches: true, now })).toBe(
      "expired",
    );
    expect(otpOutcome({ challenge: { ...live, attempts: 5 }, matches: true, now })).toBe("locked");
    expect(otpOutcome({ challenge: { ...live, status: "verified" }, matches: true, now })).toBe("none");
  });
  test("hash is keyed and bound to the claim", () => {
    const a = otpHash("c1", "123456", "secret");
    expect(a).toBe(otpHash("c1", " 123456 ", "secret"));
    expect(a).not.toBe(otpHash("c2", "123456", "secret"));
    expect(a).not.toBe(otpHash("c1", "123456", "other"));
    expect(a).not.toContain("123456");
  });
});

describe("helpers", () => {
  test("domains / masking", () => {
    expect(websiteHost("www.Example.com/x")).toBe("example.com");
    expect(domainMatches("statefarm.com", "agents.statefarm.com")).toBe(true);
    expect(domainMatches("evil-statefarm.com", "statefarm.com")).toBe(false);
    expect(maskEmail("jane@x.com")).toBe("j•••@x.com");
    expect(maskEmail("bad")).toBe("");
  });
});
