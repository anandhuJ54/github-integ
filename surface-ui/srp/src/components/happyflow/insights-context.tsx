import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { InsightsModel } from "@v3/srp/utils/insights-model";
import { useHfPersona } from "./persona-context";
import { sampleInsightsModel } from "./sample-insights";

const ModelCtx = createContext<InsightsModel | null>(null);

/** Gives the Insights screen the seat's Insights model (srp/insights-page-schema); without one it builds the sample page. */
export function HfInsightsModelProvider({
  model,
  children,
}: {
  model: InsightsModel | null;
  children: ReactNode;
}) {
  return <ModelCtx.Provider value={model}>{children}</ModelCtx.Provider>;
}

/** The seat's own Insights model, or null (the sample page). */
export function useRealInsightsModel(): InsightsModel | null {
  return useContext(ModelCtx);
}

/** The model the Insights screen renders: the seat's when there is one, else the sample page's (with the persona's own name in the competitor table). */
export function useInsightsModel(): InsightsModel {
  const real = useContext(ModelCtx);
  const persona = useHfPersona();
  return useMemo(() => real ?? sampleInsightsModel(persona), [real, persona]);
}
