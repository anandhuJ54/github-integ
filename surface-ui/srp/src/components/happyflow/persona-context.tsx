import { createContext, useContext, useMemo, type ReactNode } from "react";
import { mergePersona, personaFromSeat, personalize, type HfPersona } from "./persona";

const SAMPLE = mergePersona({});
const Ctx = createContext<HfPersona>(SAMPLE);

/** Gives the Happyflow screens the signed-in professional's name and title; without a seat, the sample persona. */
export function HfPersonaProvider({
  seat,
  children,
}: {
  seat: Parameters<typeof personaFromSeat>[0];
  children: ReactNode;
}) {
  const persona = useMemo(() => mergePersona(personaFromSeat(seat)), [seat]);
  return <Ctx.Provider value={persona}>{children}</Ctx.Provider>;
}

export function useHfPersona(): HfPersona {
  return useContext(Ctx);
}

/** `t(text)`: demo text with the sample persona's name, address and site swapped for the real person's. */
export function usePersonalize(): (text: string) => string {
  const persona = useContext(Ctx);
  return useMemo(() => (text: string) => personalize(text, persona), [persona]);
}
