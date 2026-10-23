import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SkillRun } from "@/lib/nora-runner";
import {
  REFUSAL_MESSAGE,
  decideNext,
  uiStatus,
  type NextStep,
  type Refusal,
  type Signal,
  type Tier,
  type UiStatus,
} from "@/lib/nora/claim-gate";

/*
 * Claim server functions — thin orchestration over the NORA claim gate. Every step is a live
 * run of a registered claim_* skill (executeSkillRun → exp_skill_run row), and every write is
 * a governed DB function (exp_claim_gate_*), which writes exp_claim + claim_queue +
 * exp_claim_events + the owner grant + professionals.claimed together. Nothing here writes a
 * table directly.
 *
 * The claimant's own click is the approval + consent for these runs (trigger "manual").
 */

const submitInput = z.object({
  professionalId: z.string().uuid(),
  licenseNumber: z.string().trim().max(64).optional().nullable(),
});
const verifyInput = z.object({
  professionalId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});
const releaseInput = z.object({
  professionalId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export type ClaimResponse = {
  status: UiStatus;
  confidence?: number;
  signals?: Record<string, Signal>;
  professionalId?: string;
  needsLicense?: boolean;
  tier?: Tier;
  challenge?: { sent: boolean; destination: string | null } | null;
  otp?: string;
  message?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function gate() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { capabilityHandlers } = await import("@/lib/nora-capabilities.server");
  const { executeSkillRun } = await import("@/lib/nora-runner.server");
  const db = supabaseAdmin as Db;
  const handlers = capabilityHandlers(supabaseAdmin);
  return {
    db,
    /** One live claim-skill run; returns the named capability's outputs or throws the refusal. */
    async run(
      actor: string,
      skillKey: string,
      entityId: string,
      inputs: Record<string, unknown>,
      capability: string,
    ): Promise<Record<string, unknown>> {
      const run: SkillRun = await executeSkillRun({
        db,
        writer: db,
        actor,
        data: {
          skillKey,
          entityId,
          mode: "live",
          trigger: "manual",
          inputs,
          approval: { approved: true, consent: true },
        },
        handlers,
      });
      if (run.verdict !== "executed") {
        const gov = (run.outputs as { governance?: { live_blockers?: string[] } }).governance;
        throw new Error(
          `Claim step ${skillKey} ${run.verdict}: ${run.error ?? gov?.live_blockers?.join("; ") ?? "refused"}`,
        );
      }
      const caps = (run.outputs as { capabilities?: Record<string, Record<string, unknown>> })
        .capabilities;
      return caps?.[capability] ?? {};
    },
  };
}

/** Canonical exp_entity for the published record (linked / created by the governed function). */
async function entityFor(db: Db, recordType: "professional" | "organization", id: string) {
  const { data, error } = await db.rpc("exp_entity_for_record", {
    p_record_type: recordType,
    p_record_id: id,
    p_create: true,
  });
  if (error) throw new Error(`exp_entity_for_record: ${error.message}`);
  if (!data) throw new Error("Profile not found");
  return String(data);
}

async function myClaim(db: Db, entityId: string, userId: string, statuses: string[]) {
  const { data, error } = await db
    .from("exp_claim")
    .select("claim_id,status,trust_tier")
    .eq("entity_id", entityId)
    .eq("user_id", userId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`exp_claim: ${error.message}`);
  return data as { claim_id: string; status: string; trust_tier: number } | null;
}

export const submitClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => submitInput.parse(data))
  .handler(async ({ data, context }): Promise<ClaimResponse> => {
    const userId = context.userId;
    const g = await gate();
    const entityId = await entityFor(g.db, "professional", data.professionalId);

    // 1. Silent precheck (GBP Place ID + held signals + brief keys). Read-only.
    const pre = await g.run(
      userId,
      "claim_silent_precheck",
      entityId,
      { licenseNumber: data.licenseNumber ?? null },
      "claim_precheck",
    );
    const refusal = pre.refusal as Refusal | null;
    if (refusal === "claimed_by_other" || refusal === "already_owner")
      return { status: uiStatus(refusal), professionalId: data.professionalId };
    if (refusal) throw new Error(REFUSAL_MESSAGE[refusal]);

    const confidence = Number(pre.confidence ?? 0);
    const signals = (pre.signals ?? {}) as Record<string, Signal>;
    let next = pre.next as NextStep;
    const base = { confidence, signals, professionalId: data.professionalId };

    // 2. Open / raise the claim at the earned tier (T0 at minimum: authenticated).
    const started = await g.run(
      userId,
      "claim_initiate",
      entityId,
      {
        claim_id: pre.claim_id ?? null,
        tier: Number(pre.tier ?? 0),
        path: pre.path ?? null,
        confidence,
        signals,
        queue_status: next === "manual_review" ? "manual_review" : null,
      },
      "claim_gate_write",
    );
    if (started.status === "claimed_by_other" || started.status === "already_owner")
      return { status: uiStatus(started.status as Refusal), ...base };
    if (started.status !== "pending") throw new Error(`Claim could not start (${started.status})`);
    const claimId = String(started.claim_id);
    const tier = Number(started.trust_tier ?? 0) as Tier;
    if (tier >= 1) next = "grant";

    // 3a. Earned T1+: bind now.
    if (next === "grant") {
      const granted = await g.run(userId, "claim_grant", entityId, { claim_id: claimId }, "claim_bind");
      return { status: "approved", ...base, tier: Number(granted.trust_tier ?? tier) as Tier };
    }

    // 3b. Short of T1: ONE explained OTP to the on-file email, only if transport is live.
    if (next === "challenge") {
      if (pre.challenge_active)
        return { status: "needs_verification", ...base, tier, challenge: { sent: true, destination: null } };
      const sent = await g.run(userId, "claim_challenge", entityId, { claim_id: claimId }, "otp_send");
      if (sent.status === "sent")
        return {
          status: "needs_verification",
          ...base,
          tier,
          challenge: { sent: true, destination: (sent.destination as string) ?? null },
        };
      // not_configured / no_channel / already_issued → the next cheapest path.
      next = decideNext({
        tier,
        confidence,
        recordEmail: null,
        transportReady: false,
        challengeIssued: true,
        licenseProvided: !!data.licenseNumber,
        briefWantsCredential: !!pre.wants_credential,
        recordHasLicense: !!pre.record_has_license,
      });
    }

    if (next === "license")
      return { status: "needs_verification", ...base, tier, needsLicense: true, challenge: null };

    // 3c. Manual review (staff adjudicate via exp_claim_queue_adjudicate).
    if (pre.next !== "manual_review")
      await g.run(
        userId,
        "claim_initiate",
        entityId,
        { claim_id: claimId, tier, queue_status: "manual_review" },
        "claim_gate_write",
      );
    return { status: "manual_review", ...base, tier };
  });

export const verifyClaimCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verifyInput.parse(data))
  .handler(async ({ data, context }): Promise<ClaimResponse> => {
    const userId = context.userId;
    const g = await gate();
    const { otpHash } = await import("@/lib/nora/claim-otp.server");
    const entityId = await entityFor(g.db, "professional", data.professionalId);
    const claim = await myClaim(g.db, entityId, userId, ["pending"]);
    if (!claim) throw new Error("No open claim for this profile.");
    const res = await g.run(
      userId,
      "claim_verify_email",
      entityId,
      { claim_id: claim.claim_id, code_hash: otpHash(claim.claim_id, data.code) },
      "otp_verify",
    );
    const outcome = String(res.outcome ?? "none");
    if (outcome !== "verified") {
      const locked = outcome === "expired" || outcome === "locked" || outcome === "none";
      return {
        status: locked ? "manual_review" : "needs_verification",
        professionalId: data.professionalId,
        otp: outcome,
        challenge: locked ? null : { sent: true, destination: null },
        message:
          outcome === "mismatch"
            ? `That code didn't match (${res.attempts_left ?? 0} tries left).`
            : "That code can no longer be used — our team will review your claim.",
      };
    }
    const granted = await g.run(
      userId,
      "claim_grant",
      entityId,
      { claim_id: claim.claim_id },
      "claim_bind",
    );
    return {
      status: "approved",
      professionalId: data.professionalId,
      tier: Number(granted.trust_tier ?? 1) as Tier,
    };
  });

/** One-tap unclaim / reset of the caller's own claim (pending or granted). */
export const releaseClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => releaseInput.parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const g = await gate();
    const entityId = await entityFor(g.db, "professional", data.professionalId);
    const claim = await myClaim(g.db, entityId, userId, ["verified", "pending"]);
    if (!claim) return { status: "noop" as const };
    const res = await g.run(
      userId,
      "claim_release",
      entityId,
      { claim_id: claim.claim_id, reason: data.reason ?? null },
      "claim_unbind",
    );
    return { status: String(res.status ?? "released") };
  });
