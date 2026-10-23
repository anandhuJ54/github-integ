import { createFileRoute } from "@tanstack/react-router";
import { WeeklyPage } from "./dev.weekly";

export const Route = createFileRoute("/_authenticated/build/weekly")({
  head: () => ({
    meta: [
      { title: "Weekly reporting — Build" },
      { name: "description", content: "Weekly team updates, tracker and digest." },
      { property: "og:title", content: "Weekly reporting — Build" },
      { property: "og:description", content: "Weekly team updates, tracker and digest." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WeeklyPage,
});
