import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Eye, LogOut, ShieldCheck } from "lucide-react";
import { useImpersonation } from "@v3/state/impersonation/impersonation";
import { DemoChip } from "@v3/shared/components/ui/entity-avatar";
import { usesLocalSignIn } from "@v3/srp/utils/local-sign-in";

/** The bar shows while someone is acted as, except in the SRP (API) sign-in, which has no Super Admin to return to. */
export function showActingAsBar(actingAs: unknown, local: boolean): boolean {
  return Boolean(actingAs) && !local;
}

/**
 * Sticky bar shown whenever an admin is acting as another entity.
 * Always offers a one-click return to Super Admin, plus a return to every
 * ancestor context when nested (brand → location → professional).
 */
export function ActingAsBar() {
  const { stack, actingAs, returnToIndex, exit } = useImpersonation();
  const navigate = useNavigate();

  if (!showActingAsBar(actingAs, usesLocalSignIn())) return null;
  if (!actingAs) return null; // narrows the type

  const ancestors = stack.slice(0, -1);

  return (
    <div className="sticky top-0 z-50 border-b border-[#f6c344] bg-[#fff8e1]">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#8a5300]">
          <Eye className="h-3.5 w-3.5" /> Viewing as
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          {actingAs.name}
          <span className="font-normal text-[#8a5300]">· {actingAs.role}</span>
          {actingAs.isDemo ? <DemoChip /> : null}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ancestors.map((a, i) => (
            <button
              key={`${a.kind}-${a.id}`}
              onClick={() => {
                const target = returnToIndex(i);
                if (target) void navigate({ to: target.path as never });
              }}
              className="inline-flex items-center gap-1 rounded-full border border-[#f6c344] bg-white/70 px-2.5 py-1 font-semibold text-[#8a5300] transition-colors hover:bg-white"
            >
              Return to {a.name} <ChevronRight className="h-3 w-3" />
            </button>
          ))}
          <button
            onClick={() => {
              const to = exit();
              void navigate({ to: to as never });
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#12294D] px-3 py-1 font-semibold text-white transition-opacity hover:opacity-90"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Return to Super Admin
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
