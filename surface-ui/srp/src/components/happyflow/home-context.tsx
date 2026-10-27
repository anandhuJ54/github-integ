import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { HomeModel } from "@v3/srp/utils/home-model";
import type { HfDay } from "./demo-data";
import { sampleHomeModel } from "./sample-home";

const ModelCtx = createContext<HomeModel | null>(null);

/** Gives the Home layouts the seat's Home model (srp/home-page-schema); without one they build the sample page. */
export function HfHomeModelProvider({ model, children }: { model: HomeModel | null; children: ReactNode }) {
  return <ModelCtx.Provider value={model}>{children}</ModelCtx.Provider>;
}

/** The seat's own Home model, or null (the sample page). */
export function useRealHomeModel(): HomeModel | null {
  return useContext(ModelCtx);
}

/** The model a Home layout renders: the seat's when there is one, else the sample page's for `day` (`first` is the persona's first name). */
export function useHomeModel(day: HfDay, first: string): HomeModel {
  const real = useContext(ModelCtx);
  return useMemo(() => real ?? sampleHomeModel(day, first), [real, day, first]);
}
