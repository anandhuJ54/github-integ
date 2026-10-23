/**
 * Browser-to-API parity check for one Surface.
 *
 *   cd surface-ui/parity
 *   bun --env-file=../app/.env run.ts <surface>      # e.g. nora-os
 *
 * For every case in cases/<surface>.ts it runs the legacy browser function (supabase-js, taken
 * from PARITY_LEGACY_REF so the ported file is not what runs) and the FastAPI endpoint that
 * replaced it, as the same signed-in user, and diffs the JSON. Both sides must read the same
 * database: VITE_SUPABASE_URL's project must be the one DATABASE_URL points at, and the API must
 * verify that project's JWTs (SUPABASE_URL in surface-api/.env).
 *
 * Env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (from the app's .env), PARITY_EMAIL,
 * PARITY_PASSWORD (omit both to run signed out), PARITY_API_URL (default http://localhost:8000),
 * PARITY_LEGACY_REF (default migrate/from-experiencesrp-clone).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "@v3/ui/integrations/supabase/client";
import type { ParityCase } from "./cases/types";

const surface = process.argv[2];
if (!surface) {
  console.error("usage: bun run.ts <surface>");
  process.exit(2);
}
const API = (process.env.PARITY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const REF = process.env.PARITY_LEGACY_REF ?? "migrate/from-experiencesrp-clone";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const { cases } = (await import(`./cases/${surface}.ts`)) as { cases: ParityCase[] };

async function legacyModule(
  path: string,
  patches: ParityCase["legacyPatch"] = [],
): Promise<Record<string, unknown>> {
  let src = execFileSync("git", ["show", `${REF}:${path}`], { cwd: ROOT }).toString();
  for (const p of patches) {
    if (!src.includes(p.find)) throw new Error(`legacyPatch not found in ${path}: ${p.find}`);
    src = src.split(p.find).join(p.replace);
    console.log(`  patched legacy: ${p.why}`);
  }
  const out = join(HERE, ".legacy", path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, src);
  return import(out);
}

function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (Object.is(a, b)) return;
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) {
      out.push(`${path}: array vs object`);
      return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff((a as never)[k], (b as never)[k], `${path}.${k}`, out);
    return;
  }
  out.push(`${path}: legacy=${JSON.stringify(a)} api=${JSON.stringify(b)}`);
}

let token: string | undefined;
if (process.env.PARITY_EMAIL) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: process.env.PARITY_EMAIL,
    password: process.env.PARITY_PASSWORD ?? "",
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  token = data.session?.access_token;
}
console.log(`parity ${surface}: ${cases.length} case(s), ${token ? "signed in" : "signed out"}, legacy=${REF}`);

let failed = 0;
for (const c of cases) {
  const mod = await legacyModule(c.legacyModule, c.legacyPatch);
  const fn = mod[c.legacyExport] as (...a: unknown[]) => Promise<unknown>;
  let legacy: unknown;
  try {
    legacy = JSON.parse(JSON.stringify(await fn(...(c.legacyArgs ?? []))));
  } catch (e) {
    failed++;
    const msg = (e as { message?: string } | null)?.message;
    console.log(`FAIL ${c.name}: legacy threw ${msg || "(empty error, usually an RLS-denied or timed-out count)"}`);
    continue;
  }
  const res = await fetch(`${API}${c.api.path}`, {
    method: c.api.method,
    headers: {
      ...(c.api.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: c.api.body !== undefined ? JSON.stringify(c.api.body) : undefined,
  });
  if (!res.ok) {
    failed++;
    console.log(`FAIL ${c.name}: API ${res.status} ${await res.text()}`);
    continue;
  }
  const api = await res.json();
  const diffs: string[] = [];
  diff(legacy, api, "$", diffs);
  const real = diffs.filter((d) => !c.ignore?.some((p) => d.startsWith(`${p}:`) || d.startsWith(`${p}.`)));
  for (const p of c.ignore ?? []) console.log(`  not compared: ${p} (verify separately)`);
  if (real.length) {
    failed++;
    console.log(`FAIL ${c.name}: ${real.length} difference(s)`);
    for (const d of real.slice(0, 50)) console.log(`  ${d}`);
  } else {
    console.log(`PASS ${c.name}`);
  }
}
process.exit(failed ? 1 : 0);
