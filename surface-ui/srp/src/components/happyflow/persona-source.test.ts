// The home, its greeting and the shell take the person from the persona context, not from hard-coded "Alex"
// (srp/local-login-srp-home). A source check, because there is no DOM here to click through.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HF = import.meta.dir;
/** The source without comments, so a doc comment may still quote the sample line. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const read = (...p: string[]) => code(readFileSync(join(HF, ...p), "utf8"));

describe("persona wiring", () => {
  test("the day 1 and day 7 homes greet by the persona's first name", () => {
    for (const f of ["home-day1.tsx", "home-day7.tsx"]) {
      const src = read("screens", f);
      expect(src).toContain("useHfPersona");
      expect(src).not.toMatch(/\$\{greet\}, Alex/);
      expect(src).not.toMatch(/\$\{greet\}, \$\{PERSONA\.first\}/);
    }
  });

  test("NORA's hello and the draft byline in the shell use the persona too", () => {
    const src = read("shell.tsx");
    expect(src).toContain("useHfPersona");
    expect(src).not.toMatch(/Hi Alex\./);
    expect(src).not.toContain("Alex Sample · Senior Loan Officer · NMLS 482913");
  });

  test("the day 7 home's sample review does not name Alex either", () => {
    expect(read("screens", "home-day7.tsx")).not.toMatch(/Alex/);
  });

  test("the day 1 hello bubble is not hard-coded either", () => {
    expect(read("screens", "home-day1.tsx")).not.toMatch(/Hi Alex\./);
  });
});
