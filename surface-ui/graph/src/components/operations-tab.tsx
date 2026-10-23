import { useEffect, useState } from "react";
import { CheckCircle2, MinusCircle, Circle } from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";

/** Operations tab — the category's operational layer at a glance.
 *  Groups the universal + class-scoped operational families and shows which
 *  registry nodes satisfy each, live from exp_vertical_node_registry.
 *  (Scott 2026-07-10: operational data is first-class — features, dashboards,
 *  campaigns per category depend on it.) */

const GROUPS: { title: string; fams: { key: string; label: string; pattern: RegExp; scoped?: string }[] }[] = [
  {
    title: "Payments & Financial",
    fams: [
      { key: "payment", label: "Payment methods accepted", pattern: /payment method|payment type|payment accepted|paymentaccepted/i },
      { key: "financing", label: "Financing / payment plans", pattern: /financing|payment plan|installment|layaway/i, scoped: "trades · retail" },
      { key: "insurance", label: "Insurance networks accepted", pattern: /insurance (accepted|billing|network|plan)|in-network/i, scoped: "medical" },
      { key: "estimates", label: "Free estimates / consultations", pattern: /free estimate|free consultation|free quote/i, scoped: "trades" },
      { key: "price", label: "Price range", pattern: /price range|price tier|price point/i },
    ],
  },
  {
    title: "Access & Amenities",
    fams: [
      { key: "accessibility", label: "Accessibility features", pattern: /accessib|wheelchair|ada\b/i },
      { key: "parking", label: "Parking", pattern: /parking/i },
      { key: "wifi", label: "Guest WiFi", pattern: /wi-?fi/i, scoped: "venues" },
      { key: "kid", label: "Kid & family friendly", pattern: /kid|family friendly|children/i, scoped: "venues" },
      { key: "pet", label: "Pet friendly", pattern: /pet friendly|pets allowed|pet-friendly/i, scoped: "venues" },
      { key: "smokefree", label: "Smoke-free facility", pattern: /smoke-?free|non-?smoking/i, scoped: "venues" },
    ],
  },
  {
    title: "Contact & Identity",
    fams: [
      { key: "email", label: "Business email", pattern: /\bemail\b/i },
      { key: "phone2", label: "Fax / toll-free / SMS", pattern: /\bfax\b|toll-?free|sms|text (line|us)/i },
      { key: "languages", label: "Languages spoken", pattern: /language|bilingual|multilingual/i },
      { key: "founded", label: "Year established", pattern: /year established|founded|founding|in business since/i },
      { key: "legal", label: "Legal name vs DBA", pattern: /legal name|legal entity|\bdba\b/i },
      { key: "badges", label: "Ownership identity badges", pattern: /women-owned|veteran-owned|minority-owned|family-owned|lgbtq|ownership identity/i },
    ],
  },
  {
    title: "Service Logistics",
    fams: [
      { key: "hours", label: "Operating hours", pattern: /operating hours|business hours|hours of operation/i },
      { key: "appt", label: "Appointment / walk-in policy", pattern: /appointment|walk-?in|booking required/i },
      { key: "delivery", label: "Delivery / pickup / curbside", pattern: /delivery|pickup|curbside/i },
      { key: "emergency", label: "Emergency / 24-7 availability", pattern: /24.hour|24\/7|emergency service|after-?hours/i, scoped: "trades" },
      { key: "capacity", label: "Capacity / private rooms", pattern: /capacity|private (room|dining|event)|banquet/i, scoped: "venues" },
    ],
  },
  {
    title: "Trust & Policies",
    fams: [
      { key: "lbi", label: "Licensed, bonded & insured", pattern: /bonded|insured\b|licensed, bonded/i, scoped: "trades" },
      { key: "warranty", label: "Warranty / return policy", pattern: /warranty|guarantee|return policy/i, scoped: "retail" },
      { key: "safety", label: "Health & safety", pattern: /health (and|&) safety|sanitiz/i },
    ],
  },
];

export function OperationsTab({ gcid }: { gcid: string }) {
  const [nodes, setNodes] = useState<{ node_name: string; ring: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    supabase.from("exp_vertical_node_registry").select("node_name,ring").eq("gcid", gcid).limit(1000)
      .then(({ data }) => { if (live) setNodes(data ?? []); });
    return () => { live = false; };
  }, [gcid]);

  if (nodes === null) return <div className="text-sm text-slate-400 py-8">Loading operational profile…</div>;

  const covered = (p: RegExp) => nodes.filter(n => p.test(n.node_name));

  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-500">
        The operational layer for <span className="font-mono text-slate-700">{gcid}</span> — the universal and
        class-scoped facts that power features, dashboards, campaigns, and every listings publisher. Live from the
        node registry.
      </div>
      {GROUPS.map(g => (
        <div key={g.title} className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-semibold tracking-wide text-slate-400 uppercase">{g.title}</div>
          <div className="mt-3 grid gap-2">
            {g.fams.map(f => {
              const hits = covered(f.pattern);
              return (
                <div key={f.key} className="flex items-start gap-3">
                  {hits.length > 0
                    ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />
                    : f.scoped
                      ? <MinusCircle className="w-4 h-4 mt-0.5 text-slate-300 shrink-0" />
                      : <Circle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />}
                  <div className="min-w-0">
                    <span className="text-sm text-slate-800">{f.label}</span>
                    {f.scoped && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-300">{f.scoped}</span>}
                    {hits.length > 0 && (
                      <div className="text-[12px] text-slate-400 truncate">
                        {hits.slice(0, 3).map(h => h.node_name).join(" · ")}{hits.length > 3 ? ` · +${hits.length - 3} more` : ""}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="text-[12px] text-slate-400">
        Green = present in this category's registry. Amber = expected but absent (enrichment candidate). Gray = class-scoped
        pack that may not apply to this category.
      </div>
    </div>
  );
}
