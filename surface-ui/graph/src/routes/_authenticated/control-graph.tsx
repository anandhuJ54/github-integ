import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EmpLayout } from "@v3/shared/components/ui/emp-layout";
import { GraphHealthCard } from "@v3/graph/components/control/graph-health-card";
import { ControlTreeTab } from "@v3/graph/components/control/control-tree-tab";
import { EntitiesTab } from "@v3/graph/components/control/entities-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@v3/shared/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/control-graph")({
  head: () => ({
    meta: [
      { title: "Control Graph · Experience.com Admin Console" },
      {
        name: "description",
        content:
          "Manage the control hierarchy and inspect resolved graph entities and their relationships.",
      },
      { property: "og:title", content: "Control Graph · Experience.com Admin Console" },
      {
        property: "og:description",
        content:
          "Manage the control hierarchy and inspect resolved graph entities and their relationships.",
      },
    ],
  }),
  component: ControlGraphPage,
});

function ControlGraphPage() {
  const [tab, setTab] = useState("tree");

  return (
    <EmpLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Control Graph</h1>
          <p className="mt-1 text-sm text-slate-500">
            The control hierarchy and the resolved entity graph behind it.
          </p>
        </header>

        <GraphHealthCard />

        <Tabs value={tab} onValueChange={setTab}>
          {/* The Claims tab moved to admin's /claims ("Control graph claims"), surface audit 2026-10-25. */}
          <TabsList>
            <TabsTrigger value="tree">Control Tree</TabsTrigger>
            <TabsTrigger value="entities">Entities</TabsTrigger>
          </TabsList>
          <TabsContent value="tree" className="mt-4">
            <ControlTreeTab />
          </TabsContent>
          <TabsContent value="entities" className="mt-4">
            <EntitiesTab />
          </TabsContent>
        </Tabs>
      </div>
    </EmpLayout>
  );
}
