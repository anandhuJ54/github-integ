// Client shim: the opportunity's Google delivery functions (surface-api/sales).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/ui/lib/server-fn";

export const getGoogleDeliveryStatus = serverFn("sales", "getGoogleDeliveryStatus");
export const sendOpportunityEmail = serverFn("sales", "sendOpportunityEmail");
export const scheduleOpportunityMeeting = serverFn("sales", "scheduleOpportunityMeeting");
