import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadTeamDetail } from "@v3/sales/lib/teams";
export const Route = createFileRoute("/_authenticated/sales/team/$territoryId")({
  beforeLoad: async ({ params }) => {
    const team = await loadTeamDetail(params.territoryId);
    throw redirect({ to: "/sales/teams/$groupKey", params: { groupKey: team?.team.group_key ?? "unknown" }, replace: true });
  },
});
