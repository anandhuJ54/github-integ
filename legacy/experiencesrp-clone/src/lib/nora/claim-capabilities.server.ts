import type { HandlerContext, HandlerRegistry } from "@/lib/nora-runner";
import { compileCategoryBrief, entityBriefForOffice } from "@/lib/category-brief";
import { loadCategoryBriefRows } from "@/lib/category-brief.functions";
import { withIntegration } from "@/lib/nora/integrations-adapter.server";
import { generateOtp, otpHash } from "@/lib/nora/claim-otp.server";
import { isSinglePro, loadOfficeMode } from "@/lib/office-mode";
import {
  OTP_TTL_MINUTES,
  briefWantsCredential,
  claimRefusal,
  decideNext,
  maskEmail,
  scorePrecheck,
  type BriefClaim,
  type ClaimRecord,
  type Claimant,
  type ExistingClaim,
  type ManagedLocations,
} from "@/lib/nora/claim-gate";

/*
 * Claim-gate capability handlers (registered in nora-capabilities.server.ts). Each one is
 * reached only through a claim_* skill run, so every step leaves an exp_skill_run row.
 *
 *   gbp_list_locations  read   GBP locations the claimant manages (stub until creds — never faked)
 *   claim_precheck      read   silent precheck → refusal | tier | next step
 *   claim_gate_write    write  exp_claim_gate_start / _advance
 *   otp_send            write  exp_claim_gate_challenge (one OTP per claim, via exp_outbox)
 *   otp_verify          write  exp_claim_gate_verify_otp → T1
 *   claim_bind          write  exp_claim_gate_grant (both sides, atomically)
 *   claim_unbind        write  exp_claim_gate_release
 *
 * The write functions are service-role only in the database, so these handlers only work
 * with the service client the claim gate passes (claim.functions.ts). From the console's
 * RLS client they fail closed. The actor always comes from HandlerContext.actor, never
 * from inputs; the OTP code never appears in inputs/outputs (only its HMAC).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function need(ctx: HandlerContext, what: string) {
  if (!ctx.actor) throw new Error(`${what} needs an acting user`);
  if (!ctx.entity || !UUID.test(ctx.entity.ref)) throw new Error(`${what} needs an exp_entity id`);
  return { actor: ctx.actor, entityId: ctx.entity.ref };
}
function rpcOut<T>(res: { data: T | null; error: { message: string } | null }, fn: string): T {
  if (res.error) throw new Error(`${fn}: ${res.error.message}`);
  return res.data as T;
}
function str(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** professionals row → ClaimRecord (shared by the plain and the single-pro office paths). */
async function loadProfessionalRecord(db: Db, id: string) {
  const p = rpcOut<Record<string, unknown> | null>(
    await db
      .from("professionals")
      .select(
        "id,display_name,first_name,last_name,email,website_url,phone,primary_license_number,gbp_place_id,claimed,user_id,is_active,gcid",
      )
      .eq("id", id)
      .maybeSingle(),
    "professionals",
  );
  if (!p) return null;
  return {
    gcid: (p.gcid as string) ?? null,
    record: {
      recordType: "professional",
      id: String(p.id),
      name:
        (p.display_name as string) ??
        ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
      email: (p.email as string) ?? null,
      websiteUrl: (p.website_url as string) ?? null,
      telephone: (p.phone as string) ?? null,
      licenseNumber: (p.primary_license_number as string) ?? null,
      placeId: (p.gbp_place_id as string) ?? null,
      claimed: !!p.claimed,
      ownerUserId: (p.user_id as string) ?? null,
      active: p.is_active !== false,
    } satisfies ClaimRecord,
  };
}

/**
 * exp_entity → its published record (professionals / organizations), normalised.
 *
 * Single-pro office (exp_office_mode = 'single_pro', migration 0027): whichever record the entity
 * links to, the claim ACTS AS THE PROFESSIONAL — name / email / licence key / owner come from the
 * professionals row, entityType is 'professional' (so the brief's professional claim keys, incl.
 * the credential id, apply) and `claimEntityId` is the professional's exp_entity (claims, OTP and
 * the grant live there). The Place ID for the T2 path is the LOCATION's (the pro's own is the
 * fallback), and the record is "claimed" if either side already is.
 */
