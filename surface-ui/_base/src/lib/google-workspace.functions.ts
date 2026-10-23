// Client shim: the server implementation moved to FastAPI (surface-api/admin).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

export type Ctx = { supabase: any; userId: string; claims: { email?: string } };

export const getGoogleDeliveryStatus = serverFn("admin", "getGoogleDeliveryStatus");
export const getGoogleIntegration = serverFn("admin", "getGoogleIntegration");
export const startGoogleConnect = serverFn("admin", "startGoogleConnect");
export const startDomainVerification = serverFn("admin", "startDomainVerification");
export const checkDomainVerification = serverFn("admin", "checkDomainVerification");
export const sendOpportunityEmail = serverFn("admin", "sendOpportunityEmail");
export const scheduleOpportunityMeeting = serverFn("admin", "scheduleOpportunityMeeting");
export const dispatchGoogleOutbox = serverFn("admin", "dispatchGoogleOutbox");
