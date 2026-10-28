import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ProfileModel } from "@v3/srp/utils/profile-model";
import { useHfPersona } from "./persona-context";
import { sampleProfileModel } from "./sample-profile";

const ModelCtx = createContext<ProfileModel | null>(null);

/** Gives the Profile screen the seat's Profile model (srp/profile-page-schema); without one it builds the sample page. */
export function HfProfileModelProvider({
  model,
  children,
}: {
  model: ProfileModel | null;
  children: ReactNode;
}) {
  return <ModelCtx.Provider value={model}>{children}</ModelCtx.Provider>;
}

/** The seat's own Profile model, or null (the sample page). */
export function useRealProfileModel(): ProfileModel | null {
  return useContext(ModelCtx);
}

/** The model the Profile screen renders: the seat's when there is one, else the sample page's (with the persona's own name, title, phone and email). */
export function useProfileModel(): ProfileModel {
  const real = useContext(ModelCtx);
  const persona = useHfPersona();
  return useMemo(() => real ?? sampleProfileModel(persona), [real, persona]);
}
