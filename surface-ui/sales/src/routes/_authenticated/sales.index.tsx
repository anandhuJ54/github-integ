import { createFileRoute } from "@tanstack/react-router";
import { ScopeDashboard } from "@v3/sales/components/sales/scope-dashboard";
export const Route = createFileRoute("/_authenticated/sales/")({
  head: () => ({ meta: [
    { title: "Company overview — Growth Hub" },
    { name: "description", content: "Company-wide locations, claims, upgrades, revenue, categories, logos and teams." },
    { property: "og:title", content: "Company overview — Growth Hub" },
    { property: "og:description", content: "Company-wide locations, claims, upgrades, revenue, categories, logos and teams." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <ScopeDashboard scope={{ kind: "all" }} />,
});
