import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/ui/lib/server-fn";

// Admin's own copy of the sales territory chip (surface audit §11 row 5, 2026-10-25), for /professionals.
// Reads the label through the sales API's published contract (GET /sales/territories/slots/{id}/label);
// the sales chip is surface-ui/sales/src/components/sales/territory-chip.tsx.

type TerritoryLabel = { id: string; label: string; tier: string; seller_id: string | null };

async function loadTerritoryLabel(territoryId: string | null | undefined): Promise<TerritoryLabel | null> {
  if (!territoryId) return null;
  // A failed read (or 2+ rows) is null, as in the sales lib.
  const data = await api
    .get<unknown>(`/sales/territories/slots/${encodeURIComponent(territoryId)}/label`)
    .catch(() => null);
  return (data ?? null) as TerritoryLabel | null;
}

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
