import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DevBoard } from "./dev.board";
import { PriorityBoard } from "./dev.priorities";
import { cn } from "@v3/shared/components/utils/utils";

export const Route = createFileRoute("/_authenticated/build/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Build" },
      { name: "description", content: "Launch board and priority board for every team project." },
      { property: "og:title", content: "Projects — Build" },
      { property: "og:description", content: "Launch board and priority board for every team project." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const [view, setView] = useState<"launch" | "priority">("launch");
  return (
    <div>
      <div className="mx-auto flex w-full max-w-[1400px] gap-2 px-8 pt-6">
        {(["launch", "priority"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-[13px] font-medium",
              view === v ? "bg-[color:var(--color-g-blue)] text-primary-foreground" : "bg-card text-[color:var(--color-ink-2)] hover:text-ink",
            )}
          >
            {v === "launch" ? "Launch board" : "Priority board"}
          </button>
        ))}
      </div>
      {view === "launch" ? <DevBoard /> : <PriorityBoard />}
    </div>
  );
}
