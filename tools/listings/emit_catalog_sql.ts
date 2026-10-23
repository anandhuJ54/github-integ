#!/usr/bin/env bun
/** Emit drizzle/migrations/0026_listings_catalog_db.sql from the listings-tab catalog constants.
 *
 *   bun tools/listings/emit_catalog_sql.ts            # writes the migration file
 *   bun tools/listings/emit_catalog_sql.ts --stdout   # prints it instead
 *
 *  Source: src/lib/listings/catalog.fallback.ts (the constants that used to live in
 *  src/components/listings-tab.tsx, moved verbatim). Reproducible: same input → same SQL.
 *  Publisher channel metadata below (channel_role etc.) is seed data — channel_role is the
 *  PROPOSED 4 direct + 4 distribution split, role_status='proposed' until Scott rules; the
 *  ruling is then a data UPDATE, never a code change. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLISHER_CATALOGS, type Section } from "../../src/lib/listings/catalog.fallback";
import { CATALOG_VERSION } from "../../src/lib/listings/catalog";

export const LEGACY_VERSION = "legacy_2026_07_09";

interface ChannelMeta {
  channel_role: "direct" | "distribution" | "verify_only" | "hub" | "candidate";
  auth_model: string | null;
  write_path: string | null;
  read_path: string | null;
  sandbox: string | null;
  notes: string | null;
}

/** Every value is paraphrased from that publisher's card (sections + ops notes); null = the
 *  catalog does not say. Proposal: direct Google/Apple/Bing/Meta; distribution Data Axle/
 *  Foursquare/Localeze/HERE; the other four are candidates. */
export const CHANNEL_META: Record<string, ChannelMeta> = {
  google: {
    channel_role: "direct",
    auth_model:
      "OAuth 2.0 via GCP project + GBP API access request (quota 0 until approved; self-serve application)",
    write_path:
      "Business Information API v1 PATCH with updateMask (+ v4 Media/Posts/Q&A/Reviews, Food Menus, Lodging, Place Actions)",
    read_path: "Business Information API get + getGoogleUpdated (drift diff)",
    sandbox: null,
    notes: "Categories and phone numbers update as whole objects.",
  },
  apple: {
    channel_role: "direct",
    auth_model:
      "Self-serve Apple Business dashboard; Location API requires a partner agreement + Partner ID",
    write_path:
      "Dashboard per location today; Location API at scale via listing-management partners",
    read_path: null,
    sandbox: null,
    notes:
      "Also ingests Foursquare data passively; a claimed listing is the authoritative override.",
  },
  bing: {
    channel_role: "direct",
    auth_model: "No public self-serve listings API; enterprise API via partner/agency track",
    write_path:
      "Google→Bing import + periodic auto-sync; bulk Excel upload; dashboard for Bing-only fields (Deals)",
    read_path: null,
    sandbox: null,
    notes: "Runtime job is post-sync auditing (especially categories), not duplicate submission.",
  },
  meta: {
    channel_role: "direct",
    auth_model:
      "OAuth page tokens (60-day long-lived, refresh ~50 days) + App Review per permission",
    write_path: "Graph API v25 Page fields where writable + FB/IG publishing",
    read_path: "Graph API (metadata=1) for field-writability and drift audit",
    sandbox: "Test page via Graph Explorer + sandbox POSTs during App Review setup",
    notes: "Field writability pending verification; page name and category are drift-audit only.",
  },
  data_axle: {
    channel_role: "distribution",
    auth_model: "Local Listings Premium account (API v1)",
    write_path: "Local Listings Premium API v1 submissions (A/U/R/D)",
    read_path: null,
    sandbox: null,
    notes:
      "A and R are billable; 3 failed submissions = 90-day limbo; verification is human teleresearch.",
  },
  foursquare: {
    channel_role: "distribution",
    auth_model:
      "Self-serve key (Place Match); Service Account key (Feedback API); partner agreement (bulk publishing)",
    write_path:
      "Feedback API propose-edits (reviewed); Business Listings bulk authoritative publishing (partner agreement in motion)",
    read_path: "Place Match + Get Feedback Status",
    sandbox: null,
    notes: "Legacy V3 endpoints deprecated 2026-05-15 — FSQ OS Places endpoints only.",
  },
  localeze: {
    channel_role: "distribution",
    auth_model: "SMB self-serve; enterprise bulk via contract with account manager",
    write_path: "Enterprise bulk add/edit/release/close (contract)",
    read_path: null,
    sandbox: "SMB self-serve tier for early testing",
    notes: "Needs a source-priority matrix with DA + FSQ + our direct writes.",
  },
  here: {
    channel_role: "distribution",
    auth_model: "Self-serve read key (Geocoding & Search API); no public listings write API",
    write_path: "Aggregator rails (licensed suppliers) + Map Creator corrections",
    read_path: "HERE Geocoding & Search API",
    sandbox: null,
    notes: "Rail-fed: feeds Alexa and most European in-car navigation.",
  },
  tomtom: {
    channel_role: "candidate",
    auth_model: "Self-serve developer key (read-only); no public listings write API",
    write_path: "DA + FSQ rails; MapShare corrections (moderated, slow)",
    read_path: "TomTom Search API",
    sandbox: null,
    notes: "Rail-fed destination, not a new integration.",
  },
  yelp: {
    channel_role: "candidate",
    auth_model:
      "Self-serve Fusion API key (read); write at scale via Yelp Knowledge / licensing partnership",
    write_path: "Claim + dashboard; partner track for scale",
    read_path: "Fusion API (rating, count, 3 excerpts)",
    sandbox: null,
    notes: "Review solicitation prohibited — excluded from campaign solicitation flows.",
  },
  linkedin: {
    channel_role: "candidate",
    auth_model: "OAuth via LinkedIn Developer Program review (Community Management API)",
    write_path: "Member + organization posts (w_member_social); org fields largely UI-managed",
    read_path: null,
    sandbox: null,
    notes: "Content channel; no native post scheduling.",
  },
  nextdoor: {
    channel_role: "candidate",
    auth_model: "Free self-serve claim at business.nextdoor.com",
    write_path: "Dashboard-first; scale via partner/aggregator syndication",
    read_path: null,
    sandbox: null,
    notes: "FSQ rail supplies the POI baseline.",
  },
};

