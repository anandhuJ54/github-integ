// Source guard for the Happyflow port (surface-spec/srp/happyflow-seat-ui/spec.md, criterion 7):
// the screens are UI-only on demo data, so no browser-database, server-function, fetch or cross-Surface code.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = import.meta.dir;
const ROUTES = join(SRC, "routes", "_authenticated");
const NEW_ROUTES = ["profile", "insights", "website", "connections", "network", "settings", "find"].map(
  (n) => join(ROUTES, `seat.$kind.$id.${n}.tsx`),
);
const ASSETS = ["sample-pro.jpg", "sample-pro-tampa.jpg", "sample-pro-similar.jpg", "experience-icon.png"].map((n) =>
  join(SRC, "assets", "happyflow", n),
);

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const FORBIDDEN: [string, RegExp][] = [
  ["browser database", /supabase/i],
  ["server function", /createServerFn/],
  ["fetch call", /\bfetch\s*\(/],
  ["react-start", /@tanstack\/react-start/],
  ["clone-style alias import", /(?:from|import)\s*\(?\s*["']@\//],
  ["a named persona (use the generic sample one)", /Dana|Whitfield|Whitley/],
  ["another Surface or the shell", /(?:from|import)\s*\(?\s*["']@v3\/(?!shared|state|theme|srp)[a-z0-9-]+/],
];

const hf = files(join(SRC, "components", "happyflow"));
const guarded = [...hf, ...NEW_ROUTES.filter(existsSync)];

// Every route that renders a Happyflow screen shows the "Sample data" notice (canon review, spec check 6).
const SCREEN_ROUTES = files(ROUTES).filter((f) =>
  /components\/happyflow\/screens\//.test(readFileSync(f, "utf8")),
);

describe("Happyflow port", () => {
  test("every route that shows a Happyflow screen wraps it in the sample-data notice", () => {
    expect(SCREEN_ROUTES.length).toBe(9); // the seat index shows the Home through components/happyflow/home-page.tsx, which is checked below
    const missing = SCREEN_ROUTES.filter((f) => !/<SampleData[\s>]/.test(readFileSync(f, "utf8")));
    expect(missing.map((f) => f.replace(SRC, ""))).toEqual([]);
  });

  test("the Home page component wraps both layouts in the sample-data notice", () => {
    const src = readFileSync(join(SRC, "components", "happyflow", "home-page.tsx"), "utf8");
    expect(/<SampleData[\s>]/.test(src)).toBe(true);
    expect(/screens\/home-day1/.test(src) && /screens\/home-day7/.test(src)).toBe(true);
    expect(/home-(day1|day7)/.test(readFileSync(join(ROUTES, "seat.$kind.$id.index.tsx"), "utf8"))).toBe(false);
  });

  test("all Happyflow files are present", () => {
    expect(hf.filter((f) => /\.tsx?$/.test(f)).length).toBe(28); // the clone's 20 plus screens/profile-store.ts, sample-data.tsx, persona.ts, persona-context.tsx, home-context.tsx, screens/greeting.ts, home-page.tsx and sample-home.ts
    expect(hf.filter((f) => f.endsWith("happyflow.css")).length).toBe(1);
    for (const f of [...NEW_ROUTES, ...ASSETS]) expect(existsSync(f)).toBe(true);
  });

  test("none of it reads or writes the backend or imports another Surface", () => {
    const hits: string[] = [];
    for (const f of guarded) {
      const src = readFileSync(f, "utf8");
      for (const [label, re] of FORBIDDEN) if (re.test(src)) hits.push(`${f.replace(SRC, "")}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});