export async function loadClaimRecord(
  db: Db,
  entityId: string,
): Promise<{
  record: ClaimRecord | null;
  gcid: string | null;
  entityType: string | null;
  claimEntityId: string;
}> {
  const ent = rpcOut<{ entity_type: string; identity_keys: Record<string, string> | null } | null>(
    await db
      .from("exp_entity")
      .select("entity_type,identity_keys")
      .eq("entity_id", entityId)
      .maybeSingle(),
    "exp_entity",
  );
  const keys = ent?.identity_keys ?? {};
  const none = { record: null, gcid: null, entityType: ent?.entity_type ?? null, claimEntityId: entityId };

  const office = keys.professional_id
    ? await loadOfficeMode(db, "professional", keys.professional_id)
    : keys.organization_id
      ? await loadOfficeMode(db, "organization", keys.organization_id)
      : null;
  if (isSinglePro(office)) {
    const pro = await loadProfessionalRecord(db, office.professionalId!);
    if (!pro) return none;
    const loc = rpcOut<{ gbp_place_id: string | null; claimed: boolean | null } | null>(
      await db
        .from("organizations")
        .select("gbp_place_id,claimed")
        .eq("id", office.locationId!)
        .maybeSingle(),
      "organizations",
    );
    const placeId = loc?.gbp_place_id ?? pro.record.placeId;
    const claimEntityId = keys.professional_id
      ? entityId
      : (rpcOut<string | null>(
          await db.rpc("exp_entity_for_record", {
            p_record_type: "professional",
            p_record_id: office.professionalId,
            p_create: true,
          }),
          "exp_entity_for_record",
        ) ?? entityId);
    return {
      gcid: pro.gcid,
      entityType: "professional",
      claimEntityId,
      record: {
        ...pro.record,
        placeId,
        claimed: pro.record.claimed || !!loc?.claimed,
        office: {
          mode: "single_pro",
          professionalId: office.professionalId!,
          locationId: office.locationId!,
          placeIdSource: loc?.gbp_place_id ? "location" : pro.record.placeId ? "professional" : null,
        },
      },
    };
  }

  if (keys.professional_id) {
    const pro = await loadProfessionalRecord(db, keys.professional_id);
    if (!pro) return none;
    return { ...pro, entityType: "professional", claimEntityId: entityId };
  }
  if (keys.organization_id) {
    const o = rpcOut<Record<string, unknown> | null>(
      await db
        .from("organizations")
        .select("id,name,email,website_url,phone,gbp_place_id,claimed,is_active,gcid")
        .eq("id", keys.organization_id)
        .maybeSingle(),
      "organizations",
    );
    if (!o) return none;
    return {
      gcid: (o.gcid as string) ?? null,
      entityType: ent?.entity_type ?? "location",
      claimEntityId: entityId,
      record: {
        recordType: "organization",
        id: String(o.id),
        name: (o.name as string) ?? null,
        email: (o.email as string) ?? null,
        websiteUrl: (o.website_url as string) ?? null,
        telephone: (o.phone as string) ?? null,
        licenseNumber: null,
        placeId: (o.gbp_place_id as string) ?? null,
        claimed: !!o.claimed,
        ownerUserId: null,
        active: o.is_active !== false,
      },
    };
  }
  return none;
}

/** The claimant as the auth provider asserts it (service client only). */
async function loadClaimant(db: Db, userId: string): Promise<Claimant> {
  if (!db?.auth?.admin?.getUserById) throw new Error("claimant identity needs the service client");
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new Error(`auth user: ${error?.message ?? "not found"}`);
  const u = data.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  return {
    userId,
    email: u.email ?? null,
    emailVerified: !!u.email_confirmed_at,
    name: str(meta.full_name) ?? str(meta.name),
  };
}

/**
 * Category brief view for the entity type — the source of the verification keys. A single-pro
 * office uses the professional's claim keys (licence / credential id), via entityBriefForOffice.
 */
async function loadBriefClaim(db: Db, gcid: string | null, entityType: string | null, record: ClaimRecord | null) {
  if (!gcid) return null;
  const brief = compileCategoryBrief(await loadCategoryBriefRows(db, gcid));
  const ob = entityBriefForOffice(brief, record?.office?.mode ?? null, entityType);
  return ob ? ({ claimable: ob.claim.claimable, keys: ob.claim.keys } satisfies BriefClaim) : null;
}

async function transportReady(db: Db) {
  const { data, error } = await db
    .from("exp_app_config")
    .select("value")
    .eq("key", "sendgrid_api_key")
    .maybeSingle();
  if (error) return false;
  return !!(data?.value && String(data.value).trim());
}

