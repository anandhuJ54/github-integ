import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GenInput = z.object({
  gcid: z.string().min(1),
  displayName: z.string().min(1),
  entityType: z.string().min(1), // "both" | "location" | "professional"
});

const ELEMENTS = [
  "Core identity",
  "Credentials & authority",
  "Experience & track record",
  "Published content",
  "Media & voice",
  "Social presence & engagement",
  "Reviews & reputation",
  "Affiliations & upstream",
  "Web presence & entity graph",
];

const PROFILE_KINDS =
  "header | infoCards | lines | stats | properties | services | chips | score | roster | reviews | posts | disclaimer";

const MODEL = "claude-sonnet-4-6";
const ELEMENT_LIST = ELEMENTS.map((e, i) => `${i + 1}. ${e}`).join("\n");

// ── gates (the bar proven on real estate: 149/167 fields, tether on all surfaces) ──
const GATE_MIN_FIELDS = 100; // prompt targets 110-135; floor guards against thin output
const GATE_MIN_SEO = 18;

function extractJson(text: string): any {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Model did not return a JSON object.");
  }
  return JSON.parse(t.slice(first, last + 1));
}

async function callAnthropic(
  apiKey: string,
  system: string,
  user: string,
  maxTokens = 16000,
): Promise<any> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Anthropic API error: ${resp.status} ${txt.slice(0, 200)}`);
  }
  const json: any = await resp.json();
  if (json.stop_reason === "max_tokens") {
    throw new Error("truncated: hit max_tokens (decomposition should prevent this)");
  }
  const raw: string = (json.content?.[0]?.text ?? "").trim();
  return extractJson(raw);
}

type Lane = "professional" | "location";

// KM conversion actions (DB snake_case) filtered to a lane.
function kmActionsForLane(km: any, lane: Lane): any[] {
  const all = Array.isArray(km?.conversion_actions) ? km.conversion_actions : [];
  return all.filter((a: any) => (a.lane ?? a.lanes?.[0]) === lane);
}

// ── Step A: exhaustive fields for one lane ──
function fieldsSystem(lane: Lane): string {
  const laneRule =
    lane === "professional"
      ? "This is the PROFESSIONAL lane (the individual practitioner). schemaType MUST be \"Person + <the category's professional @type>\". Element 1 carries PERSON fields (name, jobTitle, credentials, contact)."
      : "This is the LOCATION lane (the place/organization). schemaType MUST be the category's organization/LocalBusiness @type. Element 1 carries PLACE/ORG fields (address, geo, hours, areaServed, parentOrganization).";
  return `You are the schema architect for an expertise-graph platform (Experience.com). Produce ONLY the 9 expertise elements with EXHAUSTIVE schema.org fields for ONE lane of a Google Business Profile category. No jsonld/html/profile/seo — fields only.

OUTPUT: a SINGLE JSON object, no prose or fences:
{ "schemaType": string, "elements": [ { "n":1..9, "name":string, "group":string, "fields":[ { "label":string, "prop":string, "type":string, "source":string, "scored"?:true } ] } ] }

The 9 elements, fixed order:
${ELEMENT_LIST}

RULES:
- EXHAUSTIVE: 110-135 total fields across the 9 elements. Enumerate every authority field a real profile in THIS category carries. Do NOT summarize or truncate.
- Use REAL schema.org properties (name, jobTitle, hasCredential, aggregateRating, review, sameAs, address, geo, openingHoursSpecification, makesOffer, areaServed, parentOrganization, employee, subjectOf, interactionStatistic, knowsAbout, award, memberOf, hasOfferCatalog, etc.).
- Mark ~28-32% of the most authority-bearing fields scored:true.
- Choose the correct schema.org @type for THIS category (do NOT default to RealEstateAgent).
- ${laneRule}`;
}

function fieldsUser(data: any, lane: Lane, km: any): string {
  const svc = (km?.services ?? []).slice(0, 20).join("; ");
  const term = (km?.terminology ?? []).join(", ");
  const comp = (km?.compliance_rules ?? []).join("; ");
  return `Category: "${data.displayName}" (gcid: ${data.gcid}). Produce the ${lane.toUpperCase()} lane.
