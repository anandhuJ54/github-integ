import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EmpLayout } from "@/components/emp-layout";
import { SourceRegistryTab } from "@/components/discovery/source-registry-tab";
import { PipelineTab } from "@/components/discovery/pipeline-tab";
import { RunsTab } from "@/components/discovery/runs-tab";
import { HierarchyTab } from "@/components/discovery/hierarchy-tab";
import { FieldYieldTab } from "@/components/discovery/field-yield-tab";
import { CategoryPopulationTab } from "@/components/discovery/category-population-tab";
import { SchedulesTab } from "@/components/discovery/schedules-tab";
import { SourceStatsTab } from "@/components/discovery/source-stats-tab";
import { AiCostTab } from "@/components/discovery/ai-cost-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/discovery")({
  head: () => ({
    meta: [
      { title: "Discovery · Experience.com Admin Console" },
      {
        name: "description",
        content:
          "Source registry, harvest pipeline, and ETL run history behind category discovery.",
      },
      { property: "og:title", content: "Discovery · Experience.com Admin Console" },
      {
        property: "og:description",
        content:
          "Source registry, harvest pipeline, and ETL run history behind category discovery.",
      },
    ],
  }),
  component: DiscoveryPage,
});

function DiscoveryPage() {
  const [tab, setTab] = useState("sources");

  return (
    <EmpLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Discovery</h1>
          <p className="mt-1 text-sm text-slate-500">
            Governed source registry, the harvest pipeline, and run history. Admins can pause, activate, and rate-limit sources.
          </p>
        </header>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="sources">Source Registry</TabsTrigger>
            <TabsTrigger value="population">Category Population</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="yield">Field Yield</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
            <TabsTrigger value="stats">Source Stats</TabsTrigger>
            <TabsTrigger value="ai_cost">AI Cost</TabsTrigger>
          </TabsList>
          <TabsContent value="sources" className="mt-4">
            <SourceRegistryTab />
          </TabsContent>
          <TabsContent value="population" className="mt-4">
            <CategoryPopulationTab />
          </TabsContent>
          <TabsContent value="pipeline" className="mt-4">
            <PipelineTab />
          </TabsContent>
          <TabsContent value="yield" className="mt-4">
            <FieldYieldTab />
          </TabsContent>
          <TabsContent value="runs" className="mt-4">
            <RunsTab />
          </TabsContent>
          <TabsContent value="hierarchy" className="mt-4">
            <HierarchyTab />
          </TabsContent>
          <TabsContent value="schedules" className="mt-4">
            <SchedulesTab />
          </TabsContent>
          <TabsContent value="stats" className="mt-4">
            <SourceStatsTab />
          </TabsContent>
          <TabsContent value="ai_cost" className="mt-4">
            <AiCostTab />
          </TabsContent>
        </Tabs>
      </div>
    </EmpLayout>
  );
}
