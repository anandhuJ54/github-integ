import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { ExpectedVolumeKeys, type LaneVolumeKey } from "@/components/scoring/expected-volume-keys";


/** Scoring tab — the 10-lane 850-point Search Rank Score model.
 *  Reads per-category targets from the committed lane tables (EAR / EAA / completeness).
 *  Rebuilt 2026-07-12 to replace the stale 6-bucket weight editor. */

type LaneStatus = "built" | "unbuilt" | "deferred";
interface Lane { key: string; name: string; points: number; status: LaneStatus; method: string; components: string; provenance?: string; note?: string; }

const LANES: Lane[] = [
  { key: "reviews", name: "Reviews", points: 187, status: "built",
    method: "187 x (Current + Standing + Response). Current = 140 x min(1, RVE / (0.54 x EAR)); RVE = reviews12mo x (rating/5) x (1 - age/12.5). Standing = 37 x min(1, log10(lifetime)/3.3) x (avg/5). Response = 10 x reply_rate.",
    components: "Volume vs category EAR, star quality, 12.5-mo decay, lifetime standing, reply rate",
    provenance: "ruled: ladder, decay, splits. prior: 25% conversion, clamps, 0.54" },
  { key: "completeness", name: "Completeness", points: 182, status: "built",
    method: "182 x min(1, node_count / M) x (core_present / core_expected). Volume cannot exceed the core-coverage ceiling; the same node_count drives the uncapped Graph Count. Credentials are folded in here (2026-08-16, +29 from the retired Credentials lane): a category-required credential counts toward core_present only if present AND valid AND unexpired AND verified-where-required.",
    components: "Total node count vs category M, core-node coverage gate (identity+authority+required), validity-aware credential core gate - expired or unverified required credentials do not satisfy the gate",
    provenance: "ruled: multiplicative core-gate, credential validity gate. prior: M volume priors" },

  { key: "website", name: "Website + Schema", points: 102, status: "built",
    method: "Website + Schema = Σ over elements ( P_R·R_e + P_C·C_e + P_S·S_e ), where per element: Richness R_e = (present expected sub-elements)/(expected sub-elements for THIS category); Consistency C_e = (matching fields)/(fields present AND held in our graph), mismatch scores partial; Schema S_e = json-ld present · correct @type · (0.5 + 0.5·field coverage). Denominators are the CATEGORY's expected + held fields (from exp_category_schema / the node registry), so each entity is scored only against its own category's bar — a loan officer's plain-text product list is full richness; a restaurant's menu is judged on menu-item fields. Elements not applicable to a category drop and their points renormalize so every category still totals 102. Crawler-gated: no confirmed website → lane = 0. One-home: this scores the SITE's fidelity to the graph, never the underlying asset (review volume stays in the Reviews lane). Load time and mobile responsiveness are measured and advised, never scored.",
    components: "Ten decomposed elements, each scored for Richness (are the category-expected sub-elements present), Consistency (do they match our verified graph — the largest block at 43 pts, because only we hold the graph to compare against), and Schema (valid JSON-LD of the correct type). Every missing/mismatched/unmarked sub-element becomes a typed gap with marginal points ∂score, ranked by points-per-effort for Nora's living checklist. Hero actions fall out of the math: embedding our reviews widget closes Reviews R+C+S in one move (~+16); embedding our schema markup lifts Structured Data plus every element's S (~+12) — so Nora's top advice is provably the highest-value move, not hand-picked.",
    provenance: "ruled: decomposed element×check model, category-relative denominators, consistency-weighted (43), elements-not-outcomes, one-home; load/mobile measured-not-scored; hero = embed widget/markup" },
  { key: "articles", name: "Articles", points: 103, status: "built",
    method: "103 x min(1, AVE / EAA). AVE = sum of max(0, 1 - age/18). EAA = clamp(txns/12, 18, 40). Engagement (views/likes/shares) and quality DELIBERATELY excluded -> Signals. Reweighted 2026-08-17: +18 from the retired Posts lane.",
    components: "Article volume vs category EAA, 18-mo linear decay, no engagement, no quality",
    provenance: "ruled: form, cap, decay, clamp. prior: /12 cadence, 18/40" },
  { key: "gbp", name: "Google Business Profile", points: 68, status: "built",
    method: "68 x (verified_gmb ? 1 : 0). Binary and universal - no per-category target. Verified = OAuth-connected GMB AND Google-verified ownership of the Place ID. Connected-but-unverified = 0. Stateful: if the connection or verification lapses, the 68 revert to 0.",
    components: "Binary - full points for a verified, owned/managed GMB (Place ID confirmed). Profile data, reviews, and Q&A route to their own lanes.",
    provenance: "ruled: binary all-or-nothing, universal weighting, no double-counting of GMB profile content" },

  { key: "directories", name: "Directories", points: 90, status: "built",
    method: "90 x min(1, C / T). C = sum over authoritative directory listings of (consistency_weight x authority_weight). consistency_weight: NAP-consistent with our canonical record = 1.0, inconsistent (any name/address/phone mismatch) = 0.2, error or not live = 0. authority_weight is rank-based with diminishing returns after ~5, so tier-1 citations (Bing, Apple Maps, Yelp, Facebook, major data aggregators, category-key directories) carry most of the weight. T = the tier-1 authoritative set (~5-8 consistent listings). Google is excluded - it is scored in the GBP lane. Source of truth is the Listings Management API response (published sites + live/consistency status), never search or SERP crawling. NAP-integrity check: every published listing is compared field-by-field to our canonical NAP; mismatches and missing fields lower the consistency weight and surface as fixable issues.",
    components: "From the listings API (not search): authoritative-listing coverage x NAP consistency (consistent x1.0 / inconsistent x0.2), diminishing after ~5; plus NAP-integrity issue detection.",
    provenance: "ruled: listings-API source of truth, consistency multipliers, Google exclusion, 90pts. prior: T = 5-8 tier-1 listings, authority rank curve" },

  { key: "qa", name: "Q&A", points: 34, status: "built",
    method: "34 x min(1, answered / target). NO decay - an answer stays useful forever. Target = a lifetime count of on-taxonomy, owned/seeded answers for the category.",
    components: "Answered-question count (lifetime), owned/seeded, on-taxonomy, no decay, no engagement",
    provenance: "ruled: no decay, lifetime count, cap. prior: EAQ clamp band 10-25" },
  { key: "social", name: "Connections", points: 51, status: "unbuilt",
    method: "51 x completeness_gate x [Bucket 1 + Bucket 2]. Bucket 1 (39 pts) = 39 x Σ over core channels (weight x channel_score). Core channels: Facebook 0.30, Instagram 0.25, LinkedIn 0.25, X 0.20 (sum 1.00). channel_score = 0 unless OAuth-connected to Experience.com; 0.6 connected + 0.2 complete profile (bio + link + photo present) + 0.2 post within 90 days. Bucket 2 (12 pts max) = min(12, 3 x Σ link_channel_score) where link_channel_score = 0.5 link present & reachable + 0.5 elements extracted and graphed with no unresolved consistency errors. Link channels vary by category (e.g. YouTube, Yelp, Zillow, Realtor, Lending Tree).",
    components: "Bucket 1 rewards OAuth-connected owned social channels (Facebook / Instagram / LinkedIn / X) so the platform can manage and post them; measures presence + recency only, never followers / reach / engagement (those are Signals). Bucket 2 credits read-only link connections we cannot write to; each link channel is worth up to 3 pts capped at 12, gated by completeness. Extracted payload (reviews, videos, listings) scores in its own lanes — never re-scored here.",
    provenance: "ruled: OAuth-only credit for core channels, four-channel scope, presence+recency only, completeness gate. prior: flat channel weights 0.30/0.25/0.25/0.20, 0.6/0.2/0.2 split, 90-day recency window; link bucket 3 pts/channel cap 12" },
  { key: "videos", name: "Videos", points: 27, status: "built",
    method: "27 x min(1, VVE / target). VVE = 24-month linear-decay video volume; each item's weight = max(0, 1 - age_months/24). VIDEO ONLY - podcasts and audio moved to the Audio lane (2026-08-17). At steady state VVE ~ videos_per_year, so the internal target is the annual Expected Volume. Reweighted 2026-08-17: +10 from the retired Posts lane.",
    components: "Video volume vs category EAV, 24-month linear decay, on-taxonomy, no engagement, no podcasts (Audio lane)",
    provenance: "ruled: form, cap, 24-mo decay, video-only scope. prior: EAV clamp band 6-15" },
  { key: "audio", name: "Audio", points: 6, status: "built",
    method: "6 x min(1, AudioVE / target). Media clone of Videos: AudioVE = 24-month linear-decay audio volume; each item's weight = max(0, 1 - age_months/24). Podcasts and audio episodes score here. At steady state AudioVE ~ audio_pieces_per_year, so the internal target is the annual Expected Volume.",
    components: "Podcast + audio volume vs Expected Volume, 24-month linear decay, on-taxonomy, no engagement",
    provenance: "ruled: form, cap, 24-mo decay, podcasts-as-audio. prior: defaults pro 3/yr, location 8/yr pending per-category calibration" },

];
const TOTAL = 850;

