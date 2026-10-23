# Claim gate patch: single-professional office

**Target branch:** `nora-os/claim-gate` (commit `41dc12b`). Not applied. That branch was not edited.
**Depends on:** `drizzle/migrations/0027_single_pro_office.sql` (`exp_office_mode`), plus
`src/lib/office-mode.ts` and `entityBriefForOffice` in `src/lib/category-brief.ts`. All of these are on
branch `nora-os/single-pro-office`, so merge that branch first.

## Rule (Scott, 2026-10-11)

The rule applies when the office's category supports both professionals and locations and the office
has exactly one active professional (`exp_office_mode` returns `single_pro`). In that case:

- The claim acts as the **professional**. Name, email, licence key (the brief's `credential_id`
  claim key), owner (`professionals.user_id`) and the `exp_claim` row all belong to the professional's
  `exp_entity`, whichever record the claimant started from.
- The T2 GBP path matches the **location's** Place ID (`organizations.gbp_place_id`). If the location
  has none, it falls back to the professional's Place ID: on 2026-10-11, 9,546 of the 9,899 single-pro
  Place IDs sat only on the professional, and no pair conflicted.
- The **grant covers both records**: the professional is claimed (as today), the location gets
  `claimed = true`, and the owner gets a second entity-scoped `owner` grant on the location's
  `exp_entity`. That `exp_entity` takes the same `claim_state`, and `exp_claim_tier()` on the
  location returns the professional's claim tier. This lets T2 listing actions on the location
  (`change_nap`, `publish`) pass. Release undoes both sides.

## Changes, by file

1. **`src/lib/nora/claim-gate.ts`** (pure): `ClaimRecord.office?` is a new field holding
   `{mode:'single_pro', professionalId, locationId, placeIdSource}`. The precheck `place_id` signal
   detail now names the source. Scoring logic and tiers are unchanged: `scorePrecheck` already reads
   `record.placeId`, and the loader now fills it with the location's ID. The 20 tests in
   `tests/claim-gate.test.ts` still pass.
2. **`src/lib/nora/claim-capabilities.server.ts`**:
   - `loadClaimRecord` calls `loadOfficeMode` on the linked record. In `single_pro` mode it loads the
     **professional** row (through the new helper `loadProfessionalRecord`, which is the old
     professional branch moved out unchanged) and returns `entityType: 'professional'`. It sets
     `placeId` to the location's ID, falling back to the professional's, and sets
     `claimed = pro.claimed || location.claimed`. It returns `claimEntityId`, which is the
     professional's `exp_entity`, resolved with `exp_entity_for_record('professional', id, true)`
     when the claimant started from the location.
   - `loadBriefClaim` uses `entityBriefForOffice(brief, mode, entityType)`, so a single-pro office
     gets the professional's claim keys, including the licence key.
   - `claim_precheck` looks up existing claims and OTP state on `claimEntityId`, and outputs
     `office` and `claim_entity_id`.
   - `claim_gate_write` is unchanged: it already starts the claim from `loadClaimRecord().record`,
     which is now the professional.
   - Typechecked against main plus the branch's helper files. The only `tsc` errors are the branch's
     own `HandlerContext.actor` additions, which main does not have.
3. **`drizzle/migrations/0021_claim_gate.sql`**. Fold these into 0021 before it is applied, or ship
   them as `CREATE OR REPLACE` in a migration after 0027:
   - `exp_claim_gate_start`: refuses to open a claim on the organization of a single-pro office (it
     names the professional instead), and treats an already-claimed location as claimed.
   - `_exp_claim_grant_core`: claims the location, adds an `owner` grant on the location's
     `exp_entity` and sets its `claim_state`, and records `location_id` in the audit row and the
     return value.
   - `exp_claim_gate_release`: removes the location grant, resets the location `claim_state` and
     `organizations.claimed`.
   - `exp_claim_tier`: if the entity's record is the organization of a single-pro office, it returns
     the user's verified claim tier on the professional's entity. This is a read-only lookup, because
     the function is STABLE.

