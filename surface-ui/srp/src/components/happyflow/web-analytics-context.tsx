import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { WebAnalyticsModel } from "@v3/srp/utils/web-analytics-model";
import { useHfPersona } from "./persona-context";
import { sampleWebAnalyticsModel } from "./sample-web-analytics";

const ModelCtx = createContext<WebAnalyticsModel | null>(null);

/** Gives the Website screen the seat's Web analytics model (srp/web-analytics-page-schema); without one it builds the sample page. */
export function HfWebAnalyticsModelProvider({
  model,
  children,
}: {
  model: WebAnalyticsModel | null;
  children: ReactNode;
}) {
  return <ModelCtx.Provider value={model}>{children}</ModelCtx.Provider>;
}

/** The seat's own Web analytics model, or null (the sample page). */
export function useRealWebAnalyticsModel(): WebAnalyticsModel | null {
  return useContext(ModelCtx);
}

/** The model the Website screen renders: the seat's when there is one, else the sample page's (with the persona's own name and site address). */
export function useWebAnalyticsModel(): WebAnalyticsModel {
  const real = useContext(ModelCtx);
  const persona = useHfPersona();
  return useMemo(() => real ?? sampleWebAnalyticsModel(persona), [real, persona]);
}