const q = (v: string | null | undefined): string =>
  v === null || v === undefined ? "NULL" : `'${v.replace(/'/g, "''")}'`;
const qb = (v: boolean | null): string => (v === null ? "NULL" : v ? "true" : "false");
const qj = (v: unknown): string =>
  v === null || v === undefined ? "NULL" : `${q(JSON.stringify(v))}::jsonb`;

/** Their-field strings that are literal API paths (no spaces/prose), e.g. "profile.description". */
export function apiFieldPath(their: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*|\[\])*$/.test(their) ? their : null;
}

/** Machine-readable bits that are stated verbatim in the rules text. */
export function ruleSpec(rules: string): Record<string, unknown> | null {
  const m = rules.match(/\b(\d{2,5}) char(acter)?s?\b/i);
  return m ? { max_chars: Number(m[1]) } : null;
}

export interface FlatRow {
  publisher_id: string;
  section: string;
  section_note: string | null;
  their_field: string;
  our_target: string;
  rules: string;
  applicability: string;
  status_default: string;
  variant_family: string | null;
  sort: number;
  required: boolean | null;
  api_field_path: string | null;
  rule_spec: Record<string, unknown> | null;
}

export function flatten(): FlatRow[] {
  const out: FlatRow[] = [];
  for (const p of PUBLISHER_CATALOGS) {
    let sort = 0;
    p.sections.forEach((sec: Section) => {
      sec.rows.forEach((r) => {
        sort += 1;
        out.push({
          publisher_id: p.id,
          section: sec.title,
          section_note: sec.note ?? null,
          their_field: r.their,
          our_target: r.ours,
          rules: r.rules,
          applicability: sec.applicability ?? "base",
          status_default: r.status,
          variant_family: r.family ?? null,
          sort,
          required: sec.title === "Core Required" ? true : null,
          api_field_path: apiFieldPath(r.their),
          rule_spec: ruleSpec(r.rules),
        });
      });
    });
  }
  const seen = new Set<string>();
  for (const r of out) {
    const k = `${r.publisher_id}|${r.section}|${r.their_field}`;
    if (seen.has(k)) throw new Error(`duplicate catalog key ${k}`);
    seen.add(k);
  }
  return out;
}

