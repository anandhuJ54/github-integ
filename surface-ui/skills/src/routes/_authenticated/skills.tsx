import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BuildMapTab, CapabilitiesTab, EvalsTab, SkillsTab } from "@v3/skills/components/nora/registry-tabs";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import { PageBody, PageHeader } from "@v3/ui/components/console/primitives";
import { SandboxTab } from "@v3/skills/components/sandbox-tab";
import { SkillRunsPanel } from "@v3/skills/components/nora/skill-runs";

import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/skills")({
  head: () => ({
    meta: [
      { title: "Skills — Experience.com Console" },
      {
        name: "description",
        content:
          "The NORA skill registry: skills, the capabilities they call, the build map, the sandbox, skill runs and evals.",
      },
      { property: "og:title", content: "Skills — Experience.com Console" },
      {
        property: "og:description",
        content: "Skill registry, sandbox, skill runs and evals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SkillsPage,
});

const TABS = [
  { k: "skills", label: "Skills" },
  { k: "capabilities", label: "Capabilities" },
  { k: "build", label: "Build map" },
  { k: "sandbox", label: "Sandbox" },
  { k: "runs", label: "Runs" },
  { k: "evals", label: "Evals" },
] as const;
type TabKey = (typeof TABS)[number]["k"];
const TAB_KEY = "xp.nora-os.tab"; // kept, so the tab people last used survives the move

function SkillsPage() {
  const [tab, setTab] = useState<TabKey>("skills");
  useEffect(() => {
    const t = window.localStorage.getItem(TAB_KEY);
    if (TABS.some((x) => x.k === t)) setTab(t as TabKey);
  }, []);
  const pick = (t: TabKey) => {
    setTab(t);
    window.localStorage.setItem(TAB_KEY, t);
  };
  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="NORA OS"
          title="Skills"
          description="The skill registry — skills, the capabilities they call, the build map, the sandbox, skill runs and evals. NORA OS runs them."
        />
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-[color:var(--color-hairline)]">
          {TABS.map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => pick(t.k)}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                tab === t.k
                  ? "border-[color:var(--color-g-blue)] text-[color:var(--color-g-blue)]"
                  : "border-transparent text-[color:var(--color-ink-2)] hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "skills" ? <SkillsTab /> : tab === "capabilities" ? <CapabilitiesTab /> : tab === "build" ? <BuildMapTab /> : tab === "sandbox" ? <SandboxTab /> : tab === "evals" ? <EvalsTab /> : <SkillRunsPanel />}
      </PageBody>
    </EmpLayout>
  );
}