/** Connections lane constants — flat channel weights, identical for every category (sum = 1.00).
 *  Not per-category data: these are platform constants, not an Expected-Volume key. */
const CONNECTION_CHANNEL_WEIGHTS: { channel: string; weight: number }[] = [
  { channel: "Facebook", weight: 0.30 },
  { channel: "Instagram", weight: 0.25 },
  { channel: "LinkedIn", weight: 0.25 },
  { channel: "X (Twitter)", weight: 0.20 },
];

/** Bucket 2 — Link / extracted channels. Each connected+extracted link channel earns
 *  up to LINK_CHANNEL_POINTS, with a hard cap of LINK_BUCKET_CAP for the bucket. */
const LINK_CHANNEL_POINTS = 3;
const LINK_BUCKET_CAP = 12;

/** Website + Schema lane — ten decomposed elements, each scored for Richness,
 *  Consistency, and Schema. Totals: R 31 / C 43 / S 28 = 102. */
const WEBSITE_ELEMENTS = [
  { el: "Identity / NAP",       R: 2, C: 8, S: 2 },  // 12
  { el: "Reviews",              R: 6, C: 6, S: 4 },  // 16
  { el: "Services / Products",  R: 6, C: 6, S: 4 },  // 16
  { el: "Credentials",          R: 3, C: 6, S: 3 },  // 12
  { el: "Hours",                R: 2, C: 3, S: 1 },  // 6
  { el: "About / Expertise",    R: 3, C: 3, S: 2 },  // 8
  { el: "Media / Photos",       R: 4, C: 1, S: 1 },  // 6
  { el: "Structured Data",      R: 0, C: 6, S: 8 },  // 14
  { el: "Social links",         R: 2, C: 2, S: 1 },  // 5
  { el: "Conversion / CTA",     R: 3, C: 2, S: 2 },  // 7
];
const WEBSITE_TOTAL_R = WEBSITE_ELEMENTS.reduce((s, e) => s + e.R, 0);
const WEBSITE_TOTAL_C = WEBSITE_ELEMENTS.reduce((s, e) => s + e.C, 0);
const WEBSITE_TOTAL_S = WEBSITE_ELEMENTS.reduce((s, e) => s + e.S, 0);
const WEBSITE_TOTAL = WEBSITE_TOTAL_R + WEBSITE_TOTAL_C + WEBSITE_TOTAL_S;

