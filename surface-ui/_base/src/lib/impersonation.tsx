/**
 * Impersonation framework — the "actor × context × surface" primitive.
 *
 * One provider holds the acting-as stack. Entering a context PUSHES an actor;
 * returning POPS back to any ancestor, or all the way out to Super Admin.
 * The stack is persisted in sessionStorage so it survives navigation and
 * reloads within the tab, and it is intentionally NOT shared across tabs.
 *
 * The shell swap itself is structural: impersonated surfaces render their own
 * shell component (EnterpriseShell / ScopedShell) instead of the admin
 * ConsoleShell, so the admin left nav is never present while impersonating.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ActorKind = "brand" | "office" | "professional";

export type Actor = {
  kind: ActorKind;
  /** Organization id (brand/office) or professional id. */
  id: string;
  name: string;
  /** Human label for the seat being occupied, e.g. "Enterprise Admin". */
  role: string;
  /** Route to return to when popping back to this actor. */
  path: string;
  /** Brand slug that owns the context (used to build enterprise routes). */
  orgSlug?: string | null;
  logoUrl?: string | null;
  photoUrl?: string | null;
  isDemo?: boolean;
};

type ImpersonationValue = {
  /** Outermost → innermost. Empty means "acting as yourself" (Super Admin). */
  stack: Actor[];
  actingAs: Actor | null;
  /** Admin route captured when impersonation began. */
  returnTo: string;
  isImpersonating: boolean;
  /** Push a new actor onto the stack. */
  enter: (actor: Actor, returnTo?: string) => void;
  /** Pop back to the actor at `index` (keeping it as the acting actor). */
  returnToIndex: (index: number) => Actor | null;
  /** Drop the whole stack and go back to Super Admin. */
  exit: () => string;
};

const STORAGE_KEY = "xp.impersonation.v1";
const DEFAULT_RETURN = "/console";

const ImpersonationContext = createContext<ImpersonationValue | null>(null);

type Persisted = { stack: Actor[]; returnTo: string };

function read(): Persisted {
  if (typeof window === "undefined") return { stack: [], returnTo: DEFAULT_RETURN };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { stack: [], returnTo: DEFAULT_RETURN };
    const parsed = JSON.parse(raw) as Persisted;
    if (!Array.isArray(parsed.stack)) return { stack: [], returnTo: DEFAULT_RETURN };
    return { stack: parsed.stack, returnTo: parsed.returnTo || DEFAULT_RETURN };
  } catch {
    return { stack: [], returnTo: DEFAULT_RETURN };
  }
}

function write(value: Persisted) {
  if (typeof window === "undefined") return;
  try {
    if (value.stack.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>({ stack: [], returnTo: DEFAULT_RETURN });

  // Hydrate after mount so SSR/CSR markup agree.
  useEffect(() => {
    setState(read());
  }, []);

  const enter = useCallback((actor: Actor, returnTo?: string) => {
    setState((prev) => {
      const next: Persisted = {
        stack: [...prev.stack, actor],
        returnTo:
          prev.stack.length === 0
            ? returnTo ??
              (typeof window !== "undefined"
                ? window.location.pathname + window.location.search
                : DEFAULT_RETURN)
            : prev.returnTo,
      };
      write(next);
      return next;
    });
  }, []);

  const returnToIndex = useCallback(
    (index: number) => {
      const target = state.stack[index] ?? null;
      const next: Persisted = { stack: state.stack.slice(0, index + 1), returnTo: state.returnTo };
      write(next);
      setState(next);
      return target;
    },
    [state],
  );

  const exit = useCallback(() => {
    const to = state.returnTo || DEFAULT_RETURN;
    write({ stack: [], returnTo: DEFAULT_RETURN });
    setState({ stack: [], returnTo: DEFAULT_RETURN });
    return to;
  }, [state.returnTo]);

  const value = useMemo<ImpersonationValue>(
    () => ({
      stack: state.stack,
      actingAs: state.stack[state.stack.length - 1] ?? null,
      returnTo: state.returnTo || DEFAULT_RETURN,
      isImpersonating: state.stack.length > 0,
      enter,
      returnToIndex,
      exit,
    }),
    [state, enter, returnToIndex, exit],
  );

  return <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>;
}

export function useImpersonation(): ImpersonationValue {
  const ctx = useContext(ImpersonationContext);
  if (!ctx) throw new Error("useImpersonation must be used inside <ImpersonationProvider>");
  return ctx;
}

/** Safe variant for components that may render outside the authenticated tree. */
export function useOptionalImpersonation(): ImpersonationValue | null {
  return useContext(ImpersonationContext);
}

export const ROLE_FOR_KIND: Record<ActorKind, string> = {
  brand: "Enterprise Admin",
  office: "Location Manager",
  professional: "Professional",
};
