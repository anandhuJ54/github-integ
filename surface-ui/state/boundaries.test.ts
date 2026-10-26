// Guards for the UI layout and the central store (state/README.md, root AGENTS.md §2 and §4):
// - a Surface imports only @v3/shared, @v3/state, @v3/theme and itself: never another Surface or shell;
// - shared/, state/ and theme/ import no Surface and no shell;
// - a Surface's slice is named after its folder, and it reads only its own slice and the app-level state;
// - a Surface's src/state/ holds browser-only state: data from the API stays in React Query.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const UI = join(import.meta.dir, "..");
const CORE = ["shell", "shared", "state", "theme"];
/** App-level slices every Surface may read (registered by shell/state/register.ts). */
const APP_SLICES = ["session", "access", "impersonation"];

const SURFACES = readdirSync(UI)
  .filter((d) => !CORE.includes(d) && !d.startsWith(".") && d !== "node_modules" && d !== "public")
  .filter((d) => statSync(join(UI, d)).isDirectory())
  .filter((d) => {
    try {
      return statSync(join(UI, d, "src")).isDirectory();
    } catch {
      return false;
    }
  });

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".generated" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const IMPORT = /(?:from|import)\s*\(?\s*["']@v3\/([a-z0-9-]+)(?:[/"'])/g;

/** The `@v3/<name>` packages a file imports. */
export function v3Imports(src: string): string[] {
  return [...src.matchAll(IMPORT)].map((m) => m[1]);
}

/** Names given to `createSlice({ name: "..." })`. */
export function sliceNames(src: string): string[] {
  return [...src.matchAll(/createSlice\s*\(\s*\{[^}]*?\bname\s*:\s*["']([^"']+)["']/gs)].map((m) => m[1]);
}

/** Top-level store keys read through a selector or getState(), e.g. `useAppSelector((s) => s.sales.x)` → "sales". */
export function storeReads(src: string): string[] {
  const keys: string[] = [];
  for (const m of src.matchAll(/use(?:App)?Selector\s*\(\s*\(?\s*(\w+)[^)]*\)?\s*=>/g)) {
    const param = m[1];
    const body = src.slice(m.index! + m[0].length, m.index! + m[0].length + 300);
    const re = new RegExp(`\\b${param}(?:\\.([A-Za-z_$][\\w$]*)|\\[\\s*["']([^"']+)["']\\s*\\])`, "g");
    for (const r of body.matchAll(re)) keys.push(r[1] ?? r[2]);
  }
  for (const m of src.matchAll(/getState\(\)\s*(?:\.([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])/g)) {
    keys.push(m[1] ?? m[2]);
  }
  return keys;
}

/** Calls that load data from the API (or the database), which belong in React Query, not the store. */
export function apiCalls(src: string): string[] {
  const re = /\b(api\.(?:get|post|put|patch|delete)|serverFn|fetch|createAsyncThunk|supabase\.from)\s*[<(]/g;
  return [...src.matchAll(re)].map((m) => m[1]);
}

describe("the guards' detectors", () => {
  test("find imports, slice names, store reads and API calls", () => {
    expect(v3Imports(`import { x } from "@v3/sales/utils/a";\nimport y from '@v3/state';`)).toEqual(["sales", "state"]);
    expect(sliceNames(`createSlice({ name: "nora-os", initialState: {} })`)).toEqual(["nora-os"]);
    expect(storeReads(`useAppSelector((s) => s.sales.filter)`)).toEqual(["sales"]);
    expect(storeReads(`useAppSelector((state) => state["nora-os"].x)`)).toEqual(["nora-os"]);
    expect(storeReads(`store.getState().admin`)).toEqual(["admin"]);
    expect(apiCalls(`await api.get<X>("/a"); fetch("/b"); createAsyncThunk("x", f)`)).toEqual([
      "api.get",
      "fetch",
      "createAsyncThunk",
    ]);
  });
});

describe("UI boundaries", () => {
  test("found the Surfaces", () => {
    expect(SURFACES.length).toBeGreaterThan(10);
  });

  for (const surface of SURFACES) {
    const files = sourceFiles(join(UI, surface, "src"));

    test(`${surface}: imports no other Surface and no shell`, () => {
      const bad = files.flatMap((f) =>
        v3Imports(readFileSync(f, "utf8"))
          .filter((p) => p !== surface && !["shared", "state", "theme"].includes(p))
          .map((p) => `${relative(UI, f)} → @v3/${p}`),
      );
      expect(bad).toEqual([]);
    });

    test(`${surface}: slices are named "${surface}" and read only its own state`, () => {
      const bad = files.flatMap((f) => {
        const src = readFileSync(f, "utf8");
        const rel = relative(UI, f);
        return [
          ...sliceNames(src)
            .filter((n) => n !== surface)
            .map((n) => `${rel}: slice "${n}"`),
          ...storeReads(src)
            .filter((k) => k !== surface && !APP_SLICES.includes(k))
            .map((k) => `${rel}: reads state.${k}`),
        ];
      });
      expect(bad).toEqual([]);
    });

    test(`${surface}: src/state/ loads no API data (that is React Query's job)`, () => {
      const bad = files
        .filter((f) => relative(join(UI, surface, "src"), f).startsWith("state/"))
        .flatMap((f) => apiCalls(readFileSync(f, "utf8")).map((c) => `${relative(UI, f)}: ${c}`));
      expect(bad).toEqual([]);
    });
  }

  test("shared/, state/ and theme/ import no Surface and no shell", () => {
    const bad = ["shared", "state", "theme"].flatMap((dir) =>
      sourceFiles(join(UI, dir)).flatMap((f) =>
        v3Imports(readFileSync(f, "utf8"))
          .filter((p) => !["shared", "state", "theme"].includes(p))
          .map((p) => `${relative(UI, f)} → @v3/${p}`),
      ),
    );
    expect(bad).toEqual([]);
  });
});
