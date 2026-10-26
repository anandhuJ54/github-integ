import { useQuery } from "@tanstack/react-query";
import { loadTerritoryLabel } from "@v3/sales/lib/territories";

/** Small designator chip: "Territory: Insurance_Agency_SRE_1". Renders nothing when unassigned. */
export function TerritoryChip({ territoryId }: { territoryId: string | null | undefined }) {
  const t = useQuery({
    queryKey: ["territory-chip", territoryId],
    queryFn: () => loadTerritoryLabel(territoryId),
    enabled: !!territoryId,
  });
  if (!territoryId) return null;
  const label = t.data?.label;
  return (
    <span className="rounded-full bg-[color:var(--color-surface-3)] px-2.5 py-1 font-mono text-[11px] font-medium text-[color:var(--color-ink-2)]">
      Territory: {label ?? "…"}
    </span>
  );
}
