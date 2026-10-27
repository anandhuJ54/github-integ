// The API sign-in adapter, provider selection and the sign-in path (srp/local-login-srp-home, tasks 9-10).
// Whatever VITE_SUPABASE_* the machine has is irrelevant: after every test, every request the flow made
// must have gone to the app's own /api, never to another host.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { apiAuthProvider, AuthError } from "./adapters/api";
import type { AuthEvent, AuthSession } from "./auth-provider";
import { authProviderFromEnv, getAuthProvider, setAuthProvider, signInPath } from "./index";

const KEY = "v3.srp.session";
const realFetch = globalThis.fetch;
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

class MemStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

const loginBody = (over: Record<string, unknown> = {}) => ({
  access_token: "tok-abc",
  token_type: "Bearer",
  expires_at: future(),
  user: { id: "7", email: "mock.users.7@example.test", first_name: "Riley", last_name: "Okafor" },
  landing: { path: "/seat/professional/42" },
  ...over,
});

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let storage: MemStorage;
beforeEach(() => {
  calls = [];
  storage = new MemStorage();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = storage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => {
      throw new Error("localStorage must not be used for the session");
    },
    setItem: () => {
      throw new Error("localStorage must not be used for the session");
    },
    removeItem: () => {
      throw new Error("localStorage must not be used for the session");
    },
  };
});
afterEach(async () => {
  for (const c of calls) expect(c.url.startsWith("/api/")).toBe(true); // nothing left the app, so nothing reached Supabase
  await apiAuthProvider.signOut();
  globalThis.fetch = realFetch;
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const signIn = () => apiAuthProvider.signInWithPassword!("mock.users.7@example.test", "pw-for-test-1234");

describe("sign in", () => {
  test("posts the credentials to /srp/auth/login and returns the session and landing path", async () => {
    stubFetch(() => json(200, loginBody()));
    const { session, landingPath } = await signIn();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/srp/auth/login");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      email: "mock.users.7@example.test",
      password: "pw-for-test-1234",
    });
    expect(landingPath).toBe("/seat/professional/42");
    expect(session.accessToken).toBe("tok-abc");
    expect(session.user).toEqual({
      id: "7",
      email: "mock.users.7@example.test",
      user_metadata: { first_name: "Riley", last_name: "Okafor" },
    });
  });

  test("the session lives in sessionStorage, never localStorage", async () => {
    stubFetch(() => json(200, loginBody()));
    await signIn();
    expect([...storage.data.keys()]).toEqual([KEY]);
    expect(storage.data.get(KEY)).toContain("tok-abc");
  });

  test("still signs in for the page when sessionStorage is unavailable", async () => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    stubFetch(() => json(200, loginBody()));
    await signIn();
    expect(await apiAuthProvider.getAccessToken()).toBe("tok-abc");
  });

  test("tells listeners, and stops when they unsubscribe", async () => {
    const seen: [AuthEvent, AuthSession | null][] = [];
    const off = apiAuthProvider.onChange((e, s) => seen.push([e, s]));
    stubFetch(() => json(200, loginBody()));
    await signIn();
    expect(seen.map(([e]) => e)).toEqual(["SIGNED_IN"]);
    expect(seen[0]![1]?.landingPath).toBe("/seat/professional/42");
    off();
    await apiAuthProvider.signOut();
    expect(seen).toHaveLength(1);
  });

  test("a wrong password is invalid_credentials and leaves no session", async () => {
    stubFetch(() => json(401, { detail: "invalid_credentials" }));
    const err = await signIn().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe("invalid_credentials");
    expect(storage.data.size).toBe(0);
    expect(await apiAuthProvider.getAccessToken()).toBeNull();
  });

  test("a user without a seat is no_professional_seat", async () => {
    stubFetch(() => json(403, { detail: "no_professional_seat" }));
    expect((await signIn().catch((e) => e)).code).toBe("no_professional_seat");
  });

  test("a rejected body (422) reads as invalid_credentials", async () => {
    stubFetch(() => json(422, { detail: [] }));
    expect((await signIn().catch((e) => e)).code).toBe("invalid_credentials");
  });

  test.each([
    ["a server error", () => json(500, { detail: "boom" })],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["a body without a token", () => json(200, loginBody({ access_token: undefined }))],
    ["a landing path that leaves the app", () => json(200, loginBody({ landing: { path: "//evil.example" } }))],
    ["a landing path that is not a path", () => json(200, loginBody({ landing: { path: "https://evil.example" } }))],
  ])("%s is unavailable and leaves no session", async (_name, handler) => {
    stubFetch(handler as () => Response | Promise<Response>);
    const err = await signIn().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe("unavailable");
    expect(storage.data.size).toBe(0);
  });

  test("neither the password nor the token is ever logged or put in an error", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => spyOn(console, m));
    stubFetch(() => json(200, loginBody()));
    await signIn();
    stubFetch(() => json(401, { detail: "invalid_credentials" }));
    const err = await signIn().catch((e) => e);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(logged).not.toContain("pw-for-test-1234");
    expect(logged).not.toContain("tok-abc");
    expect(String(err.message)).not.toContain("pw-for-test-1234");
  });
});

