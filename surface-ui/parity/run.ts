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
 * PARITY_LEGACY_REF (default migrate/from-experiencesrp-clone), PARITY_ONLY (run only the cases
 * whose name contains this text, case-insensitive).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "@v3/ui/integrations/supabase/client";
import type { ApiCall, ParityCase } from "./cases/types";

const surface = process.argv[2];
if (!surface) {
  console.error("usage: bun run.ts <surface>");
  process.exit(2);
}
const API = (process.env.PARITY_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const REF = process.env.PARITY_LEGACY_REF ?? "migrate/from-experiencesrp-clone";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const { cases: all } = (await import(`./cases/${surface}.ts`)) as { cases: ParityCase[] };
const ONLY = process.env.PARITY_ONLY?.toLowerCase();
const cases = ONLY ? all.filter((c) => c.name.toLowerCase().includes(ONLY)) : all;

/** `surface-ui/srp/src/lib/x.ts` → `@v3/srp/lib/x` (`_base` is `@v3/ui`). */
function aliasOf(path: string): string {
  const m = path.match(/^surface-ui\/([^/]+)\/src\/(.+)\.tsx?$/);
  if (!m) throw new Error(`not a surface-ui source path: ${path}`);
  return `@v3/${m[1] === "_base" ? "ui" : m[1]}/${m[2]}`;
}

function extract(path: string): string {
  const out = join(HERE, ".legacy", path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, execFileSync("git", ["show", `${REF}:${path}`], { cwd: ROOT }));
  return out;
}

async function legacyModule(
  path: string,
  patches: ParityCase["legacyPatch"] = [],
  deps: string[] = [],
): Promise<Record<string, unknown>> {
  let src = execFileSync("git", ["show", `${REF}:${path}`], { cwd: ROOT }).toString();
  for (const p of patches) {
    if (!src.includes(p.find)) throw new Error(`legacyPatch not found in ${path}: ${p.find}`);
    src = src.split(p.find).join(p.replace);
    console.log(`  patched legacy: ${p.why}`);
  }
  for (const dep of deps) {
    // the legacy module must see the legacy version of what the port changed
    src = src.split(`"${aliasOf(dep)}"`).join(JSON.stringify(extract(dep)));
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

// The ported code fetches `/api/...` (the Vite proxy strips /api). Send those to the API here.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/api/")) return realFetch(`${API}${url.slice(4)}`, init);
  return realFetch(input, init);
}) as typeof fetch;

/** The new side: the current function, or the endpoint as JSON (null on 404, like the TS). */
async function runNew(c: ParityCase, ctx: unknown): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  if (c.current) {
    try {
      return { ok: true, value: toJson(await c.current(ctx)) };
    } catch (e) {
      return { ok: false, error: (e as { message?: string } | null)?.message ?? String(e) };
    }
  }
  const call = typeof c.api === "function" ? c.api(ctx) : c.api!;
  const res = await callApi(call);
  if (!res.ok) return { ok: false, error: `API ${res.status} ${await res.text()}` };
  return { ok: true, value: await res.json() };
}

function callApi(call: ApiCall) {
  return fetch(`${API}${call.path}`, {
    method: call.method,
    headers: {
      ...(call.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
  });
}

// Cases that need legacy modules with per-case arguments (e.g. from `prepare`) load them here.
(globalThis as any).__legacyModule = (path: string, deps?: string[]) => legacyModule(path, [], deps);

/** JSON that keeps Maps and Sets (as their entries), so a loader returning a Map is compared. */
const toJson = (v: unknown) =>
  JSON.parse(
    JSON.stringify(v ?? null, (_k, val) =>
      val instanceof Map ? { $map: [...val.entries()] } : val instanceof Set ? { $set: [...val] } : val,
    ),
  );

let failed = 0;
for (const c of cases) {
  const ctx = c.prepare ? await c.prepare(supabase) : undefined;
  let fn: (...a: unknown[]) => Promise<unknown>;
  if (c.legacy) {
    fn = () => c.legacy!(supabase, ctx);
  } else {
    const mod = await legacyModule(c.legacyModule!, c.legacyPatch, c.legacyDeps);
    fn = mod[c.legacyExport!] as (...a: unknown[]) => Promise<unknown>;
  }
  let legacy: unknown;
  try {
    legacy = toJson(await fn(...(c.legacyArgs ?? [])));
  } catch (e) {
    const msg = (e as { message?: string } | null)?.message;
    if (c.expectRefusal) {
      const res = await runNew(c, ctx);
      if (!res.ok) {
        console.log(`PASS ${c.name}: both refused (legacy: ${msg}; new: ${res.error})`);
        continue;
      }
    }
    failed++;
    console.log(`FAIL ${c.name}: legacy threw ${msg || "(empty error, usually an RLS-denied or timed-out count)"}`);
    continue;
  }
  const res = await runNew(c, ctx);
  if (!res.ok) {
    failed++;
    console.log(`FAIL ${c.name}: ${res.error}`);
    continue;
  }
  let api = res.value;
  if (c.normalize) {
    legacy = c.normalize(legacy);
    api = c.normalize(api);
  }
  const diffs: string[] = [];
  diff(legacy, api, "$", diffs);
  const under = (d: string, p: string) => d.startsWith(`${p}:`) || d.startsWith(`${p}.`);
  const unexplained = diffs.filter((d) => !c.ignore?.some((p) => under(d, p)));
  const real = unexplained.filter((d) => !c.explained?.some((e) => under(d, e.path)));
  for (const p of c.ignore ?? []) console.log(`  not compared: ${p} (verify separately)`);
  for (const e of c.explained ?? []) {
    for (const d of unexplained.filter((x) => under(x, e.path))) console.log(`  explained: ${d}\n    why: ${e.why}`);
  }
  if (real.length) {
    failed++;
    console.log(`FAIL ${c.name}: ${real.length} difference(s)`);
    for (const d of real.slice(0, 50)) console.log(`  ${d}`);
  } else {
    console.log(`PASS ${c.name}`);
  }
}
process.exit(failed ? 1 : 0);
