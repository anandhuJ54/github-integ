import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ConnectionsModel } from "@v3/srp/utils/connections-model";
import { sampleConnectionsModel } from "./sample-connections";

const ModelCtx = createContext<ConnectionsModel | null>(null);

/** Gives the Connections screen the seat's Connections model (srp/connections-page-schema); without one it builds the sample page. */
export function HfConnectionsModelProvider({
  model,
  children,
}: {
  model: ConnectionsModel | null;
  children: ReactNode;
}) {
  return <ModelCtx.Provider value={model}>{children}</ModelCtx.Provider>;
}

/** The seat's own Connections model, or null (the sample page). */
export function useRealConnectionsModel(): ConnectionsModel | null {
  return useContext(ModelCtx);
}

/** The model the Connections screen renders: the seat's when there is one, else the sample page's. */
export function useConnectionsModel(): ConnectionsModel {
  const real = useContext(ModelCtx);
  return useMemo(() => real ?? sampleConnectionsModel(), [real]);
}