## Open items

- `exp_claim_adjudicate` (staff approval) goes through `_exp_claim_grant_core`, so it inherits the
  two-sided grant automatically.
- Legacy `claim_queue` rows filed against a single-pro organization are not migrated.
  `exp_claim_gate_start` now refuses new ones.
- `organizations.is_single_pro_office` is false on every row and is not read anywhere.
  `exp_office_mode` computes the mode live.

## Exact diffs

### `src/lib/nora/claim-gate.ts`

```diff
--- a/src/lib/nora/claim-gate.ts
+++ b/src/lib/nora/claim-gate.ts
@@ -70,6 +70,17 @@
   claimed: boolean;
   ownerUserId: string | null;
   active: boolean;
+  /**
+   * Single-pro office (exp_office_mode = 'single_pro'): the record IS the professional (identity,
+   * licence key, owner) and `placeId` is the LOCATION's Place ID (the pro's own is the fallback).
+   * The grant binds both records. Absent / null for every other mode.
+   */
+  office?: {
+    mode: "single_pro";
+    professionalId: string;
+    locationId: string;
+    placeIdSource: "location" | "professional" | null;
+  } | null;
 };
 
 export type Claimant = {
@@ -290,7 +301,9 @@
   signals.place_id = {
     matched: placeOk,
     weight: WEIGHTS.place_id,
-    detail: a.managed ? `${a.managed.placeIds.length} managed` : "not_configured",
+    detail:
+      (a.managed ? `${a.managed.placeIds.length} managed` : "not_configured") +
+      (record.office?.placeIdSource ? ` · place id from ${record.office.placeIdSource}` : ""),
   };
 
   let tier: Tier = 0;
```

### `src/lib/nora/claim-capabilities.server.ts`

