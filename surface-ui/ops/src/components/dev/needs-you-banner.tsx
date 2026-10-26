import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { loadOpenGates, type OpenGate } from "@v3/ops/utils/dev-progress";

/** Amber "needs Scott" gate badge, reused inline on sprint items. */
export function GateBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1e0] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#b45309]">
      <AlertTriangle className="h-3 w-3" /> Gate — needs Scott
    </span>
  );
}

/**
 * Live banner over the dev-progress surfaces. Reads exp_dev_sprint_items for
 * is_gate items that are not done. Pass teamId to scope to one team.
 */
export function NeedsYouBanner({ teamId }: { teamId?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dev-open-gates", teamId ?? "all"],
    queryFn: () => loadOpenGates(teamId),
  });

  if (isLoading) return null;
  const gates: OpenGate[] = data ?? [];

  if (!gates.length) {
    return (
      <div className="mb-6 flex items-start gap-3 rounded-[16px] border border-[color:var(--color-g-green)] bg-[color:var(--color-g-green-soft)] p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#1e8e3e]" />
        <div>
          <p className="text-sm font-semibold text-[#1e8e3e]">On track — nothing needs you</p>
          <p className="mt-0.5 text-xs text-[color:var(--color-ink-2)]">
            No open decision gates on sprint items.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-[16px] border-2 border-[#f59e0b] bg-[#fff8ec] p-4 shadow-[var(--shadow-xs)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#b45309]" />
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-[#b45309]">
            Needs you — {gates.length} open {gates.length === 1 ? "gate" : "gates"}
          </p>
          <ul className="mt-2 space-y-2">
            {gates.map((g) => (
              <li key={g.id} className="text-xs text-ink">
                <span className="font-semibold">{g.title}</span>
                <span className="text-[color:var(--color-ink-2)]">
                  {" "}
                  · {g.team_name ?? "unassigned team"} › {g.sprint_name ?? "no sprint"} ·{" "}
                  {(g.status ?? "todo").replace("_", " ")} · needs Scott
                </span>
                {g.deep_instructions ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[color:var(--color-ink-2)]">
                    {g.deep_instructions}
                  </p>
                ) : null}
                {g.canon_ref ? (
                  <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[color:var(--color-ink-3)]">
                    Canon: {g.canon_ref}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