export function emit(): string {
  const rows = flatten();
  const counts = rows.reduce<Record<string, number>>(
    (a, r) => ((a[r.status_default] = (a[r.status_default] ?? 0) + 1), a),
    {},
  );
  const L: string[] = [];
  L.push(
    "-- 0026 — Listings catalog → DB. GENERATED by tools/listings/emit_catalog_sql.ts; do not hand-edit.",
    "-- Moves the 12 publisher catalogs from src/components/listings-tab.tsx constants into",
    "-- exp_listings_publishers + exp_listings_field_map (one connected system; no new tables).",
    `-- Seeds ${PUBLISHER_CATALOGS.length} publishers and ${rows.length} field rows (${Object.entries(
      counts,
    )
      .sort()
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}).`,
    "--",
    "-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS; constraints/indexes only when missing;",
    "-- publishers INSERT … ON CONFLICT updates ONLY the columns this migration adds (plus ops_notes",
    "-- when the live value is empty/NULL — the 3 existing rows carry '[]'); field rows ON CONFLICT DO NOTHING.",
    "-- channel_role is never overwritten once role_status = 'ruled'.",
    "--",
    "-- Column mapping vs the requested shape (existing columns reused, not duplicated):",
    "--   platform_field → their_field · our_source → our_target · status → status_default",
    "--   (values mapped|pipeline|missing_ours|na) · rules text stays; structured rules → rule_spec jsonb.",
    `-- The 30 pre-existing Google rows are tagged catalog_version='${LEGACY_VERSION}' and no longer render;`,
    `-- the console reads catalog_version='${CATALOG_VERSION}'.`,
    "",
    "-- ── exp_listings_publishers: channel model ─────────────────────────────────────",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS subtitle text;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS display_sort integer;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS channel_role text;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS role_status text NOT NULL DEFAULT 'proposed';",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS auth_model text;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS write_path text;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS read_path text;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS sandbox text;",
    "ALTER TABLE exp_listings_publishers ADD COLUMN IF NOT EXISTS notes text;",
    "DO $$ BEGIN",
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exp_listings_publishers_channel_role_chk') THEN",
    "    ALTER TABLE exp_listings_publishers ADD CONSTRAINT exp_listings_publishers_channel_role_chk",
    "      CHECK (channel_role IS NULL OR channel_role IN ('direct','distribution','verify_only','hub','candidate'));",
    "  END IF;",
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exp_listings_publishers_role_status_chk') THEN",
    "    ALTER TABLE exp_listings_publishers ADD CONSTRAINT exp_listings_publishers_role_status_chk",
    "      CHECK (role_status IN ('proposed','ruled'));",
    "  END IF;",
    "END $$;",
    "",
    "-- ── exp_listings_field_map: connector-facing columns ────────────────────────────",
    "ALTER TABLE exp_listings_field_map ADD COLUMN IF NOT EXISTS catalog_version text;",
    "ALTER TABLE exp_listings_field_map ADD COLUMN IF NOT EXISTS writable boolean;",
    "ALTER TABLE exp_listings_field_map ADD COLUMN IF NOT EXISTS required boolean;",
    "ALTER TABLE exp_listings_field_map ADD COLUMN IF NOT EXISTS api_field_path text;",
    "ALTER TABLE exp_listings_field_map ADD COLUMN IF NOT EXISTS rule_spec jsonb;",
    "ALTER TABLE exp_listings_field_map ADD COLUMN IF NOT EXISTS notes text;",
    "CREATE UNIQUE INDEX IF NOT EXISTS exp_listings_field_map_catalog_uidx",
    "  ON exp_listings_field_map (publisher_id, catalog_version, section, their_field) WHERE catalog_version IS NOT NULL;",
    `UPDATE exp_listings_field_map SET catalog_version = '${LEGACY_VERSION}' WHERE catalog_version IS NULL;`,
    "",
    "-- ── publishers ────────────────────────────────────────────────────────────────",
    "INSERT INTO exp_listings_publishers (id, name, kind, publishes_to, ops_notes, subtitle, display_sort, channel_role, role_status, auth_model, write_path, read_path, sandbox, notes) VALUES",
  );
  L.push(
    PUBLISHER_CATALOGS.map((p, i) => {
      const m = CHANNEL_META[p.id];
      if (!m) throw new Error(`no CHANNEL_META for ${p.id}`);
      return `(${[q(p.id), q(p.name), q(p.kind), q(p.publishesTo), qj(p.opsNotes), q(p.subtitle), String((i + 1) * 10), q(m.channel_role), "'proposed'", q(m.auth_model), q(m.write_path), q(m.read_path), q(m.sandbox), q(m.notes)].join(", ")})`;
    }).join(",\n"),
  );
  L.push(
    "ON CONFLICT (id) DO UPDATE SET",
    "  subtitle = EXCLUDED.subtitle,",
    "  display_sort = EXCLUDED.display_sort,",
    "  channel_role = CASE WHEN exp_listings_publishers.role_status = 'ruled' THEN exp_listings_publishers.channel_role ELSE EXCLUDED.channel_role END,",
    "  auth_model = EXCLUDED.auth_model,",
    "  write_path = EXCLUDED.write_path,",
    "  read_path = EXCLUDED.read_path,",
    "  sandbox = EXCLUDED.sandbox,",
    "  notes = EXCLUDED.notes,",
    "  ops_notes = CASE WHEN exp_listings_publishers.ops_notes IS NULL OR exp_listings_publishers.ops_notes = '[]'::jsonb",
    "                   THEN EXCLUDED.ops_notes ELSE exp_listings_publishers.ops_notes END;",
    "",
    "-- ── field map ─────────────────────────────────────────────────────────────────",
    "INSERT INTO exp_listings_field_map (publisher_id, section, section_note, their_field, our_target, rules, applicability, status_default, variant_family, sort, catalog_version, required, api_field_path, rule_spec) VALUES",
  );
  L.push(
    rows
      .map(
        (r) =>
          `(${[q(r.publisher_id), q(r.section), q(r.section_note), q(r.their_field), q(r.our_target), q(r.rules), q(r.applicability), q(r.status_default), q(r.variant_family), String(r.sort), q(CATALOG_VERSION), qb(r.required), q(r.api_field_path), qj(r.rule_spec)].join(", ")})`,
      )
      .join(",\n"),
  );
  L.push(
    "ON CONFLICT (publisher_id, catalog_version, section, their_field) WHERE catalog_version IS NOT NULL DO NOTHING;",
    "",
    "-- VERIFY (read-only):",
    `--   select count(*) from exp_listings_publishers where display_sort is not null;                    -- ${PUBLISHER_CATALOGS.length}`,
    `--   select status_default, count(*) from exp_listings_field_map where catalog_version='${CATALOG_VERSION}' group by 1;`,
    `--     -- ${Object.entries(counts)
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
    "--   select id, channel_role, role_status from exp_listings_publishers order by display_sort;",
    "-- RULING (Scott) is a data change, e.g.:",
    "--   update exp_listings_publishers set channel_role='direct', role_status='ruled' where id='apple';",
    "",
  );
  return L.join("\n");
}

if (import.meta.main) {
  const sql = emit();
  if (process.argv.includes("--stdout")) process.stdout.write(sql);
  else {
    const out = join(import.meta.dir, "../../drizzle/migrations/0026_listings_catalog_db.sql");
    writeFileSync(out, sql);
    console.log(`wrote ${out} (${flatten().length} field rows)`);
  }
}
