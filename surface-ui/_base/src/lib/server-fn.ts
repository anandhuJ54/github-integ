import { supabase } from "@v3/ui/integrations/supabase/client";

/**
 * Client side of a server function. The implementation lives in FastAPI at
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serverFn<Out = any>(apiSurface: string, name: string): ServerFn<Out> {
  return async (opts) => {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    const res = await fetch(`/api/${apiSurface}/fn/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ data: opts?.data ?? null }),
      signal: opts?.signal,
    });
    const body = res.headers.get("content-type")?.includes("application/json")
      ? await res.json()
      : await res.text();
    if (!res.ok) {
      const detail = typeof body === "object" && body && "detail" in body ? body.detail : body;
      throw new ServerFnError(typeof detail === "string" ? detail : JSON.stringify(detail), res.status);
    }
    return body;
  };
}

/** Drop-in for TanStack Start's useServerFn: the shim is already a plain async function. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useServerFn<F extends ServerFn<any>>(fn: F): F {
  return fn;
}
