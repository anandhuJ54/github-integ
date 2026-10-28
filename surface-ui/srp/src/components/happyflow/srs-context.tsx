import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SrsModel } from "@v3/srp/utils/srs-model";
import { sampleSrsModel } from "./sample-srs";

const ModelCtx = createContext<SrsModel | null>(null);

/** Gives the SRS screen the seat's SRS model (srp/srs-page-schema); without one it builds the sample page. */
export function HfSrsModelProvider({ model, children }: { model: SrsModel | null; children: ReactNode }) {
  return <ModelCtx.Provider value={model}>{children}</ModelCtx.Provider>;
}

/** The seat's own SRS model, or null (the sample page). */
export function useRealSrsModel(): SrsModel | null {
  return useContext(ModelCtx);
}

/** The model the SRS screen renders: the seat's when there is one, else the sample page's. */
export function useSrsModel(): SrsModel {
  const real = useContext(ModelCtx);
  return useMemo(() => real ?? sampleSrsModel(), [real]);
}
