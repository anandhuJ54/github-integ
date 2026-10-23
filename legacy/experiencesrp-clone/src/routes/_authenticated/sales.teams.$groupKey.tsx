import { createFileRoute } from "@tanstack/react-router";
import { ScopeDashboard } from "@/components/sales/scope-dashboard";
export const Route = createFileRoute("/_authenticated/sales/teams/$groupKey")({
  head: ({ params }) => ({ meta: [
    { title: `${params.groupKey.replace(/_/g, " ")} team — Growth Hub` },
    { name: "description", content: "Team-scoped territory, claims, logo and roster dashboard." },
    { property: "og:title", content: `${params.groupKey.replace(/_/g, " ")} team — Growth Hub` },
    { property: "og:description", content: "Team-scoped territory, claims, logo and roster dashboard." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: TeamPage,
});
function TeamPage() { const { groupKey } = Route.useParams(); return <ScopeDashboard scope={{ kind: "team", teamId: groupKey, label: groupKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }} />; }
