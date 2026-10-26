// Client shim: the server implementation moved to FastAPI (surface-api/admin).
// Each export keeps the createServerFn call shape: fn({ data }) -> Promise<result>.
import { serverFn } from "@v3/state/api/server-fn";
import type { IntegrationStatus } from "@v3/admin/utils/integrations";



export const getNoraIntegrations = serverFn<{ integrations: IntegrationStatus[] }>("admin", "getNoraIntegrations");
export const updateNoraIntegration = serverFn("admin", "updateNoraIntegration");
