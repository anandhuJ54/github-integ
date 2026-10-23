// Client shim: the server implementation moved to FastAPI (surface-api/conversion_agents).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";
// Types copied from lib/nora/claim-gate.ts (server-side; ported to FastAPI).
export type Tier = 0 | 1 | 2;
export type Signal = { matched: boolean; weight: number; detail?: string };
export type UiStatus = "approved" | "needs_verification" | "manual_review" | "already_claimed";

export type ClaimResponse = {
  status: UiStatus;
  confidence?: number;
  signals?: Record<string, Signal>;
  professionalId?: string;
  needsLicense?: boolean;
  tier?: Tier;
  challenge?: { sent: boolean; destination: string | null } | null;
  otp?: string;
  message?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const submitClaim = serverFn<ClaimResponse>("conversion_agents", "submitClaim");
export const verifyClaimCode = serverFn<ClaimResponse>("conversion_agents", "verifyClaimCode");
export const releaseClaim = serverFn("conversion_agents", "releaseClaim");