SERVICES: ${svc || "—"}
TERMINOLOGY: ${term || "—"}
COMPLIANCE (honor; correct regulator): ${comp || "—"}
Return the exhaustive 9-element fields JSON now (110-135 fields).`;
}

// ── Step B: string payloads for one lane (fields already defined) ──
function payloadsSystem(lane: Lane, schemaType: string): string {
  return `You are the schema architect for Experience.com. For ONE lane whose FIELDS are already defined, produce the remaining payloads. Output a SINGLE JSON object, no prose or fences:
{ "seo":[[attr,pattern],...], "jsonld": string (a complete JSON-LD @graph), "html": string (microdata snippet), "profile":[ProfileSection,...] }
ProfileSection kinds: ${PROFILE_KINDS}
RULES:
- schemaType is "${schemaType}". jsonld @type must reflect it.
- seo: 20-24 rows of [attribute, pattern] covering the search intents + category terminology.
- profile: complete visitor sections — a header (name/subtitle/rating/chips), the key sections for a ${lane} in this category (listings/menu/services/stats as appropriate), reviews (multi-source), posts, and a disclaimer. Plausible sample data.
- Include a header section (kind:"header") and leave its "ctas" as [] — the platform stamps CTAs deterministically.
- jsonld MUST be valid JSON (it is parsed). Do NOT include a potentialAction — the platform injects it deterministically.`;
}

function payloadsUser(lane: Lane, schemaType: string, fieldsObj: any, km: any): string {
  const summary = (fieldsObj.elements ?? []).map((e: any) => ({
    n: e.n,
    name: e.name,
    fields: (e.fields ?? []).map((f: any) => f.label),
  }));
  const intents = (Array.isArray(km?.search_intents) ? km.search_intents : [])
    .filter((s: any) => (s.lane ?? lane) === lane)
    .map((s: any) => s.query);
  return `Lane=${lane}, schemaType=${schemaType}. The lane already has these elements/fields:
