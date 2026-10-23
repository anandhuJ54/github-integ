import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EmpLayout } from "@/components/emp-layout";
import { GraphHealthCard } from "@/components/control/graph-health-card";
import { ControlTreeTab } from "@/components/control/control-tree-tab";
import { EntitiesTab } from "@/components/control/entities-tab";
import { ClaimsTab } from "@/components/control/claims-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
          <TabsList>
            <TabsTrigger value="tree">Control Tree</TabsTrigger>
            <TabsTrigger value="entities">Entities</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
          </TabsList>
          <TabsContent value="tree" className="mt-4">
            <ControlTreeTab />
          </TabsContent>
          <TabsContent value="entities" className="mt-4">
            <EntitiesTab />
          </TabsContent>
          <TabsContent value="claims" className="mt-4">
            <ClaimsTab />
          </TabsContent>
        </Tabs>
      </div>
    </EmpLayout>
  );
}