export function claimCapabilityHandlers(db: Db): HandlerRegistry {
  return {
    /** GBP locations the claimant manages — Place IDs only. Stub until GBP creds; never faked. */
    gbp_list_locations: {
      readOnly: true,
      async run() {
        const res = await withIntegration<string[]>("google_business_profile", async () => {
          // Live path needs the claimant's business.manage OAuth token (per user), which the
          // sign-in flow does not capture yet. Fail loudly rather than guess.
          throw new Error("GBP managed-locations call needs the claimant's business.manage token");
        });
        if (!res.ok) return { outputs: { status: res.status, reason: res.reason, place_ids: null } };
        return { outputs: { status: "live", place_ids: res.data } };
      },
    },

    /** Silent precheck: refusal → tier → next step, from signals already held. */
    claim_precheck: {
      readOnly: true,
      async run(ctx) {
        const { actor, entityId } = need(ctx, "claim_precheck");
        // single-pro office: claims live on the professional's entity (claimEntityId)
        const { record, gcid, entityType, claimEntityId } = await loadClaimRecord(db, entityId);
        const claimant = await loadClaimant(db, actor);
        const brief = await loadBriefClaim(db, gcid, entityType, record);
        const claims =
          rpcOut<{ claim_id: string; user_id: string; status: string; trust_tier: number }[]>(
            await db
              .from("exp_claim")
              .select("claim_id,user_id,status,trust_tier")
              .eq("entity_id", claimEntityId)
              .in("status", ["pending", "verified"]),
            "exp_claim",
          ) ?? [];
        const existing: ExistingClaim[] = claims.map((c) => ({
          userId: c.user_id,
          status: c.status,
          trustTier: c.trust_tier ?? 0,
        }));
        const refusal = claimRefusal(record, claimant, existing, brief);
        const gbp = ctx.prior.gbp_list_locations as { place_ids?: string[] | null } | undefined;
        const managed: ManagedLocations = gbp?.place_ids ? { placeIds: gbp.place_ids } : null;
        const mine = claims.find((c) => c.user_id === actor && c.status === "pending") ?? null;
        let challengeIssued = false;
        let challengeActive = false;
        if (mine) {
          const reqs =
            rpcOut<{ status: string; expires_at: string | null }[]>(
              await db
                .from("exp_verification_requests")
                .select("status,expires_at")
                .eq("claim_id", mine.claim_id),
              "exp_verification_requests",
            ) ?? [];
          challengeIssued = reqs.length > 0;
          challengeActive = reqs.some(
            (r) =>
              r.status === "sent" && !!r.expires_at && new Date(r.expires_at).getTime() > Date.now(),
          );
        }
        if (!record || refusal)
          return {
            outputs: { refusal, claim_id: mine?.claim_id ?? null, record_type: record?.recordType ?? null },
          };
        const license = str(ctx.inputs.licenseNumber);
        const pre = scorePrecheck({ record, claimant, brief, licenseNumber: license, managed });
        const tier = Math.max(pre.tier, mine?.trust_tier ?? 0) as 0 | 1 | 2;
        const ready = await transportReady(db);
        const next = challengeActive
          ? "challenge"
          : decideNext({
              tier,
              confidence: pre.confidence,
              recordEmail: record.email,
              transportReady: ready,
              challengeIssued,
              licenseProvided: !!license,
              briefWantsCredential: briefWantsCredential(brief),
              recordHasLicense: !!record.licenseNumber,
            });
        return {
          outputs: {
            refusal: null,
            record_type: record.recordType,
            record_id: record.id,
            office: record.office ?? null,
            claim_entity_id: claimEntityId,
            claim_id: mine?.claim_id ?? null,
            confidence: pre.confidence,
            signals: pre.signals,
            tier: pre.tier,
            path: pre.path,
            effective_tier: tier,
            next,
            challenge_active: challengeActive,
            challenge_issued: challengeIssued,
            transport_ready: ready,
            uncheckable: pre.uncheckable,
            wants_credential: briefWantsCredential(brief),
            record_has_license: !!record.licenseNumber,
            brief: brief
              ? { claimable: brief.claimable, keys: brief.keys.map((k) => k.schemaProperty) }
              : null,
          },
        };
      },
    },

    /** Open (or raise) the claim at the earned tier; optionally route its queue row. */
    claim_gate_write: {
      readOnly: false,
      async run(ctx) {
        const { actor, entityId } = need(ctx, "claim_gate_write");
        const i = ctx.inputs;
        const tier = Number(i.tier ?? 0);
        const queueStatus = str(i.queue_status);
        let claimId = str(i.claim_id);
        let out: Record<string, unknown>;
        if (!claimId) {
          const { record } = await loadClaimRecord(db, entityId);
          if (!record) throw new Error("entity has no linked published record");
          const claimant = await loadClaimant(db, actor);
          out = rpcOut<Record<string, unknown>>(
            await db.rpc("exp_claim_gate_start", {
              p_actor: actor,
              p_record_type: record.recordType,
              p_record_id: record.id,
              p_tier: tier,
              p_path: str(i.path),
              p_confidence: Math.round(Number(i.confidence ?? 0)),
              p_signals: (i.signals as Record<string, unknown>) ?? {},
              p_claimant_email: claimant.email,
              p_claimant_name: claimant.name,
              p_method: str(i.method) ?? "google_oauth",
            }),
            "exp_claim_gate_start",
          );
          if (out.status !== "pending") return { outputs: out };
          claimId = String(out.claim_id);
          if (!queueStatus) return { outputs: out };
        }
        const adv = rpcOut<Record<string, unknown>>(
          await db.rpc("exp_claim_gate_advance", {
            p_actor: actor,
            p_claim: claimId,
            p_tier: tier,
            p_path: str(i.path),
            p_evidence: (i.evidence as Record<string, unknown>) ?? {},
            p_queue_status: queueStatus,
          }),
          "exp_claim_gate_advance",
        );
        return { outputs: { status: "pending", ...adv, queue_status: queueStatus } };
      },
    },

    /** One explained OTP to the on-file email (never to an address the claimant supplies). */
    otp_send: {
      readOnly: false,
      async run(ctx) {
        const { actor } = need(ctx, "otp_send");
        const claimId = str(ctx.inputs.claim_id);
        if (!claimId) throw new Error("otp_send needs claim_id");
        const code = generateOtp();
        const subject = "Your Experience.com verification code";
        const body = `<p>Someone (hopefully you) asked to claim this profile on Experience.com.</p><p>Your verification code is <strong>${code}</strong>. It expires in ${OTP_TTL_MINUTES} minutes.</p><p>If this wasn't you, ignore this email — nothing changes without the code.</p>`;
        const res = rpcOut<{ status: string; destination?: string; request_id?: string }>(
          await db.rpc("exp_claim_gate_challenge", {
            p_actor: actor,
            p_claim: claimId,
            p_code_hash: otpHash(claimId, code),
            p_subject: subject,
            p_body_html: body,
            p_ttl_minutes: OTP_TTL_MINUTES,
          }),
          "exp_claim_gate_challenge",
        );
        return {
          outputs: {
            status: res.status,
            request_id: res.request_id ?? null,
            destination: res.destination ? maskEmail(res.destination) : null,
          },
        };
      },
    },

    /** Verify the code's HMAC (computed by the server function; the code itself is never logged). */
    otp_verify: {
      readOnly: false,
      async run(ctx) {
        const { actor } = need(ctx, "otp_verify");
        const claimId = str(ctx.inputs.claim_id);
        const hash = str(ctx.inputs.code_hash);
        if (!claimId || !hash) throw new Error("otp_verify needs claim_id and code_hash");
        const res = rpcOut<Record<string, unknown>>(
          await db.rpc("exp_claim_gate_verify_otp", {
            p_actor: actor,
            p_claim: claimId,
            p_code_hash: hash,
          }),
          "exp_claim_gate_verify_otp",
        );
        return { outputs: res };
      },
    },

    /** Bind account ↔ entity at the earned tier (T1+), both sides in one transaction. */
    claim_bind: {
      readOnly: false,
      async run(ctx) {
        const { actor } = need(ctx, "claim_bind");
        const claimId = str(ctx.inputs.claim_id);
        if (!claimId) throw new Error("claim_bind needs claim_id");
        const res = rpcOut<Record<string, unknown>>(
          await db.rpc("exp_claim_gate_grant", { p_actor: actor, p_claim: claimId }),
          "exp_claim_gate_grant",
        );
        return { outputs: res };
      },
    },

    /** One-tap unclaim / reset. */
    claim_unbind: {
      readOnly: false,
      async run(ctx) {
        const { actor } = need(ctx, "claim_unbind");
        const claimId = str(ctx.inputs.claim_id);
        if (!claimId) throw new Error("claim_unbind needs claim_id");
        const res = rpcOut<Record<string, unknown>>(
          await db.rpc("exp_claim_gate_release", {
            p_claim: claimId,
            p_reason: str(ctx.inputs.reason),
            p_actor: actor,
          }),
          "exp_claim_gate_release",
        );
        return { outputs: res };
      },
    },
  };
}
