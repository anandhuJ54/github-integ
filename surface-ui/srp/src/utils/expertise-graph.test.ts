import { afterEach, describe, expect, test } from "bun:test";
import { setAuthProvider, type AuthProvider } from "@v3/state/auth";
import { loadExpertiseGraph } from "./expertise-graph";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const anon: AuthProvider = {
  name: "fake",
  getSession: async () => null,
  getAccessToken: async () => null,
  signOut: async () => {},
  onChange: () => () => {},
};

function stubFetch(body: unknown) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return urls;
}

describe("loadExpertiseGraph", () => {
  test("reads only the graph Surface's published endpoint", async () => {
    setAuthProvider(anon);
    const urls = stubFetch(null);
    await loadExpertiseGraph("professional", "jane doe");
    expect(urls).toEqual(["/api/graph/expertise/professional/jane%20doe"]);
  });

  test("no data for the entity gives null", async () => {
    setAuthProvider(anon);
    stubFetch(null);
    expect(await loadExpertiseGraph("professional", "nobody")).toBeNull();
  });

  test("an entity with no rows has no populated ring from live data", async () => {
    setAuthProvider(anon);
    stubFetch({ entity: { id: "p1", display_name: "Jane Doe", slug: "jane" }, score: null, reviewCount: 0, org: null, brand: null, ownRows: [], edges: [], external: [] });
    const g = await loadExpertiseGraph("professional", "jane");
    expect(g).not.toBeNull();
    expect(g!.liveCount).toBe(0);
    expect(g!.reviewCount).toBe(0);
    expect(g!.summary.find((s) => s.key === "reviews")?.populated).toBe(false);
  });
});
