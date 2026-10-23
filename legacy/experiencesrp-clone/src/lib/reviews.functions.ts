import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DraftInput = z.object({
  reviewId: z.string().uuid(),
  professionalId: z.string().uuid(),
});

type ComplianceIssue = {
  rule_name: string;
  severity: string;
  rule_type: string;
  rule_value: string;
};

function checkCompliance(text: string, rules: Array<{
  rule_name: string;
  rule_type: string;
  rule_value: string;
  severity: string;
  applies_to: string[] | null;
}>): ComplianceIssue[] {
  const lower = text.toLowerCase();
  const issues: ComplianceIssue[] = [];
  for (const r of rules) {
    if (r.applies_to && !r.applies_to.includes("review_reply")) continue;
    if (r.rule_type === "prohibited_phrase" || r.rule_type === "category_restriction") {
      if (lower.includes(r.rule_value.toLowerCase())) {
        issues.push({ rule_name: r.rule_name, severity: r.severity, rule_type: r.rule_type, rule_value: r.rule_value });
      }
    }
  }
  return issues;
}

// Loads active compliance rules for a category and merges in the per-category
// prohibited phrases from exp_category_compliance (Fair Housing for real estate,
// RESPA for mortgage, etc.) so AI review replies enforce the seeded vertical rules.
async function loadComplianceRules(
  supabase: any,
  gcid: string | null,
): Promise<Array<{ rule_name: string; rule_type: string; rule_value: string; severity: string; applies_to: string[] | null }>> {
  const g = gcid ?? "";
  const { data: ruleRows } = await supabase
    .from("content_compliance_rules")
    .select("rule_name,rule_type,rule_value,severity,applies_to")
    .eq("is_active", true)
    .or(`gcid.eq.${g},gcid.is.null`);

  const rules = ((ruleRows ?? []) as Array<{
    rule_name: string; rule_type: string; rule_value: string; severity: string; applies_to: string[] | null;
  }>);

  if (g) {
    const { data: cat } = await supabase
      .from("exp_category_compliance")
      .select("prohibited_phrases")
      .eq("gcid", g)
      .maybeSingle();
    const phrases: string[] = ((cat as any)?.prohibited_phrases ?? []) as string[];
    for (const phrase of phrases) {
      if (!phrase) continue;
      rules.push({
        rule_name: "Category prohibited phrase",
        rule_type: "prohibited_phrase",
        rule_value: phrase,
        severity: "block",
        applies_to: null,
      });
    }
  }
  return rules;
}

export const draftReviewReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DraftInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: review, error: revErr } = await supabase
      .from("reviews")
      .select("id,rating,title,body,reviewer_name,source")
      .eq("id", data.reviewId)
      .maybeSingle();
    if (revErr || !review) throw new Error("Review not found");

    const { data: pro } = await supabase
      .from("professionals")
      .select("id,display_name,first_name,gcid")
      .eq("id", data.professionalId)
      .maybeSingle();
    if (!pro) throw new Error("Professional not found");

    const { data: knowledge } = await supabase
      .from("exp_category_knowledge")
      .select("ai_agents")
      .eq("gcid", pro.gcid ?? "")
      .maybeSingle();

    const agents: any = (knowledge as any)?.ai_agents ?? {};
    const style: string =
      agents?.review_response?.style ??
      agents?.review_response_style ??
      agents?.review_responder?.style ??
      "warm, professional, concise (under 80 words). Thank the reviewer by first name. Do not make guarantees.";


    const rules = await loadComplianceRules(supabase, pro.gcid ?? null);

    const prohibited = (rules ?? [])
      .filter((r) => r.rule_type === "prohibited_phrase" || r.rule_type === "category_restriction")
      .map((r) => r.rule_value)
      .join("; ");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

    const proName = pro.display_name || pro.first_name || "the team";
    const systemPrompt = `You write public review replies for ${proName}. Style: ${style}.
Never use any of these phrases: ${prohibited}.
Keep under 80 words. Reply as ${proName} (first person). Do not include hashtags or links.`;

    const userPrompt = `Reviewer: ${review.reviewer_name ?? "Customer"}
Rating: ${review.rating}/5
${review.title ? `Title: ${review.title}\n` : ""}Review: ${review.body ?? ""}

Write a public reply.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Anthropic API error: ${resp.status} ${txt.slice(0, 200)}`);
    }
    const json: any = await resp.json();
    const draft: string = (json.content?.[0]?.text ?? "").trim();
    const issues = checkCompliance(draft, (rules ?? []) as any);

    await supabase.from("audit_log").insert({
      user_id: userId,
      action: "review.reply.draft",
      entity_type: "review",
      entity_id: data.reviewId,
      field_changes: { length: draft.length, issues: issues.length },
    } as any);


    return { draft, issues };
  });

const CheckInput = z.object({ text: z.string(), gcid: z.string().nullable() });
export const checkReplyCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CheckInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const rules = await loadComplianceRules(supabase, data.gcid);
    return { issues: checkCompliance(data.text, rules as any) };
  });

const SaveInput = z.object({
  reviewId: z.string().uuid(),
  replyBody: z.string().min(1).max(4000),
});
export const saveReviewReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("reviews")
      .update({
        reply_body: data.replyBody,
        reply_date: new Date().toISOString(),
        reply_source: "experience",
      })
      .eq("id", data.reviewId);
    if (error) throw new Error(error.message);

    await supabase.from("audit_log").insert({
      user_id: userId,
      action: "review.reply.save",
      entity_type: "review",
      entity_id: data.reviewId,
      field_changes: { length: data.replyBody.length },
    } as any);

    return { ok: true };
  });

const FlagInput = z.object({
  reviewId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
export const flagReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FlagInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("reviews")
      .update({ is_flagged: true, flag_reason: data.reason, flag_status: "pending" })
      .eq("id", data.reviewId);
    if (error) throw new Error(error.message);
    await supabase.from("audit_log").insert({
      user_id: userId,
      action: "review.flag",
      entity_type: "review",
      entity_id: data.reviewId,
      field_changes: { reason: data.reason },
    } as any);

    return { ok: true };
  });
