// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY INTELLIGENCE — the logic layer that makes the Knowledge Model the
// SOURCE OF TRUTH for every downstream output.
//
// The core idea: a conversion trigger is ONE concept that shows up on THREE
// surfaces — a schema.org potentialAction (the contract), a CTA button (the
// profile), and a goal (the conversion agent). By modeling it as a typed object
// here, Schema / Profile / SEO / AI Config all bind to the same keys instead of
// being generated independently. Everything is lane-aware: what matters to the
// PRO (the person) is different from what matters to the LOCATION (the place).
//
// Curated for the two reference verticals; the full pass will project each
// category's Knowledge Model into this shape.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@v3/shared/components/ui/card";
import { cn } from "@v3/shared/components/utils/utils";

export type Lane = "professional" | "location";

export type ConversionAction = {
  key: string;
  label: string; // the human trigger
  schemaAction: string; // schema.org potentialAction @type
  profileButton: string; // the CTA rendered on the profile
  agentGoal: string; // what the conversion agent drives toward
  lanes: Lane[];
};

export type CategoryIntelligence = {
  gcid: string;
  displayName: string;
  lanes: { key: Lane; label: string }[];
  valueProps: { lane: Lane; text: string }[];
  searchIntents: { lane: Lane; query: string }[];
  conversionActions: ConversionAction[];
};

const bare = (g: string) => g.replace(/^gcid:/, "");

const REGISTRY: Record<string, CategoryIntelligence> = {
  real_estate_agents: {
    gcid: "gcid:real_estate_agents",
    displayName: "Real estate agent",
    lanes: [
      { key: "professional", label: "Agent (PRO)" },
      { key: "location", label: "Office / brokerage" },
    ],
    valueProps: [
      { lane: "professional", text: "Represent sellers in listing and selling their home" },
      { lane: "professional", text: "Represent buyers through search, offer, and purchase" },
      { lane: "professional", text: "Price homes accurately with a comparative market analysis" },
      { lane: "professional", text: "Negotiate offers, contingencies, and contracts" },
      { lane: "professional", text: "Guide clients from offer through closing" },
      { lane: "location", text: "Match clients with the right agent on the team" },
      { lane: "location", text: "Local-market coverage across the whole brokerage" },
      { lane: "location", text: "Brokerage-backed transactions and compliance" },
    ],
    searchIntents: [
      { lane: "professional", query: "realtor near me" },
      { lane: "professional", query: "sell my house fast" },
      { lane: "professional", query: "buyer's agent {neighborhood}" },
      { lane: "professional", query: "how much is my home worth" },
      { lane: "professional", query: "best listing agent {city}" },
      { lane: "location", query: "real estate agency {city}" },
      { lane: "location", query: "real estate brokerage near me" },
      { lane: "location", query: "homes for sale {city}" },
    ],
    conversionActions: [
      { key: "schedule_showing", label: "Schedule a showing", schemaAction: "ScheduleAction", profileButton: "Schedule a showing", agentGoal: "Book a property tour with a qualified buyer", lanes: ["professional"] },
      { key: "request_valuation", label: "Request a home valuation", schemaAction: "ScheduleAction", profileButton: "What's my home worth?", agentGoal: "Capture seller leads and book a valuation", lanes: ["professional"] },
      { key: "book_listing_appt", label: "Book a listing appointment", schemaAction: "ScheduleAction", profileButton: "Book a listing consult", agentGoal: "Convert a seller into a signed listing", lanes: ["professional"] },
      { key: "attend_open_house", label: "Attend an open house", schemaAction: "ReserveAction", profileButton: "RSVP to open house", agentGoal: "Drive buyers to a live event", lanes: ["professional"] },
      { key: "contact_agent", label: "Contact the agent", schemaAction: "ContactAction", profileButton: "Contact agent", agentGoal: "Open a direct conversation with the lead", lanes: ["professional"] },
      { key: "find_agent", label: "Find an agent", schemaAction: "ContactAction", profileButton: "Find an agent", agentGoal: "Route the lead to the right agent on the team", lanes: ["location"] },
      { key: "browse_listings", label: "Browse listings", schemaAction: "ViewAction", profileButton: "View listings", agentGoal: "Keep visitors engaged with live inventory", lanes: ["location"] },
      { key: "contact_office", label: "Contact the office", schemaAction: "ContactAction", profileButton: "Contact office", agentGoal: "Capture general inquiries for triage", lanes: ["location"] },
    ],
  },

  restaurant: {
    gcid: "gcid:restaurant",
    displayName: "Restaurant",
    lanes: [{ key: "location", label: "Restaurant (location)" }],
    valueProps: [
      { lane: "location", text: "Dine-in experience and signature cuisine" },
      { lane: "location", text: "Takeout, delivery, and online ordering" },
      { lane: "location", text: "Private events and catering" },
    ],
    searchIntents: [
      { lane: "location", query: "restaurants near me" },
      { lane: "location", query: "{cuisine} restaurant {city}" },
      { lane: "location", query: "book a table {city}" },
      { lane: "location", query: "best {cuisine} near me" },
      { lane: "location", query: "restaurants open now" },
    ],
    conversionActions: [
      { key: "reserve_table", label: "Reserve a table", schemaAction: "ReserveAction", profileButton: "Reserve a table", agentGoal: "Fill covers via reservations (OpenTable / Resy)", lanes: ["location"] },
      { key: "order_online", label: "Order online", schemaAction: "OrderAction", profileButton: "Order online", agentGoal: "Capture takeout orders directly", lanes: ["location"] },
      { key: "order_delivery", label: "Order delivery", schemaAction: "OrderAction", profileButton: "Order delivery", agentGoal: "Capture delivery orders", lanes: ["location"] },
      { key: "join_waitlist", label: "Join the waitlist", schemaAction: "ReserveAction", profileButton: "Join waitlist", agentGoal: "Convert walk-in demand at peak times", lanes: ["location"] },
      { key: "view_menu", label: "View the menu", schemaAction: "ViewAction", profileButton: "View menu", agentGoal: "Move browsers toward a reservation", lanes: ["location"] },
    ],
  },
};

