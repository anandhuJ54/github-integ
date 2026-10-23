import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_authenticated/sales/sellers/$repId")({ beforeLoad: ({ params }) => { throw redirect({ to: "/sales/worklist", search: { rep: params.repId, view: "seller" }, replace: true }); } });