```diff
--- a/src/lib/nora/claim-capabilities.server.ts
+++ b/src/lib/nora/claim-capabilities.server.ts
@@ -1,8 +1,9 @@
 import type { HandlerContext, HandlerRegistry } from "@/lib/nora-runner";
-import { compileCategoryBrief, entityBrief } from "@/lib/category-brief";
+import { compileCategoryBrief, entityBriefForOffice } from "@/lib/category-brief";
 import { loadCategoryBriefRows } from "@/lib/category-brief.functions";
 import { withIntegration } from "@/lib/nora/integrations-adapter.server";
 import { generateOtp, otpHash } from "@/lib/nora/claim-otp.server";
+import { isSinglePro, loadOfficeMode } from "@/lib/office-mode";
 import {
   OTP_TTL_MINUTES,
   briefWantsCredential,
@@ -53,11 +54,58 @@
   return typeof v === "string" && v.trim() ? v.trim() : null;
 }
 
-/** exp_entity → its published record (professionals / organizations), normalised. */
+/** professionals row → ClaimRecord (shared by the plain and the single-pro office paths). */
+async function loadProfessionalRecord(db: Db, id: string) {
+  const p = rpcOut<Record<string, unknown> | null>(
+    await db
+      .from("professionals")
+      .select(
+        "id,display_name,first_name,last_name,email,website_url,phone,primary_license_number,gbp_place_id,claimed,user_id,is_active,gcid",
+      )
+      .eq("id", id)
+      .maybeSingle(),
+    "professionals",
+  );
+  if (!p) return null;
+  return {
+    gcid: (p.gcid as string) ?? null,
+    record: {
+      recordType: "professional",
+      id: String(p.id),
+      name:
+        (p.display_name as string) ??
+        ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
+      email: (p.email as string) ?? null,
+      websiteUrl: (p.website_url as string) ?? null,
+      telephone: (p.phone as string) ?? null,
+      licenseNumber: (p.primary_license_number as string) ?? null,
+      placeId: (p.gbp_place_id as string) ?? null,
+      claimed: !!p.claimed,
+      ownerUserId: (p.user_id as string) ?? null,
+      active: p.is_active !== false,
+    } satisfies ClaimRecord,
+  };
+}
+
+/**
+ * exp_entity → its published record (professionals / organizations), normalised.
+ *
+ * Single-pro office (exp_office_mode = 'single_pro', migration 0027): whichever record the entity
+ * links to, the claim ACTS AS THE PROFESSIONAL — name / email / licence key / owner come from the
+ * professionals row, entityType is 'professional' (so the brief's professional claim keys, incl.
+ * the credential id, apply) and `claimEntityId` is the professional's exp_entity (claims, OTP and
+ * the grant live there). The Place ID for the T2 path is the LOCATION's (the pro's own is the
+ * fallback), and the record is "claimed" if either side already is.
+ */
 export async function loadClaimRecord(
   db: Db,
   entityId: string,
-): Promise<{ record: ClaimRecord | null; gcid: string | null; entityType: string | null }> {
+): Promise<{
+  record: ClaimRecord | null;
+  gcid: string | null;
+  entityType: string | null;
+  claimEntityId: string;
+}> {
   const ent = rpcOut<{ entity_type: string; identity_keys: Record<string, string> | null } | null>(
     await db
       .from("exp_entity")
@@ -67,38 +115,58 @@
     "exp_entity",
   );
   const keys = ent?.identity_keys ?? {};
-  if (keys.professional_id) {
-    const p = rpcOut<Record<string, unknown> | null>(
+  const none = { record: null, gcid: null, entityType: ent?.entity_type ?? null, claimEntityId: entityId };
+
+  const office = keys.professional_id
+    ? await loadOfficeMode(db, "professional", keys.professional_id)
+    : keys.organization_id
+      ? await loadOfficeMode(db, "organization", keys.organization_id)
+      : null;
+  if (isSinglePro(office)) {
+    const pro = await loadProfessionalRecord(db, office.professionalId!);
+    if (!pro) return none;
+    const loc = rpcOut<{ gbp_place_id: string | null; claimed: boolean | null } | null>(
       await db
-        .from("professionals")
-        .select(
-          "id,display_name,first_name,last_name,email,website_url,phone,primary_license_number,gbp_place_id,claimed,user_id,is_active,gcid",
-        )
-        .eq("id", keys.professional_id)
-        .maybeSingle(),
-      "professionals",
-    );
-    if (!p) return { record: null, gcid: null, entityType: ent?.entity_type ?? null };
+        .from("organizations")
+        .select("gbp_place_id,claimed")
+        .eq("id", office.locationId!)
+        .maybeSingle(),
+      "organizations",
+    );
+    const placeId = loc?.gbp_place_id ?? pro.record.placeId;
+    const claimEntityId = keys.professional_id
+      ? entityId
+      : (rpcOut<string | null>(
+          await db.rpc("exp_entity_for_record", {
+            p_record_type: "professional",
+            p_record_id: office.professionalId,
+            p_create: true,
+          }),
+          "exp_entity_for_record",
+        ) ?? entityId);
     return {
-      gcid: (p.gcid as string) ?? null,
+      gcid: pro.gcid,
       entityType: "professional",
+      claimEntityId,
       record: {
-        recordType: "professional",
-        id: String(p.id),
-        name:
-          (p.display_name as string) ??
-          ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
-        email: (p.email as string) ?? null,
-        websiteUrl: (p.website_url as string) ?? null,
-        telephone: (p.phone as string) ?? null,
-        licenseNumber: (p.primary_license_number as string) ?? null,
-        placeId: (p.gbp_place_id as string) ?? null,
-        claimed: !!p.claimed,
-        ownerUserId: (p.user_id as string) ?? null,
-        active: p.is_active !== false,
+        ...pro.record,
+        placeId,
+        claimed: pro.record.claimed || !!loc?.claimed,
+        office: {
+          mode: "single_pro",
+          professionalId: office.professionalId!,
+          locationId: office.locationId!,
+          placeIdSource: loc?.gbp_place_id ? "location" : pro.record.placeId ? "professional" : null,
+        },
       },
     };
   }
+
+  if (keys.professional_id) {
+    const pro = await loadProfessionalRecord(db, keys.professional_id);
+    if (!pro) return none;
+    return { ...pro, entityType: "professional", claimEntityId: entityId };
+  }
   if (keys.organization_id) {
     const o = rpcOut<Record<string, unknown> | null>(
       await db
@@ -108,10 +176,11 @@
         .maybeSingle(),
       "organizations",
     );
-    if (!o) return { record: null, gcid: null, entityType: ent?.entity_type ?? null };
+    if (!o) return none;
     return {
       gcid: (o.gcid as string) ?? null,
       entityType: ent?.entity_type ?? "location",
+      claimEntityId: entityId,
       record: {
         recordType: "organization",
         id: String(o.id),
@@ -127,7 +196,7 @@
       },
     };
   }
-  return { record: null, gcid: null, entityType: ent?.entity_type ?? null };
+  return none;
 }
 
 /** The claimant as the auth provider asserts it (service client only). */
@@ -145,12 +214,15 @@
   };
 }
 
-/** Category brief view for the entity type — the source of the verification keys. */
-async function loadBriefClaim(db: Db, gcid: string | null, entityType: string | null) {
+/**
+ * Category brief view for the entity type — the source of the verification keys. A single-pro
+ * office uses the professional's claim keys (licence / credential id), via entityBriefForOffice.
+ */
+async function loadBriefClaim(db: Db, gcid: string | null, entityType: string | null, record: ClaimRecord | null) {
   if (!gcid) return null;
   const brief = compileCategoryBrief(await loadCategoryBriefRows(db, gcid));
-  const eb = entityBrief(brief, entityType);
-  return eb ? ({ claimable: eb.claim.claimable, keys: eb.claim.keys } satisfies BriefClaim) : null;
+  const ob = entityBriefForOffice(brief, record?.office?.mode ?? null, entityType);
+  return ob ? ({ claimable: ob.claim.claimable, keys: ob.claim.keys } satisfies BriefClaim) : null;
 }
 
 async function transportReady(db: Db) {
@@ -184,15 +256,16 @@
       readOnly: true,
       async run(ctx) {
         const { actor, entityId } = need(ctx, "claim_precheck");
-        const { record, gcid, entityType } = await loadClaimRecord(db, entityId);
+        // single-pro office: claims live on the professional's entity (claimEntityId)
+        const { record, gcid, entityType, claimEntityId } = await loadClaimRecord(db, entityId);
         const claimant = await loadClaimant(db, actor);
-        const brief = await loadBriefClaim(db, gcid, entityType);
+        const brief = await loadBriefClaim(db, gcid, entityType, record);
         const claims =
           rpcOut<{ claim_id: string; user_id: string; status: string; trust_tier: number }[]>(
             await db
               .from("exp_claim")
               .select("claim_id,user_id,status,trust_tier")
-              .eq("entity_id", entityId)
+              .eq("entity_id", claimEntityId)
               .in("status", ["pending", "verified"]),
             "exp_claim",
           ) ?? [];
@@ -247,6 +320,8 @@
             refusal: null,
             record_type: record.recordType,
             record_id: record.id,
+            office: record.office ?? null,
+            claim_entity_id: claimEntityId,
             claim_id: mine?.claim_id ?? null,
             confidence: pre.confidence,
             signals: pre.signals,
```

