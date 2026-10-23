import { supabase } from "@v3/ui/integrations/supabase/client";

/**
 * Client side of FastAPI: `api.get/post` for a Surface's endpoints, and `serverFn` for a
 * server function. The implementation lives in FastAPI at
 * POST /<api_surface>/fn/<name> (reached through the /api proxy). Keeps the old
 * createServerFn call shape, `fn({ data })`, so call sites are unchanged.
 */
// Result type comes from the old handler's declared return type where it had one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServerFn<Out = any> = (opts?: { data?: any; signal?: AbortSignal }) => Promise<Out>;

export class ServerFnError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServerFnError";
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** One request to FastAPI through the /api proxy, with the user's JWT; throws ServerFnError. */
async function request<Out>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; signal?: AbortSignal } = {},
): Promise<Out> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(await authHeaders()),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const body = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const detail = typeof body === "object" && body && "detail" in body ? body.detail : body;
    throw new ServerFnError(typeof detail === "string" ? detail : JSON.stringify(detail), res.status);
  }
  return body as Out;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, params?: Query): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Typed client for a Surface's own FastAPI endpoints (the browser-to-API migration).
 * `path` is the API path without the /api prefix, e.g. `api.get<EtlMonitor>("/nora-os/etl-monitor")`.
 */
export const api = {
  get: <Out>(path: string, opts: { params?: Query; signal?: AbortSignal } = {}) =>
    request<Out>("GET", withQuery(path, opts.params), { signal: opts.signal }),
  post: <Out>(path: string, body?: unknown, opts: { signal?: AbortSignal } = {}) =>
    request<Out>("POST", path, { body: body ?? null, signal: opts.signal }),
  put: <Out>(path: string, body: unknown, opts: { signal?: AbortSignal } = {}) =>
    request<Out>("PUT", path, { body, signal: opts.signal }),
  patch: <Out>(path: string, body: unknown, opts: { signal?: AbortSignal } = {}) =>
    request<Out>("PATCH", path, { body, signal: opts.signal }),
  delete: <Out>(path: string, opts: { signal?: AbortSignal } = {}) =>
    request<Out>("DELETE", path, { signal: opts.signal }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverFn<Out = any>(apiSurface: string, name: string): ServerFn<Out> {
  return (opts) =>
    request<Out>("POST", `/${apiSurface}/fn/${name}`, {
      body: { data: opts?.data ?? null },
      signal: opts?.signal,
    });
}

/** Drop-in for TanStack Start's useServerFn: the shim is already a plain async function. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useServerFn<F extends ServerFn<any>>(fn: F): F {
  return fn;
}
