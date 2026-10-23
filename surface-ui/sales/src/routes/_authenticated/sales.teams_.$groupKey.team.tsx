import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/sales/teams_/$groupKey/team")({
  beforeLoad: ({ params }) => { throw redirect({ to: "/sales/teams/$groupKey", params: { groupKey: params.groupKey }, replace: true }); },
});