${JSON.stringify(summary).slice(0, 3500)}
Search intents (SEO must cover these): ${intents.join(" | ") || "—"}
Return the seo/jsonld/html/profile JSON now.`;
}

// ── Step C: deterministic tether stamp (never trust the model for this) ──
function stampTether(laneObj: any, kmActs: any[]): void {
  const ctas = kmActs.map((a) => a.profile_button ?? a.profileButton).filter(Boolean);
  // header.ctas
  const header = (laneObj.profile ?? []).find((p: any) => p?.kind === "header");
  if (header) header.ctas = ctas;
  else if (Array.isArray(laneObj.profile))
    laneObj.profile.unshift({ kind: "header", name: "", subtitle: "", initials: "", ctas });
  // jsonld potentialAction
  const pa = kmActs.map((a) => ({
    "@type": a.schema_action ?? a.schemaAction,
    name: a.label,
  }));
  try {
    const jl = JSON.parse(laneObj.jsonld);
    if (jl && Array.isArray(jl["@graph"]) && jl["@graph"].length) {
      const target =
        jl["@graph"].find((n: any) => n && n["@type"]) ?? jl["@graph"][0];
      target.potentialAction = pa;
    } else {
      jl.potentialAction = pa;
    }
    laneObj.jsonld = JSON.stringify(jl);
  } catch {
    /* jsonld gate will catch invalid json below */
  }
}

function countFields(laneObj: any): number {
  return (laneObj.elements ?? []).reduce(
    (n: number, e: any) => n + (e.fields?.length ?? 0),
    0,
  );
}
function countScored(laneObj: any): number {
  return (laneObj.elements ?? []).reduce(
    (n: number, e: any) =>
      n + (e.fields ?? []).filter((f: any) => f.scored).length,
    0,
  );
}
function potentialActionCount(laneObj: any): number {
  try {
    const jl = JSON.parse(laneObj.jsonld);
    let found: any = null;
    const walk = (o: any) => {
      if (found) return;
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        if (o.potentialAction) found = o.potentialAction;
        else Object.values(o).forEach(walk);
      }
    };
    walk(jl);
    return Array.isArray(found) ? found.length : 0;
  } catch {
    return -1; // invalid json
  }
}

function gateLane(laneObj: any, kmActs: any[]): { pass: boolean; failures: string[] } {
  const fields = countFields(laneObj);
  const scored = countScored(laneObj);
  const pct = fields ? Math.round((100 * scored) / fields) : 0;
  const seo = laneObj.seo?.length ?? 0;
  const header = (laneObj.profile ?? []).find((p: any) => p?.kind === "header");
  const ctas: string[] = header?.ctas ?? [];
  const expected = kmActs.map((a) => a.profile_button ?? a.profileButton).filter(Boolean);
  const paCount = potentialActionCount(laneObj);
  const failures: string[] = [];
  if ((laneObj.elements?.length ?? 0) !== 9) failures.push("not 9 elements");
  if (fields < GATE_MIN_FIELDS) failures.push(`fields ${fields} < ${GATE_MIN_FIELDS}`);
  if (pct < 20 || pct > 40) failures.push(`scored ratio ${pct}% out of range`);
  if (seo < GATE_MIN_SEO) failures.push(`seo rows ${seo} < ${GATE_MIN_SEO}`);
  if (paCount < 0) failures.push("jsonld invalid");
  if (expected.length) {
    if (JSON.stringify(ctas) !== JSON.stringify(expected)) failures.push("header.ctas != KM buttons");
    if (paCount !== expected.length) failures.push(`potentialAction ${paCount} != KM ${expected.length}`);
  }
  return { pass: failures.length === 0, failures };
}

// Build one fully-formed, gated lane (with a single retry on gate failure).
async function buildLane(apiKey: string, data: any, lane: Lane, km: any): Promise<any> {
  const kmActs = kmActionsForLane(km, lane);
  let lastFailures: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const fieldsObj = await callAnthropic(apiKey, fieldsSystem(lane), fieldsUser(data, lane, km));
    const schemaType = fieldsObj.schemaType ?? (lane === "professional" ? "Person" : "LocalBusiness");
    const rest = await callAnthropic(
      apiKey,
      payloadsSystem(lane, schemaType),
      payloadsUser(lane, schemaType, fieldsObj, km),
    );
    const laneObj = {
      key: lane,
      label: lane === "professional" ? "Agent (professional)" : "Office (location)",
      schemaType,
      elements: fieldsObj.elements,
      seo: rest.seo,
      jsonld: rest.jsonld,
      html: rest.html,
      profile: rest.profile,
    };
    stampTether(laneObj, kmActs);
    const gate = gateLane(laneObj, kmActs);
    if (gate.pass) return laneObj;
    lastFailures = gate.failures;
  }
  throw new Error(`Lane "${lane}" failed gates after retry: ${lastFailures.join("; ")}`);
}

export const generateCategorySchema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    // Source of truth: the Knowledge Model row we PROJECT from.
    const { data: km } = await supabase
      .from("exp_category_knowledge")
      .select(
        "terminology, services, compliance_rules, value_props, search_intents, conversion_actions, updated_at",
      )
      .eq("gcid", data.gcid)
      .maybeSingle();

    if (!km) throw new Error("No Knowledge Model for this category — build Layer 1 first.");
    if (!Array.isArray(km.conversion_actions) || km.conversion_actions.length === 0) {
      throw new Error(
        "Knowledge Model has no conversion_actions — generate the logic layer before schema.",
      );
    }

    const lanes: Lane[] =
      data.entityType === "location"
        ? ["location"]
        : data.entityType === "professional"
          ? ["professional"]
          : ["professional", "location"];

    // Lanes are independent → build in parallel (fields→payloads is sequential within each).
    const built = await Promise.all(lanes.map((l) => buildLane(apiKey, data, l, km)));

    const parsed = {
      gcid: data.gcid,
      displayName: data.displayName,
      entityType: data.entityType,
      lanes: built,
    };

    const now = new Date().toISOString();
    let persisted = false;
    let persistError: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.from("exp_category_schema").upsert(
        {
          gcid: data.gcid,
          entity_type: data.entityType,
          schema_json: parsed,
          model: `${MODEL} (decomposed)`,
          knowledge_updated_at: km?.updated_at ?? null,
          generated_by: userId,
          generated_at: now,
          updated_at: now,
        },
        { onConflict: "gcid" },
      );
      persistError = error ? error.message : null;
      persisted = !error;
    } catch (e: any) {
      persistError = e?.message ?? String(e);
    }

    try {
      await supabase.from("audit_log").insert({
        user_id: userId,
        action: "category.schema.generate",
        entity_type: "category",
        entity_id: data.gcid,
        field_changes: {
          lanes: parsed.lanes.length,
          fields: parsed.lanes.map((l: any) => countFields(l)),
          method: "decomposed",
        },
      } as any);
    } catch {
      /* audit is non-critical */
    }

    return {
      ok: true,
      schema: parsed,
      persisted,
      persistError,
      stats: parsed.lanes.map((l: any) => ({
        lane: l.key,
        schemaType: l.schemaType,
        fields: countFields(l),
        scored: countScored(l),
      })),
    };
  });
