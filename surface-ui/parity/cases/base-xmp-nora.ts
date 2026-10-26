/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParityCase } from "./types";
import * as nav from "@v3/ui/lib/nav-menus";
import * as ops from "@v3/xmp/lib/enterprise-ops";
import * as reg from "@v3/skills/lib/nora-registry";
import * as sbx from "@v3/skills/lib/nora-sandbox";

// Shared @v3/ui libs ported to their owner Surface's API (all signed in):
//   lib/nav-menus.ts → marketing /marketing/website/nav-menus* (moved (surface audit 2026-10-25): was xmp /xmp/website/nav-menus*), lib/enterprise-ops.ts → xmp /xmp/enterprise/ops/*,
//   lib/nora-registry.ts + lib/nora-sandbox.ts → skills /skills/registry/*, /skills/sandbox/* (moved from nora-os, surface audit 2026-10-24).
// The legacy lib (direct supabase-js, from PARITY_LEGACY_REF) against the current one (same lib,
// rows from FastAPI). Reads only: the writes (nav menu create/update/assign/trash/restore/delete,
// skill/capability/build-step/eval upserts, publish/yank version rows, weights, feedback) are
// covered by compiled-SQL / fake-connection unit tests (marketing/queries/nav_menus_test.py,
// nora_os/queries/registry_test.py), never run. The signed-out (anon) read of the assigned nav is
// not covered here (the runner signs in); see the unit test.
// Rows at port time: nav menus 4 (2 assigned to main_site), skills 37, capabilities 44, build map
// 16, skill runs 1, nora state 1 ("joy", not a uuid), weights 5, search_rank_scores 33; evals,
// versions, feedback and every enterprise-ops table are empty (or RLS-empty): still compared.
const NAV = "surface-ui/_base/src/lib/nav-menus.ts";
const OPS = "surface-ui/_base/src/lib/enterprise-ops.ts";
const REG = "surface-ui/_base/src/lib/nora-registry.ts";
const SBX = "surface-ui/_base/src/lib/nora-sandbox.ts";

const BRAND = "bbbbbbb1-0000-4000-8000-000000000001"; // state-farm
const MAIN_NAV = "4e9d0ce1-2bb4-43a2-8ee2-ff4f20cd4bde"; // "Main site top nav"
const NOBODY = "00000000-0000-4000-8000-00000000dead";

const key = (r: any) => JSON.stringify(r);
const sortRows = (rows: any[]) => [...(rows ?? [])].sort((a, b) => key(a).localeCompare(key(b)));
/** search_rank_scores.total_score ties (30 of 33 rows share a score): compared in one order. */
const unordered = (r: any) => (Array.isArray(r) ? sortRows(r) : r);

const lib = (
  module: string,
  name: string,
  exp: string,
  args: unknown[],
  current: () => Promise<unknown>,
  extra: Partial<ParityCase> = {},
): ParityCase => ({ name, legacyModule: module, legacyExport: exp, legacyArgs: args, current, ...extra });

