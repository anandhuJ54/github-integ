// Source guard for the local sign-in (srp/local-login-srp-home, criterion 16): the new sign-in code never
// touches Supabase, localStorage for the session, the Admin endpoints or another Surface.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRP = import.meta.dir;
const UI = join(SRP, "..", "..");
const GUARDED = [
  join(SRP, "routes", "sign-in.tsx"),
  join(SRP, "utils", "sign-in.ts"),
  join(UI, "state", "auth", "adapters", "api.ts"),
  join(UI, "state", "auth", "paths.ts"),
];

const FORBIDDEN: [string, RegExp][] = [
  ["Supabase", /supabase/i],
  ["localStorage (the session is tab-scoped)", /localStorage/],
  ["the Admin endpoints", /\/admin\//],
  ["a server function", /createServerFn/],
  ["another Surface or the shell", /(?:from|import)\s*\(?\s*["']@v3\/(?!shared|state|theme|srp)[a-z0-9-]+/],
  ["console output", /\bconsole\.(log|info|warn|error|debug)\b/],
];

/** The source without comments, so a comment may say why something is avoided. */
export function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

export function violations(src: string): string[] {
  const c = code(src);
  return FORBIDDEN.filter(([, re]) => re.test(c)).map(([label]) => label);
}

describe("sign-in source guard", () => {
  test("every guarded file exists", () => {
    for (const f of GUARDED) expect(existsSync(f)).toBe(true);
  });

  test("none of the sign-in code reaches Supabase, the Admin endpoints or another Surface", () => {
    const hits = GUARDED.flatMap((f) => violations(readFileSync(f, "utf8")).map((v) => `${f.replace(UI, "")}: ${v}`));
    expect(hits).toEqual([]);
  });

  test.each([
    ['import { supabase } from "@v3/state/auth/adapters/supabase/client";', "Supabase"],
    ['const k = localStorage.getItem("x");', "localStorage (the session is tab-scoped)"],
    ['await api.post("/admin/me/bootstrap");', "the Admin endpoints"],
    ['import { x } from "@v3/sales/utils/y";', "another Surface or the shell"],
    ["console.log(password);", "console output"],
  ])("fails on a planted violation: %s", (planted, label) => {
    expect(violations(planted)).toContain(label);
  });

  test("a comment may mention what is avoided", () => {
    expect(violations("// no Supabase here, never localStorage\n/* /admin/ */\nconst x = 1;")).toEqual([]);
  });
});