function StatusBadge({ s }: { s: LaneStatus }) {
  if (s === "built") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" />built</span>;
  if (s === "deferred") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600"><Clock className="w-3.5 h-3.5" />to build later</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><Circle className="w-3.5 h-3.5" />not built</span>;
}

const VOLUME_LANES: Record<string, LaneVolumeKey> = {
  reviews: "reviews", articles: "articles", qa: "qa", videos: "videos", audio: "audio",
};

export function ScoringTab({ gcid }: { gcid: string }) {
  const [ear, setEar] = useState<any>(null);
  const [eaa, setEaa] = useState<any>(null);
  const [eaq, setEaq] = useState<any>(null);
  const [eav, setEav] = useState<any>(null);
  const [comp, setComp] = useState<any>(null);
  const [categoryLabel, setCategoryLabel] = useState<string>(gcid);

  const load = useCallback(async () => {
    const [a, b, c, q, v, cat] = await Promise.all([
      supabase.from("exp_category_ear").select("ear,band,ear_professional,non_reviewable").eq("gcid", gcid).maybeSingle(),
      supabase.from("exp_category_eaa").select("eaa,band,eaa_professional,non_authored").eq("gcid", gcid).maybeSingle(),
      supabase.from("exp_category_completeness").select("total_node_types,core_node_types,expected_m").eq("gcid", gcid).maybeSingle(),
      supabase.from("exp_category_eaq").select("eaq,band,eaq_professional,non_qa").eq("gcid", gcid).maybeSingle(),
      supabase.from("exp_category_eav").select("eav,band,eav_professional,non_video").eq("gcid", gcid).maybeSingle(),
      supabase.from("gbp_categories").select("display_name").eq("gcid", gcid).maybeSingle(),
    ]);
    setEar(a.data); setEaa(b.data); setComp(c.data);
    setEaq(q.data); setEav(v.data);
    if (cat.data?.display_name) setCategoryLabel(cat.data.display_name as string);
  }, [gcid]);

  useEffect(() => { void load(); }, [load]);

  const builtPts = LANES.filter(l => l.status === "built").reduce((s, l) => s + l.points, 0);
  const target = (key: string) => {
    if (key === "reviews" && ear) return `EAR ${ear.ear}${ear.ear_professional ? ` / pro ${ear.ear_professional}` : ""} / ${ear.band}${ear.non_reviewable ? " / non-reviewable" : ""}`;
    if (key === "articles" && eaa) return `EAA ${eaa.eaa}${eaa.eaa_professional ? ` / pro ${eaa.eaa_professional}` : ""} / ${eaa.band}${eaa.non_authored ? " / non-authored" : ""}`;
    if (key === "audio") return "no per-category table yet / defaults pro 3 / location 8 per year";
    if (key === "qa" && eaq) return `EAQ ${eaq.eaq}${eaq.eaq_professional ? ` / pro ${eaq.eaq_professional}` : ""} / ${eaq.band}${eaq.non_qa ? " / non-Q&A" : ""}`;
    if (key === "videos" && eav) return `EAV ${eav.eav}${eav.eav_professional ? ` / pro ${eav.eav_professional}` : ""} / ${eav.band}${eav.non_video ? " / non-video" : ""}`;
    if (key === "completeness" && comp) return `M ${comp.expected_m} / ${comp.total_node_types} types / ${comp.core_node_types} core`;
    if (key === "gbp") return "universal / no per-category target / binary 0 or 68";
    return null;
  };

  const volumeValues = (key: string): { pro: number | null; loc: number | null } | null => {
    if (key === "reviews" && ear) return { pro: ear.ear_professional ?? null, loc: ear.ear ?? null };
    if (key === "articles" && eaa) return { pro: eaa.eaa_professional ?? null, loc: eaa.eaa ?? null };
    if (key === "audio") return { pro: 3, loc: 8 };
    if (key === "qa" && eaq) return { pro: eaq.eaq_professional ?? null, loc: eaq.eaq ?? null };
    if (key === "videos" && eav) return { pro: eav.eav_professional ?? null, loc: eav.eav ?? null };
    return null;
  };



  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Search Rank Score - 850</div>
          <div className="inline-block mt-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">10-LANE MATH VIEW v5 · 2026-08-17</div>
          <div className="text-sm text-slate-500">Ten lanes. Per-category targets shown live for built lanes; content lanes expose editable Expected-Volume keys.</div>

        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">{builtPts}<span className="text-base text-slate-400"> / {TOTAL}</span></div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">{Math.round(builtPts / TOTAL * 100)}% of model built</div>
          <div className="text-[11px] font-mono text-slate-400">lane sum {LANES.reduce((s, l) => s + l.points, 0)}</div>
        </div>
      </div>
      {/* Shareable progress bar by bucket */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Progress by bucket</div>
        <div className="flex h-6 w-full overflow-hidden rounded-md">
          {LANES.map(l => (
            <div key={l.key} title={`${l.name} — ${l.points}pts — ${l.status}`}
              style={{ width: `${(l.points / TOTAL) * 100}%` }}
              className={l.status === "built" ? "bg-emerald-500" : l.status === "deferred" ? "bg-amber-400" : "bg-slate-200"} />
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 mr-1 align-middle" />Built {builtPts}pts</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-1 align-middle" />Deferred {LANES.filter(l=>l.status==="deferred").reduce((s,l)=>s+l.points,0)}pts</span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-200 mr-1 align-middle" />Not built {LANES.filter(l=>l.status==="unbuilt").reduce((s,l)=>s+l.points,0)}pts</span>
        </div>
      </div>

      {LANES.map(l => {
        const t = target(l.key);
        const vl = VOLUME_LANES[l.key];
        const vv = vl ? volumeValues(l.key) : null;
        return (
          <div key={l.key} className={`rounded-xl border p-4 ${l.status === "built" ? "border-emerald-200 bg-emerald-50/30" : l.status === "deferred" ? "border-amber-200 bg-amber-50/30" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900">{l.name}</span>
                <span className="text-xs font-mono text-slate-400">{l.points} pts / {(l.points / TOTAL * 100).toFixed(1)}%</span>
              </div>
              <StatusBadge s={l.status} />
            </div>
            {t && <div className="mt-1.5 text-xs font-mono text-emerald-700">this category: {t}</div>}
            <div className="mt-2 text-[13px] text-slate-600 leading-snug">{l.method}</div>
            <div className="mt-1.5 text-[12px] text-slate-500"><span className="uppercase tracking-wide text-slate-400">components: </span>{l.components}</div>
            {l.provenance && <div className="mt-1 text-[11px] text-slate-400">{l.provenance}</div>}
            {l.note && <div className="mt-2 rounded-lg bg-amber-100/60 px-3 py-2 text-[12px] text-amber-800">{l.note}</div>}
            {vl && vv && (
              <ExpectedVolumeKeys
                gcid={gcid}
                lane={vl}
                categoryLabel={categoryLabel}
                proInternal={vv.pro}
                locationInternal={vv.loc}
                onSaved={() => void load()}
              />
            )}
            {l.key === "social" && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Bucket 1 — Core OAuth channel weights (platform constants, same for every category)
                  </div>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {CONNECTION_CHANNEL_WEIGHTS.map(c => (
                      <div key={c.channel} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[12px]">
                        <span className="text-slate-600">{c.channel}</span>
                        <span className="font-mono text-slate-900">{c.weight.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    sum {CONNECTION_CHANNEL_WEIGHTS.reduce((s, c) => s + c.weight, 0).toFixed(2)} · per-channel score 0 unless OAuth-connected; 0.6 connected + 0.2 complete profile + 0.2 post within 90 days
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Bucket 2 — Link / extracted channels (read-only, category-specific)
                  </div>
                  <div className="mt-2 flex items-center gap-4 rounded bg-slate-50 px-2 py-1 text-[12px]">
                    <span className="text-slate-600">Points per connected+extracted link channel</span>
                    <span className="font-mono text-slate-900">{LINK_CHANNEL_POINTS}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-4 rounded bg-slate-50 px-2 py-1 text-[12px]">
                    <span className="text-slate-600">Bucket 2 cap</span>
                    <span className="font-mono text-slate-900">{LINK_BUCKET_CAP}</span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400">
                    Examples: YouTube, Yelp, Zillow, Realtor, Lending Tree · link present & reachable (0.5) + extracted & consistent (0.5) · payload scores in its own lanes
                  </div>
                </div>
              </div>
            )}
            {l.key === "website" && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Element breakdown — Richness / Consistency / Schema
                </div>
                <div className="overflow-hidden rounded-md border border-slate-200">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium">Element</th>
                        <th className="px-2 py-1 text-right font-medium w-10">R</th>
                        <th className="px-2 py-1 text-right font-medium w-10">C</th>
                        <th className="px-2 py-1 text-right font-medium w-10">S</th>
                        <th className="px-2 py-1 text-right font-medium w-12">Σ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {WEBSITE_ELEMENTS.map(e => (
                        <tr key={e.el} className="hover:bg-slate-50/50">
                          <td className="px-2 py-1 text-slate-700">{e.el}</td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">{e.R}</td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">{e.C}</td>
                          <td className="px-2 py-1 text-right font-mono text-slate-600">{e.S}</td>
                          <td className="px-2 py-1 text-right font-mono font-medium text-slate-900">{e.R + e.C + e.S}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-semibold text-slate-700">
                      <tr>
                        <td className="px-2 py-1">Totals</td>
                        <td className="px-2 py-1 text-right font-mono">{WEBSITE_TOTAL_R}</td>
                        <td className="px-2 py-1 text-right font-mono">{WEBSITE_TOTAL_C}</td>
                        <td className="px-2 py-1 text-right font-mono">{WEBSITE_TOTAL_S}</td>
                        <td className="px-2 py-1 text-right font-mono">{WEBSITE_TOTAL}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="mt-2 text-[11px] text-slate-400">
                  R = Richness, C = Consistency, S = Schema. Points renormalize when a category drops non-applicable elements.
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="text-[12px] text-slate-400 pt-2">
        Provenance: <span className="font-semibold">ruled</span> = locked by product decision, <span className="font-semibold">prior</span> = defensible launch value pending validation, <span className="font-semibold">fitted</span> = future, regressed on outcomes. No lane faces users until the three contract questions (prediction promise, Score/Signals split, validation funding) are answered.
      </div>
    </div>
  );
}
