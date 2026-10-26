import { api } from "../api/server-fn";
import { accessActions } from "../actions";
import { readStored } from "../persist";
import type { AppThunk } from "../store";
import type { ControlRole, Grant } from "../types";

export const ROLE_STORAGE_KEY = "exp.activeRole";
export const GRANT_STORAGE_KEY = "exp.activeGrant";

const ROLE_RANK: Record<ControlRole, number> = { super_admin: 3, architect: 2, analyst: 1 };

export function grantScopeLabel(g: Grant): string {
  if (g.scope_label) return g.scope_label;
  if (g.scope_type === "global") return "Platform Administration";
  if (g.scope_type === "entity") return "Entity workspace";
  if (g.scope_type === "control_node") return "Control node workspace";
  return g.scope_type;
}

/** GET /admin/me/grants: the user's grants and the names of their entity / control-node scopes. */
type GrantsPayload = {
  grants: Grant[];
  entities: { entity_id: string; display_name: string }[];
  nodes: { node_id: string; name: string }[];
};

const NO_GRANTS: GrantsPayload = { grants: [], entities: [], nodes: [] };

function resolveScopeLabels(rows: Grant[], payload: GrantsPayload): Grant[] {
  const names = new Map<string, string>();
  for (const e of payload.entities) names.set(e.entity_id, e.display_name);
  for (const n of payload.nodes) names.set(n.node_id, n.name);

  return rows.map((r) => ({
    ...r,
    scope_label:
      r.scope_type === "global" ? "Platform Administration" : (names.get(r.scope_id) ?? grantScopeLabel(r)),
  }));
}

export async function logAudit(
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
  actingRole?: string | null,
): Promise<void> {
  // user_id is the token's user (the API sets it); errors are ignored, as before.
  await api
    .post("/admin/me/audit", {
      acting_role: actingRole ?? readStored("local", ROLE_STORAGE_KEY),
      action,
      target: target ?? null,
      details: details ?? {},
    })
    .catch(() => undefined);
}

/**
 * Load the user's grants and choose the active one: the remembered grant if it is still theirs,
 * else the only grant. `isCurrent` lets the caller drop a result that arrives after it went away.
 */
export const loadAccess =
  (isCurrent: () => boolean = () => true): AppThunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(accessActions.loading());

    // Errors read as no grants, as the supabase-js calls did (`data ?? []`).
    let payload = await api.get<GrantsPayload>("/admin/me/grants").catch(() => NO_GRANTS);

    // One-time bootstrap: the very first signed-in user becomes super_admin.
    if (payload.grants.length === 0) {
      payload = await api.post<GrantsPayload>("/admin/me/bootstrap").catch(() => NO_GRANTS);
    }
    if (!isCurrent()) return;

    let rows = [...payload.grants];
    rows.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);
    rows = resolveScopeLabels(rows, payload);

    const stored = readStored("local", GRANT_STORAGE_KEY);
    let activeGrantId: string | null = stored && rows.some((r) => r.id === stored) ? stored : null;
    // Single-grant users skip the chooser entirely.
    if (!activeGrantId && rows.length === 1) activeGrantId = rows[0]!.id;

    dispatch(accessActions.loaded({ grants: rows, activeGrantId }));
  };

export const selectGrant =
  (grantId: string): AppThunk =>
  (dispatch, getState) => {
    const g = getState().access.grants.find((x) => x.id === grantId);
    if (!g) return;
    dispatch(accessActions.activeGrantChanged(g.id));
    void logAudit(
      "workspace_switch",
      g.id,
      { role: g.role, scope_type: g.scope_type, scope_id: g.scope_id, scope: grantScopeLabel(g) },
      g.role,
    );
  };
