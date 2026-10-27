// The NORA interview's scripted lines and sources name the person from the persona (srp/local-login-srp-home).
import { describe, expect, test } from "bun:test";
import { mergePersona } from "../persona";
import { IV_INIT as INIT, lineText, sourcesFor } from "./interview-engine";

const real = mergePersona({ first: "Harper", name: "Harper Jones", email: "h@example.test", site: "demomortgage.com/harper-jones" });
const sample = mergePersona({});

describe("interview text", () => {
  test("the scripted lines use the real name", () => {
    for (const k of ["hello1", "twin1", "fin1"] as const) {
      const text = lineText(INIT, k, "Good morning", real);
      expect(text).not.toMatch(/Alex/);
      expect(text).toMatch(/Harper/);
    }
  });

  test("the sample persona's lines are unchanged", () => {
    expect(lineText(INIT, "hello1", "Good morning", sample)).toContain("Good morning, Alex.");
    expect(lineText(INIT, "twin1", "Good morning", sample)).toContain("**Alex Sample**");
  });

  test("the sources list names the real person", () => {
    const rows = sourcesFor(real).flat().join(" ");
    expect(rows).not.toMatch(/Alex|alex-sample/);
    expect(rows).toContain("Harper Jones");
    expect(rows).toContain("demomortgage.com/harper-jones");
  });

  test("the sample sources are unchanged", () => {
    expect(sourcesFor(sample).flat().join(" ")).toContain("demomortgage.com/alex-sample");
  });
});