export function getCategoryIntelligence(gcid: string): CategoryIntelligence | null {
  return REGISTRY[bare(gcid)] ?? null;
}

// Build intelligence from the live DB Knowledge Model row (snake_case shape).
// This is the source of truth; the code REGISTRY is fallback for un-seeded rows.
const laneLabel = (l: Lane) => (l === "professional" ? "Professional (PRO)" : "Location");

export function fromKnowledgeRow(gcid: string, row: any): CategoryIntelligence | null {
  if (!row) return null;
  const ca = Array.isArray(row.conversion_actions) ? row.conversion_actions : [];
  const vp = Array.isArray(row.value_props) ? row.value_props : [];
  const si = Array.isArray(row.search_intents) ? row.search_intents : [];
  if (!ca.length && !vp.length && !si.length) return null; // no logic layer → fallback

  const conversionActions: ConversionAction[] = ca.map((a: any) => ({
    key: a.key ?? a.label,
    label: a.label,
    schemaAction: a.schema_action ?? a.schemaAction,
    profileButton: a.profile_button ?? a.profileButton,
    agentGoal: a.agent_goal ?? a.agentGoal,
    lanes: Array.isArray(a.lanes) ? a.lanes : a.lane ? [a.lane] : [],
  }));
  const valueProps = vp.map((v: any) => ({ lane: v.lane as Lane, text: v.text }));
  const searchIntents = si.map((s: any) => ({ lane: s.lane as Lane, query: s.query }));

  const present = new Set<Lane>();
  conversionActions.forEach((a) => a.lanes.forEach((l) => present.add(l)));
  valueProps.forEach((v: { lane: Lane; text: string }) => v.lane && present.add(v.lane));
  searchIntents.forEach((s: { lane: Lane; query: string }) => s.lane && present.add(s.lane));
  const lanes = (["professional", "location"] as Lane[])
    .filter((l) => present.has(l))
    .map((l) => ({ key: l, label: laneLabel(l) }));

  return { gcid, displayName: gcid, lanes, valueProps, searchIntents, conversionActions };
}

// ─── DISPLAY PANEL ───────────────────────────────────────────────────────────

const SURFACE_HINT =
  "One trigger, three surfaces — the same key drives the schema.org action, the profile button, and the conversion agent's goal.";

export function CategoryIntelligencePanel({
  gcid,
  knowledge,
}: {
  gcid: string;
  knowledge?: any;
}) {
  const dbIntel = fromKnowledgeRow(gcid, knowledge);
  const intel = dbIntel ?? getCategoryIntelligence(gcid);
  const source = dbIntel ? "database" : "curated fallback";
  const [lane, setLane] = useState<Lane>(intel?.lanes[0]?.key ?? "location");
  if (!intel) return null;

  const props = intel.valueProps.filter((v) => v.lane === lane);
  const intents = intel.searchIntents.filter((s) => s.lane === lane);
  const actions = intel.conversionActions.filter((a) => a.lanes.includes(lane));

  return (
    <Card className="border-emerald-200 bg-emerald-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm">Conversion &amp; intent — the logic layer</CardTitle>
            <p className="text-[12px] text-slate-500 mt-1 max-w-xl leading-relaxed">
              This is the source of truth Schema, Profile, SEO, and AI Config are
              projected from. It is lane-aware: what matters to the PRO differs from
              what matters to the location.
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-1 mt-2 text-[11px] px-2 py-0.5 rounded-full",
                source === "database"
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-100 text-amber-800",
              )}
            >
              source: {source}
            </span>
          </div>
          {intel.lanes.length > 1 && (
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white text-[13px] shrink-0">
              {intel.lanes.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setLane(l.key)}
                  className={cn(
                    "px-3 py-1.5",
                    l.key === lane ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Value props */}
        <div>
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Value props — jobs to be done
          </div>
          <div className="flex flex-wrap gap-1.5">
            {props.map((p, i) => (
              <span key={i} className="text-[12px] px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700">
                {p.text}
              </span>
            ))}
          </div>
        </div>

        {/* Search intents */}
        <div>
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Search intents — what people type
          </div>
          <div className="flex flex-wrap gap-1.5">
            {intents.map((s, i) => (
              <span key={i} className="text-[12px] px-2.5 py-1 rounded-md bg-slate-900/5 text-slate-600 font-mono">
                {s.query}
              </span>
            ))}
          </div>
        </div>

        {/* Conversion triggers — one concept, three surfaces */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
              Conversion triggers
            </div>
            <div className="text-[11px] text-slate-400">{SURFACE_HINT}</div>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2 px-3 font-medium">Trigger</th>
                  <th className="py-2 px-3 font-medium">schema.org action</th>
                  <th className="py-2 px-3 font-medium">Profile button</th>
                  <th className="py-2 px-3 font-medium">Agent goal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {actions.map((a) => (
                  <tr key={a.key}>
                    <td className="py-2 px-3 font-medium text-slate-800">{a.label}</td>
                    <td className="py-2 px-3">
                      <code className="text-[11px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">{a.schemaAction}</code>
                    </td>
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center rounded-md bg-emerald-600 text-white text-[11px] px-2 py-0.5">{a.profileButton}</span>
                    </td>
                    <td className="py-2 px-3 text-slate-600">{a.agentGoal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