describe("session", () => {
  const stored = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      accessToken: "tok-abc",
      expiresAt: future(),
      user: { id: "7", email: "mock.users.7@example.test" },
      landingPath: "/seat/professional/42",
      ...over,
    });

  test("a signed-in page reload checks /srp/auth/me with the token and keeps the session", async () => {
    storage.setItem(KEY, stored());
    stubFetch(() =>
      json(200, {
        user: { id: "7", email: "mock.users.7@example.test", first_name: "Riley", last_name: "Okafor" },
        landing: { path: "/seat/professional/42" },
      }),
    );
    const session = await apiAuthProvider.getSession();
    expect(calls[0]!.url).toBe("/api/srp/auth/me");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok-abc");
    expect(session?.user.id).toBe("7");
    expect(session?.landingPath).toBe("/seat/professional/42");
  });

  test.each([401, 403])("a %s from /srp/auth/me ends the session and clears it", async (status) => {
    storage.setItem(KEY, stored());
    stubFetch(() => json(status, { detail: "nope" }));
    expect(await apiAuthProvider.getSession()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  test("an unreachable API means no session for now, but the stored one is kept", async () => {
    storage.setItem(KEY, stored());
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await apiAuthProvider.getSession()).toBeNull();
    expect(storage.data.has(KEY)).toBe(true);
  });

  test("an expired stored session is dropped without a request", async () => {
    storage.setItem(KEY, stored({ expiresAt: past() }));
    stubFetch(() => json(200, {}));
    expect(await apiAuthProvider.getSession()).toBeNull();
    expect(calls).toHaveLength(0);
    expect(storage.data.size).toBe(0);
  });

  test("a damaged stored session is dropped", async () => {
    storage.setItem(KEY, "{not json");
    stubFetch(() => json(200, {}));
    expect(await apiAuthProvider.getSession()).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  test("getAccessToken is null once the session has expired, and listeners hear SIGNED_OUT", async () => {
    storage.setItem(KEY, stored({ expiresAt: past() }));
    const seen: AuthEvent[] = [];
    const off = apiAuthProvider.onChange((e) => seen.push(e));
    expect(await apiAuthProvider.getAccessToken()).toBeNull();
    off();
    expect(seen).toContain("SIGNED_OUT");
  });

  test("sign out clears the session and tells listeners", async () => {
    stubFetch(() => json(200, loginBody()));
    await signIn();
    const seen: AuthEvent[] = [];
    const off = apiAuthProvider.onChange((e) => seen.push(e));
    await apiAuthProvider.signOut();
    off();
    expect(seen).toEqual(["SIGNED_OUT"]);
    expect(storage.data.size).toBe(0);
    expect(await apiAuthProvider.getAccessToken()).toBeNull();
  });
});

describe("provider selection", () => {
  test("api, supabase and unset pick the matching adapter", () => {
    expect(authProviderFromEnv("api").name).toBe("api");
    expect(authProviderFromEnv("supabase").name).toBe("supabase");
    expect(authProviderFromEnv(undefined).name).toBe("supabase");
    expect(authProviderFromEnv("").name).toBe("supabase");
  });

  test("an unknown value is an error, not a silent default", () => {
    expect(() => authProviderFromEnv("firebase")).toThrow(/VITE_AUTH_PROVIDER/);
  });

  test("the sign-in page is /sign-in for the api provider and /auth otherwise", () => {
    setAuthProvider(authProviderFromEnv("api"));
    expect(getAuthProvider().name).toBe("api");
    expect(signInPath()).toBe("/sign-in");
    setAuthProvider(authProviderFromEnv("supabase"));
    expect(signInPath()).toBe("/auth");
  });
});
