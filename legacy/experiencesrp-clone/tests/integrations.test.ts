import { describe, expect, test } from "bun:test";
import { deriveIntegrationStatus, notConfigured } from "../src/lib/integrations";

const base = { mode: "stub" as const, refs: {}, settings: {}, persisted: true };

describe("integration status", () => {
  test("missing secrets → not_configured with ref names", () => {
    const s = deriveIntegrationStatus("google_places", base, () => false);
    expect(s.status).toBe("not_configured");
    expect(s.missing).toEqual(["GOOGLE_PLACES_API_KEY"]);
  });
  test("secrets present but mode stub → configured_stub", () => {
    expect(deriveIntegrationStatus("google_business_profile", base, () => true).status).toBe(
      "configured_stub",
    );
  });
  test("apify needs actor IDs before it is ready", () => {
    const s = deriveIntegrationStatus("apify", { ...base, mode: "live" }, () => true);
    expect(s.status).toBe("not_configured");
    expect(s.missing).toEqual(["mapRankActorId", "llmCitationActorId"]);
    const ok = deriveIntegrationStatus(
      "apify",
      { ...base, mode: "live", settings: { mapRankActorId: "a", llmCitationActorId: "b" } },
      () => true,
    );
    expect(ok.status).toBe("live");
  });
  test("never live when settings are not persisted (unmigrated)", () => {
    expect(
      deriveIntegrationStatus(
        "google_places",
        { ...base, mode: "live", persisted: false },
        () => true,
      ).status,
    ).toBe("configured_stub");
  });
  test("custom ref names are honored", () => {
    const s = deriveIntegrationStatus(
      "google_places",
      { ...base, refs: { apiKey: "MY_KEY" } },
      (r) => r === "MY_KEY",
    );
    expect(s.secrets.apiKey).toBe(true);
  });
  test("stub result is typed not_configured, no data", () => {
    const r = notConfigured(deriveIntegrationStatus("google_places", base, () => false));
    expect(r).toMatchObject({
      ok: false,
      status: "not_configured",
      integration: "google_places",
      mode: "stub",
    });
    expect("data" in r).toBe(false);
  });
});
