import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { WorklistDashboard } from "@v3/sales/components/sales/worklist-dashboard";

const searchSchema = z.object({ rep: z.string().optional(), view: z.enum(["sre", "seller"]).optional() });
export const Route = createFileRoute("/_authenticated/sales/worklist")({
  validateSearch: searchSchema,
  head: () => ({ meta: [
    { title: "Worklist — Growth Hub" },
    { name: "description", content: "Role-aware SRE and seller worklist for claims, upgrades, logos and commercial focus." },
    { property: "og:title", content: "Worklist — Growth Hub" },
    { property: "og:description", content: "Role-aware SRE and seller worklist for claims, upgrades, logos and commercial focus." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: WorklistRoute,
});
function WorklistRoute() { const search = Route.useSearch(); const navigate = useNavigate(); return <WorklistDashboard initialRep={search.rep} initialView={search.view} onStateChange={(rep, view) => void navigate({ to: "/sales/worklist", search: { rep, view }, replace: true })}/>; }