### `drizzle/migrations/0021_claim_gate.sql`

```diff
--- a/drizzle/migrations/0021_claim_gate.sql
+++ b/drizzle/migrations/0021_claim_gate.sql
@@ -228,6 +228,16 @@
   ELSE RAISE EXCEPTION 'unknown record type %', p_record_type; END IF;
   IF NOT FOUND THEN RETURN jsonb_build_object('status', 'record_not_found'); END IF;
   IF NOT v_active THEN RETURN jsonb_build_object('status', 'record_inactive'); END IF;
+  -- Single-pro office: a claim always opens on the professional (the TS loader already swaps; this
+  -- makes the database enforce it), and an already-claimed location counts as claimed.
+  IF p_record_type = 'organization' AND exp_office_mode('organization', p_record_id)->>'mode' = 'single_pro' THEN
+    RAISE EXCEPTION 'claim gate: single-pro office % is claimed through its professional %', p_record_id,
+      exp_office_mode('organization', p_record_id)->>'professional_id';
+  END IF;
+  IF p_record_type = 'professional' AND exp_office_mode('professional', p_record_id)->>'mode' = 'single_pro' THEN
+    v_claimed := v_claimed OR coalesce((SELECT o.claimed FROM organizations o
+                                         WHERE o.id = (exp_office_mode('professional', p_record_id)->>'location_id')::uuid), false);
+  END IF;
 
   v_entity := _exp_entity_for_record(p_record_type, p_record_id, true);
   PERFORM 1 FROM exp_entity WHERE entity_id = v_entity FOR UPDATE;
@@ -414,6 +424,7 @@
 CREATE OR REPLACE FUNCTION public._exp_claim_grant_core(p_claim uuid, p_acting_role text, p_reviewer uuid, p_queue_status text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
 DECLARE r exp_claim%ROWTYPE; v_type text; v_rec uuid; v_conf smallint; n integer;
+        v_office jsonb; v_loc uuid; v_loc_entity uuid;
 BEGIN
   SELECT * INTO r FROM exp_claim WHERE claim_id = p_claim FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'claim not found'; END IF;
@@ -448,6 +459,26 @@
     UPDATE organizations SET claimed = true, claimed_at = now() WHERE id = v_rec;
   END IF;
 
+  -- Single-pro office (exp_office_mode, 0027): the grant covers BOTH records. The claim is on the
+  -- professional; the location (listings / Place ID / NAP) is marked claimed and the owner also gets
+  -- an entity-scoped 'owner' grant on the location's exp_entity, so T2 listing actions (change_nap,
+  -- publish) on the location pass the same tier. The location's exp_entity carries the same claim_state.
+  IF v_type = 'professional' THEN
+    v_office := exp_office_mode('professional', v_rec);
+    IF v_office->>'mode' = 'single_pro' THEN
+      v_loc := (v_office->>'location_id')::uuid;
+      UPDATE organizations SET claimed = true, claimed_at = now() WHERE id = v_loc;
+      v_loc_entity := _exp_entity_for_record('organization', v_loc, true);
+      PERFORM 1 FROM exp_entity WHERE entity_id = v_loc_entity FOR UPDATE;
+      UPDATE exp_entity SET claim_state = CASE WHEN r.trust_tier >= 2 THEN 'verified' ELSE 'claimed' END,
+                            last_verified_at = now(), updated_at = now()
+       WHERE entity_id = v_loc_entity;
+      INSERT INTO exp_control_grants (user_id, role, scope_type, scope_id)
+      VALUES (r.user_id, 'owner', 'entity', v_loc_entity::text)
+      ON CONFLICT (user_id, role, scope_type, scope_id) DO NOTHING;
+    END IF;
+  END IF;
+
   UPDATE claim_queue SET status = p_queue_status, trust_tier = r.trust_tier, reviewed_at = now(),
                          reviewed_by = p_reviewer, updated_at = now()
    WHERE claim_id = p_claim;
@@ -461,9 +492,11 @@
   INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
   VALUES (coalesce(p_reviewer, r.user_id), p_acting_role, 'claim_granted', p_claim::text,
           jsonb_build_object('entity', r.entity_id, 'tier', r.trust_tier, 'path', r.tier_path,
-                             'record_type', v_type, 'record_id', v_rec));
+                             'record_type', v_type, 'record_id', v_rec,
+                             'location_id', v_loc, 'location_entity', v_loc_entity));
   RETURN jsonb_build_object('status', 'granted', 'claim_id', p_claim, 'entity_id', r.entity_id,
-                            'trust_tier', r.trust_tier, 'record_type', v_type, 'record_id', v_rec);
+                            'trust_tier', r.trust_tier, 'record_type', v_type, 'record_id', v_rec,
+                            'location_id', v_loc, 'location_entity_id', v_loc_entity);
 END $$;
 
 CREATE OR REPLACE FUNCTION public.exp_claim_gate_grant(p_actor uuid, p_claim uuid)
@@ -482,6 +515,7 @@
 CREATE OR REPLACE FUNCTION public.exp_claim_gate_release(p_claim uuid, p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
 DECLARE v_service boolean := exp_claim_gate_is_service(); v_actor uuid; r exp_claim%ROWTYPE; v_type text; v_rec uuid;
+        v_office jsonb; v_loc uuid; v_loc_entity uuid;
 BEGIN
   v_actor := CASE WHEN v_service THEN p_actor ELSE auth.uid() END;
   IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
@@ -509,6 +543,24 @@
       UPDATE organizations SET claimed = false, claimed_at = NULL WHERE id = v_rec;
     END IF;
   END IF;
+  -- Single-pro office: release the location side the grant bound (grant + claimed + claim_state).
+  IF v_type = 'professional' THEN
+    v_office := exp_office_mode('professional', v_rec);
+    IF v_office->>'mode' = 'single_pro' THEN
+      v_loc := (v_office->>'location_id')::uuid;
+      v_loc_entity := _exp_entity_for_record('organization', v_loc, false);
+      IF v_loc_entity IS NOT NULL THEN
+        DELETE FROM exp_control_grants
+         WHERE user_id = r.user_id AND role = 'owner' AND scope_type = 'entity' AND scope_id = v_loc_entity::text;
+        UPDATE exp_entity SET claim_state = 'unclaimed', updated_at = now()
+         WHERE entity_id = v_loc_entity AND r.status = 'verified'
+           AND NOT EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = v_loc_entity AND status IN ('pending', 'verified'));
+      END IF;
+      IF r.status = 'verified' THEN
+        UPDATE organizations SET claimed = false, claimed_at = NULL WHERE id = v_loc;
+      END IF;
+    END IF;
+  END IF;
   UPDATE exp_entity
      SET claim_state = CASE WHEN EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = r.entity_id AND status = 'pending')
                             THEN 'claim_pending' ELSE 'unclaimed' END,
@@ -604,6 +656,20 @@
     RAISE EXCEPTION 'insufficient grant' USING ERRCODE = '42501';
   END IF;
   SELECT trust_tier INTO v_tier FROM exp_claim WHERE entity_id = p_entity AND user_id = v_user AND status = 'verified' LIMIT 1;
+  -- Single-pro office: the location's entity carries no claim of its own; its tier is the tier of the
+  -- verified claim on the office's professional (exp_office_mode, 0027).
+  IF v_tier IS NULL THEN
+    SELECT c.trust_tier INTO v_tier
+      FROM _exp_entity_record(p_entity) er
+      CROSS JOIN LATERAL exp_office_mode(er.record_type, er.record_id) om
+      -- read-only lookup (exp_claim_tier is STABLE; _exp_entity_for_record may write links)
+      JOIN exp_entity pe ON pe.identity_keys @> jsonb_build_object('professional_id', om->>'professional_id')
+                        AND pe.status <> 'merged'
+      JOIN exp_claim c ON c.entity_id = pe.entity_id
+     WHERE er.record_type = 'organization' AND om->>'mode' = 'single_pro'
+       AND c.user_id = v_user AND c.status = 'verified'
+     LIMIT 1;
+  END IF;
   RETURN v_tier;
 END $$;
 
```
