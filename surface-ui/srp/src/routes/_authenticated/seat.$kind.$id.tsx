/**
 * Seat layout — the inner role-shells reached through View-As or "Log in as".
 *
 * /seat/office/$id        → LOCATION shell (one organizations row)
 * /seat/professional/$id  → PROFESSIONAL shell (one professionals row)
 *
 * The shell fully replaces the admin/enterprise chrome: only this seat's nav
 * and the "Viewing as … — Return to …" bar are rendered.
 */
import { createFileRoute, Outlet, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScopedShell } from "@v3/srp/components/seat/scoped-shell";
import { ROLE_FOR_KIND, useImpersonation } from "@v3/state/impersonation/impersonation";
import { loadLocationSeat, loadProfessionalSeat, seatProName } from "@v3/srp/utils/seat";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
  component: SeatLayout,
});

export function useSeatParams() {
  const { kind, id } = Route.useParams();
  return { isPro: kind === "professional", kind, id, base: `/seat/${kind}/${id}` };
}

export function useLocationSeat(id: string, enabled = true) {
  return useQuery({
    queryKey: ["seat-location", id],
    queryFn: () => loadLocationSeat(id),
    enabled: enabled && Boolean(id),
  });
}

export function useProfessionalSeat(id: string, enabled = true) {
  return useQuery({
    queryKey: ["seat-professional", id],
    queryFn: () => loadProfessionalSeat(id),
    enabled: enabled && Boolean(id),
  });
}

function SeatLayout() {
  const { kind, id } = Route.useParams();
  const { from } = useSearch({ from: "/_authenticated/seat/$kind/$id" });
  const isPro = kind === "professional";
  const { actingAs, enter } = useImpersonation();

  const locQ = useQuery({
    queryKey: ["seat-location", id],
    queryFn: () => loadLocationSeat(id),
    enabled: !isPro,
  });
  const proQ = useQuery({
    queryKey: ["seat-professional", id],
    queryFn: () => loadProfessionalSeat(id),
    enabled: isPro,
  });

  const name = isPro
    ? proQ.data
      ? seatProName(proQ.data.pro)
      : "Professional"
    : (locQ.data?.office.name ?? "Location");
  const photoUrl = isPro
    ? (proQ.data?.pro.photo_url ?? null)
    : (locQ.data?.office.logo_url ?? locQ.data?.brand?.logo_url ?? null);
  const subtitle = isPro
    ? [proQ.data?.office?.name, proQ.data?.pro.address_state].filter(Boolean).join(" · ") || null
    : [locQ.data?.office.address_city, locQ.data?.office.address_state].filter(Boolean).join(", ") ||
      null;

  const ready = isPro ? Boolean(proQ.data) : Boolean(locQ.data);

  // Direct-URL arrivals still register the seat on the impersonation stack.
  useEffect(() => {
    if (!ready) return;
    if (actingAs?.id === id) return;
    enter({
      kind: isPro ? "professional" : "office",
      id,
      name,
      role: ROLE_FOR_KIND[isPro ? "professional" : "office"],
      path: `/seat/${kind}/${id}`,
      orgSlug: from ?? null,
      photoUrl: isPro ? photoUrl : null,
      logoUrl: isPro ? null : photoUrl,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id]);

  return (
    <ScopedShell
      kind={isPro ? "professional" : "office"}
      name={name}
      subtitle={subtitle}
      photoUrl={photoUrl}
      base={`/seat/${kind}/${id}`}
    >
      <Outlet />
    </ScopedShell>
  );
}
