import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { impersonationActions, sessionActions } from "@v3/state/actions";
import { loadAccess, selectGrant } from "@v3/state/access/thunks";
import { setAuthProvider, type AuthEvent, type AuthProvider, type AuthSession } from "@v3/state/auth";
import { persistOnChange } from "@v3/state/persist";
import { appPersistRules } from "@v3/state/persist-rules";
import { bootstrapSession, whenSessionReady } from "@v3/state/session/bootstrap";
import { getCurrentUser } from "@v3/state/session/current-user";
import { store } from "@v3/state/store";
import { registerAppState } from "./register";

const session: AuthSession = { accessToken: "t", user: { id: "u1", email: "a@b.c" } };

function fakeProvider(initial: AuthSession | null) {
  let listener: ((e: AuthEvent, s: AuthSession | null) => void) | null = null;
  const provider: AuthProvider = {
    name: "fake",
    getSession: async () => initial,
    getAccessToken: async () => initial?.accessToken ?? null,
    signOut: async () => listener?.("SIGNED_OUT", null),
    onChange: (l) => {
      listener = l;
      return () => (listener = null);
    },
  };
  return provider;
}

const realFetch = globalThis.fetch;
function stubGrants(grants: unknown[]) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ grants, entities: [], nodes: [] }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const g = (id: string, role: string) => ({ id, role, scope_type: "global", scope_id: "x", is_primary: false });

beforeEach(() => {
  registerAppState();
  setAuthProvider(fakeProvider(session));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("session", () => {
  test("starts with the three app slices registered and the session loading", () => {
    const s = store.getState();
    expect(Object.keys(s).sort()).toEqual(["access", "impersonation", "session"]);
    expect(s.session.status).toBe("loading");
  });

  test("bootstrap restores a stored session", async () => {
    const off = bootstrapSession(store);
    const ready = await whenSessionReady(store);
    off();
    expect(ready.status).toBe("authed");
    expect(store.getState().session.user?.id).toBe("u1");
  });

  test("signing out clears the session, grants and impersonation", () => {
    store.dispatch(sessionActions.signedIn(session.user));
    store.dispatch(
      impersonationActions.entered({
        actor: { kind: "brand", id: "b", name: "B", role: "Enterprise Admin", path: "/p" },
        returnTo: "/console",
      }),
    );
    store.dispatch(sessionActions.signedOut());
    const s = store.getState();
    expect(s.session).toEqual({ status: "anon", user: null });
    expect(s.access.grants).toEqual([]);
    expect(s.impersonation.stack).toEqual([]);
  });
});

describe("getCurrentUser", () => {
  test("reads the user through the auth adapter, for code outside React", async () => {
    setAuthProvider(fakeProvider(session));
    expect((await getCurrentUser())?.email).toBe("a@b.c");
    setAuthProvider(fakeProvider(null));
    expect(await getCurrentUser()).toBeNull();
  });
});

describe("access", () => {
  test("a single grant is selected without asking", async () => {
    stubGrants([g("a", "analyst")]);
    await store.dispatch(loadAccess());
    expect(store.getState().access.activeGrantId).toBe("a");
    expect(store.getState().access.loading).toBe(false);
  });

  test("several grants load highest role first and wait for a choice", async () => {
    stubGrants([g("a", "analyst"), g("s", "super_admin"), g("r", "architect")]);
    await store.dispatch(loadAccess());
    const { grants, activeGrantId } = store.getState().access;
    expect(grants.map((x) => x.id)).toEqual(["s", "r", "a"]);
    expect(activeGrantId).toBeNull();
    store.dispatch(selectGrant("r"));
    expect(store.getState().access.activeGrantId).toBe("r");
  });

  test("a result that arrives after the caller left is dropped", async () => {
    store.dispatch(sessionActions.signedOut()); // empty the grants the earlier tests loaded
    stubGrants([g("a", "analyst")]);
    await store.dispatch(loadAccess(() => false));
    expect(store.getState().access.grants).toEqual([]);
  });
});

describe("impersonation", () => {
  const actor = (id: string) => ({ kind: "office" as const, id, name: id, role: "Location Manager", path: `/${id}` });

  test("enter keeps the first returnTo, returnedTo pops, exited clears", () => {
    store.dispatch(impersonationActions.entered({ actor: actor("one"), returnTo: "/first" }));
    store.dispatch(impersonationActions.entered({ actor: actor("two"), returnTo: "/second" }));
    expect(store.getState().impersonation.returnTo).toBe("/first");
    expect(store.getState().impersonation.stack.map((a) => a.id)).toEqual(["one", "two"]);
    store.dispatch(impersonationActions.returnedTo(0));
    expect(store.getState().impersonation.stack.map((a) => a.id)).toEqual(["one"]);
    store.dispatch(impersonationActions.exited());
    expect(store.getState().impersonation.stack).toEqual([]);
  });
});

describe("persistence", () => {
  test("only the grant, its role and the impersonation stack are selected, never the session", () => {
    store.dispatch(sessionActions.signedIn(session.user));
    const written = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => written.get(k) ?? null, setItem: (k: string, v: string) => void written.set(k, v), removeItem: (k: string) => void written.delete(k) },
      sessionStorage: { getItem: () => null, setItem: (k: string, v: string) => void written.set(k, v), removeItem: (k: string) => void written.delete(k) },
    };
    const off = persistOnChange(appPersistRules, store);
    store.dispatch({ type: "access/loaded", payload: { grants: [g("s", "super_admin")], activeGrantId: "s" } });
    off();
    delete (globalThis as { window?: unknown }).window;
    expect(written.get("exp.activeGrant")).toBe("s");
    expect(written.get("exp.activeRole")).toBe("super_admin");
    expect([...written.keys()].some((k) => k.includes("session") || k.includes("token"))).toBe(false);
  });
});
