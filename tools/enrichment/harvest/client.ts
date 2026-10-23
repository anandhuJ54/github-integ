// Minimal DataForSEO v3 client: Basic auth, one task per POST, budget guard before every call,
// cost recorded from each response. Credentials and the Authorization header are never logged
// and never included in error messages.
import type { Budget } from "./budget";
import type { Credentials } from "./types";

export const BASE_URL = "https://api.dataforseo.com/v3/";
export const OK_STATUS = 20000;

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export class DataForSeoError extends Error {
  constructor(
    message: string,
    public endpoint: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}

interface Task {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: unknown[] | null;
}

interface ApiResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Task[];
}

// Prefer the top-level `cost`; fall back to the sum of task costs.
export function responseCost(r: ApiResponse): number {
  if (typeof r.cost === "number" && Number.isFinite(r.cost)) return r.cost;
  return (r.tasks ?? []).reduce((s, t) => s + (typeof t.cost === "number" && Number.isFinite(t.cost) ? t.cost : 0), 0);
}

export class DataForSeoClient {
  private authHeader: string;

  constructor(
    creds: Credentials,
    private budget: Budget,
    private fetchFn: FetchFn = (url, init) => fetch(url, init),
    private baseUrl: string = BASE_URL,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${creds.login}:${creds.password}`).toString("base64")}`;
  }

  // Returns the first task's first `result` object (null when the task returned no result).
  async post(step: string, endpoint: string, task: object, estimateUsd: number): Promise<unknown> {
    this.budget.assertCanSpend(estimateUsd);
    let res: Response;
    try {
      res = await this.fetchFn(this.baseUrl + endpoint, {
        method: "POST",
        headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([task]),
      });
    } catch (e) {
      throw new DataForSeoError(`${endpoint}: network error (${(e as Error).name})`, endpoint);
    }
    if (!res.ok) throw new DataForSeoError(`${endpoint}: HTTP ${res.status}`, endpoint, res.status);
    let json: ApiResponse;
    try {
      json = (await res.json()) as ApiResponse;
    } catch {
      throw new DataForSeoError(`${endpoint}: response was not JSON`, endpoint);
    }
    // Record cost first: a failed task can still have been billed.
    this.budget.record(step, endpoint, responseCost(json));
    if (json.status_code !== undefined && json.status_code !== OK_STATUS) {
      throw new DataForSeoError(`${endpoint}: API status ${json.status_code} ${json.status_message ?? ""}`.trim(), endpoint, json.status_code);
    }
    const t = json.tasks?.[0];
    if (!t) throw new DataForSeoError(`${endpoint}: response had no tasks`, endpoint);
    if (t.status_code !== undefined && t.status_code !== OK_STATUS) {
      throw new DataForSeoError(`${endpoint}: task status ${t.status_code} ${t.status_message ?? ""}`.trim(), endpoint, t.status_code);
    }
    return t.result?.[0] ?? null;
  }
}
