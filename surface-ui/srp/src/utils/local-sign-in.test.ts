import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { getAuthProvider, setAuthProvider } from "@v3/state/auth";
import { apiAuthProvider } from "@v3/state/auth/adapters/api";
import { supabaseAuthProvider } from "@v3/state/auth/adapters/supabase/adapter";
import { showActingAsBar } from "@v3/srp/components/impersonation/acting-as-bar";
import { SAMPLE_DATA_LABEL, SampleData } from "@v3/srp/components/happyflow/sample-data";
import { HfPersonaProvider } from "@v3/srp/components/happyflow/persona-context";
import { usesLocalSignIn } from "./local-sign-in";

const before = getAuthProvider();
afterEach(() => setAuthProvider(before));

const page = () =>
  renderToString(
    createElement(
      HfPersonaProvider,
      { seat: null as never },
      createElement(SampleData, null, createElement("main", null, "the page")),
    ),
  );

describe("the SRP (API) sign-in", () => {
  test("is detected from the auth provider", () => {
    setAuthProvider(apiAuthProvider);
    expect(usesLocalSignIn()).toBe(true);
    setAuthProvider(supabaseAuthProvider);
    expect(usesLocalSignIn()).toBe(false);
  });

  test("hides the sample-data notice but still draws the page", () => {
    setAuthProvider(apiAuthProvider);
    const html = page();
    expect(html).toContain("the page");
    expect(html).not.toContain(SAMPLE_DATA_LABEL);
    expect(html).not.toContain('role="note"');
  });

  test("the admin console sign-in still shows the notice", () => {
    setAuthProvider(supabaseAuthProvider);
    const html = page();
    expect(html).toContain("the page");
    expect(html).toContain(SAMPLE_DATA_LABEL);
    expect(html).toContain('role="note"');
  });

  test("hides the Viewing as bar, and only the admin sign-in shows it when someone is acted as", () => {
    const actor = { name: "Rowan Quinn", role: "Professional" };
    expect(showActingAsBar(actor, true)).toBe(false);
    expect(showActingAsBar(actor, false)).toBe(true);
    expect(showActingAsBar(null, false)).toBe(false);
    expect(showActingAsBar(null, true)).toBe(false);
  });
});
