import { createFileRoute } from "@tanstack/react-router";
import DevOverview from "./dev.index";

export const Route = createFileRoute("/_authenticated/build/")({
  head: () => ({
    meta: [
      { title: "Build — Experience.com Console" },
      { name: "description", content: "Launch readiness, team pace and the knowledge wiki in one place." },
      { property: "og:title", content: "Build — Experience.com Console" },
      { property: "og:description", content: "Launch readiness, team pace and the knowledge wiki." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DevOverview,
});