/* ─── lib/nav-menus.ts ─── */
const navCases: ParityCase[] = [
  lib(NAV, "nav menus: live list", "loadNavMenus", [], () => nav.loadNavMenus()),
  lib(NAV, "nav menus: trash", "loadDeletedNavMenus", [], () => nav.loadDeletedNavMenus()),
  lib(NAV, "nav menus: assigned to main_site (header + footer)", "loadAssignedNav", ["main_site"], () =>
    nav.loadAssignedNav("main_site"),
  ),
  lib(NAV, "nav menus: assigned to an unknown site → nulls", "loadAssignedNav", ["no-such-site"], () =>
    nav.loadAssignedNav("no-such-site"),
  ),
  {
    // navMutations.duplicate()'s read (the insert that follows is not run)
    name: "nav menus: duplicate's source read (.single())",
    legacy: async (sb: any) => {
      const { data, error } = await sb
        .from("exp_web_nav_menus")
        .select("name, menu_type, items, notes")
        .eq("id", MAIN_NAV)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    api: { method: "GET", path: `/marketing/website/nav-menus/${MAIN_NAV}` },
  },
  {
    name: "nav menus: duplicate's read of an unknown id → both refuse (406)",
    legacy: async (sb: any) => {
      const { data, error } = await sb
        .from("exp_web_nav_menus")
        .select("name, menu_type, items, notes")
        .eq("id", NOBODY)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    api: { method: "GET", path: `/marketing/website/nav-menus/${NOBODY}` },
    expectRefusal: true,
  },
];

/* ─── lib/enterprise-ops.ts (no RLS policy for users: reads come back empty) ─── */
const opsCases: ParityCase[] = [
  lib(OPS, "enterprise ops: ingestion state-farm", "loadIngestion", [BRAND], () => ops.loadIngestion(BRAND)),
  lib(OPS, "enterprise ops: ingestion, org id not a uuid (errors ignored)", "loadIngestion", ["x"], () =>
    ops.loadIngestion("x"),
  ),
  lib(OPS, "enterprise ops: settings state-farm", "loadEnterpriseSettings", [BRAND], () =>
    ops.loadEnterpriseSettings(BRAND),
  ),
  lib(OPS, "enterprise ops: settings, org id not a uuid (errors ignored)", "loadEnterpriseSettings", ["x"], () =>
    ops.loadEnterpriseSettings("x"),
  ),
];

/* ─── lib/nora-registry.ts ─── */
const regCases: ParityCase[] = [
  lib(REG, "registry: skills", "listSkills", [], () => reg.listSkills()),
  lib(REG, "registry: skill add_referral_partners", "getSkill", ["add_referral_partners"], () =>
    reg.getSkill("add_referral_partners"),
  ),
  lib(REG, "registry: unknown skill → null", "getSkill", ["no_such_skill"], () => reg.getSkill("no_such_skill")),
  lib(REG, "registry: capabilities", "listCapabilities", [], () => reg.listCapabilities()),
  lib(REG, "registry: capability claim_bind", "getCapability", ["claim_bind"], () => reg.getCapability("claim_bind")),
  lib(REG, "registry: build map", "listBuildMap", [], () => reg.listBuildMap()),
  lib(REG, "registry: all evals", "listEvals", [], () => reg.listEvals()),
  lib(REG, "registry: evals of add_referral_partners", "listEvals", ["add_referral_partners"], () =>
    reg.listEvals("add_referral_partners"),
  ),
  lib(REG, "registry: versions of add_referral_partners", "listVersions", ["add_referral_partners"], () =>
    reg.listVersions("add_referral_partners"),
  ),
  lib(REG, "registry: skill runs (100)", "listSkillRuns", [100], () => reg.listSkillRuns(100)),
];

/* ─── lib/nora-sandbox.ts ─── */
const sbxCases: ParityCase[] = [
  lib(SBX, "sandbox: entities", "listSandboxEntities", [], () => sbx.listSandboxEntities()),
  lib(SBX, "sandbox: state joy", "getSandboxState", ["joy"], () => sbx.getSandboxState("joy")),
  lib(SBX, "sandbox: state unknown → null", "getSandboxState", ["nobody"], () => sbx.getSandboxState("nobody")),
  lib(SBX, "sandbox: weights", "listWeights", [], () => sbx.listWeights()),
  lib(SBX, "sandbox: feedback of the default ref", "listFeedback", [sbx.DEFAULT_SANDBOX_REF], () =>
    sbx.listFeedback(sbx.DEFAULT_SANDBOX_REF),
  ),
  lib(SBX, "sandbox: scored entities with names", "listScoredEntities", [], () => sbx.listScoredEntities(), {
    normalize: unordered,
  }),
  lib(SBX, "sandbox: score of the default ref", "getScore", [sbx.DEFAULT_SANDBOX_REF], () =>
    sbx.getScore(sbx.DEFAULT_SANDBOX_REF),
  ),
  lib(SBX, "sandbox: score of an unscored uuid → null", "getScore", [NOBODY], () => sbx.getScore(NOBODY)),
  lib(SBX, "sandbox: view of the default ref (real SRS)", "loadSandbox", [sbx.DEFAULT_SANDBOX_REF], () =>
    sbx.loadSandbox(sbx.DEFAULT_SANDBOX_REF),
  ),
  lib(SBX, "sandbox: view of an unscored uuid → null", "loadSandbox", [NOBODY], () => sbx.loadSandbox(NOBODY)),
  // "joy" is not a uuid: the search_rank_scores read fails, so both sides throw (no synthetic fallback)
  lib(SBX, "sandbox: view of joy → both throw (not a uuid)", "loadSandbox", ["joy"], () => sbx.loadSandbox("joy"), {
    expectRefusal: true,
  }),
];

export const cases: ParityCase[] = [...navCases, ...opsCases, ...regCases, ...sbxCases];
