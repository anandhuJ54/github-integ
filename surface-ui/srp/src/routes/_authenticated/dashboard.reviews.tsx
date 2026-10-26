import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@v3/state/api/server-fn";
import { useEffect, useMemo, useState } from "react";
import { Star, Flag, Sparkles, AlertTriangle, CheckCircle2, Send, Megaphone } from "lucide-react";
import { getCurrentUser } from "@v3/state/session/current-user";
import { api } from "@v3/state/api/server-fn";
import { Button } from "@v3/shared/components/ui/button";
import { Card } from "@v3/shared/components/ui/card";
import { Badge } from "@v3/shared/components/ui/badge";
import { Textarea } from "@v3/shared/components/ui/textarea";
import { Input } from "@v3/shared/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@v3/shared/components/ui/dialog";
import { toast } from "sonner";
import { DashboardShell } from "@v3/srp/components/dashboard-shell";
import {
  draftReviewReply,
  checkReplyCompliance,
  saveReviewReply,
  flagReview,
} from "@v3/srp/utils/reviews.functions";

export const Route = createFileRoute("/_authenticated/dashboard/reviews")({
  ssr: false,
  component: ReviewsPage,
});

type Review = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  reviewer_name: string | null;
  review_date: string | null;
  source: string | null;
  reply_body: string | null;
  reply_date: string | null;
  is_flagged: boolean | null;
  flag_reason: string | null;
};

type Professional = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  gcid: string | null;
};

type Tab = "all" | "needs_reply" | "flagged" | "by_source";

const SOURCE_COLORS: Record<string, string> = {
  gbp: "bg-blue-100 text-blue-700",
  google: "bg-blue-100 text-blue-700",
  experience: "bg-violet-100 text-violet-700",
  zillow: "bg-emerald-100 text-emerald-700",
  yelp: "bg-rose-100 text-rose-700",
  facebook: "bg-sky-100 text-sky-700",
};

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
        />
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  const s = (source ?? "unknown").toLowerCase();
  const cls = SOURCE_COLORS[s] ?? "bg-slate-100 text-slate-700";
  return <Badge variant="secondary" className={`${cls} border-0 capitalize`}>{s}</Badge>;
}

function ReviewsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState<Professional | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [issues, setIssues] = useState<Array<{ rule_name: string; severity: string }>>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flagOpen, setFlagOpen] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");

  const draftFn = useServerFn(draftReviewReply);
  const checkFn = useServerFn(checkReplyCompliance);
  const saveFn = useServerFn(saveReviewReply);
  const flagFn = useServerFn(flagReview);

  const load = async () => {
    const user = await getCurrentUser();
    if (!user) {
      navigate({ to: "/auth" as any });
      return;
    }
    // the signed-in user's professional and its newest 200 reviews (server side)
    const data = await api.get<{ pro: Professional | null; reviews?: Review[] }>("/srp/dashboard/reviews");
    if (!data.pro) {
      setLoading(false);
      return;
    }
    setPro(data.pro);
    setReviews(data.reviews ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const total = reviews.length;
    const avg = total ? reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / total : 0;
    const bySource = reviews.reduce<Record<string, number>>((acc, r) => {
      const s = (r.source ?? "unknown").toLowerCase();
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    const needsReply = reviews.filter((r) => !r.reply_body).length;
    const flagged = reviews.filter((r) => r.is_flagged).length;
    return { total, avg, bySource, needsReply, flagged };
  }, [reviews]);

  const filtered = useMemo(() => {
    let list = reviews;
    if (tab === "needs_reply") list = list.filter((r) => !r.reply_body);
    else if (tab === "flagged") list = list.filter((r) => r.is_flagged);
    else if (tab === "by_source" && activeSource) {
      list = list.filter((r) => (r.source ?? "unknown").toLowerCase() === activeSource);
    }
    return list;
  }, [reviews, tab, activeSource]);

  const openReply = (r: Review) => {
    setReplyOpen(r.id);
    setReplyText(r.reply_body ?? "");
    setIssues([]);
  };

  const onAiDraft = async () => {
    if (!replyOpen || !pro) return;
    setDrafting(true);
    try {
      const res = await draftFn({ data: { reviewId: replyOpen, professionalId: pro.id } });
      setReplyText(res.draft);
      setIssues(res.issues);
      if (res.issues.length === 0) toast.success("AI draft ready — compliance passed");
      else toast.warning(`Draft ready — ${res.issues.length} compliance issue(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "AI draft failed");
    } finally {
      setDrafting(false);
    }
  };

  const onCheck = async () => {
    if (!replyText.trim()) return;
    try {
      const res = await checkFn({ data: { text: replyText, gcid: pro?.gcid ?? null } });
      setIssues(res.issues);
      if (res.issues.length === 0) toast.success("Compliance passed");
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
    }
  };

  const onSubmit = async () => {
    if (!replyOpen || !replyText.trim()) return;
    const blocking = issues.filter((i) => i.severity === "block");
    if (blocking.length) {
      toast.error("Resolve blocking compliance issues before submitting");
      return;
    }
    setSaving(true);
    try {
      await saveFn({ data: { reviewId: replyOpen, replyBody: replyText.trim() } });
      toast.success("Reply saved");
      setReplyOpen(null);
      setReplyText("");
      setIssues([]);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onFlag = async () => {
    if (!flagOpen || !flagReason.trim()) return;
    try {
      await flagFn({ data: { reviewId: flagOpen, reason: flagReason.trim() } });
      toast.success("Review flagged");
      setFlagOpen(null);
      setFlagReason("");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Flag failed");
    }
  };

  const proName =
    pro?.display_name || [pro?.first_name, pro?.last_name].filter(Boolean).join(" ") || "";

  return (
    <DashboardShell
      title="Reviews"
      currentPath="/dashboard/reviews"
      user={{ name: proName, photo_url: pro?.photo_url }}
    >
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {loading ? (
          <div className="text-sm text-slate-500">Loading reviews…</div>
        ) : !pro ? (
          <Card className="p-8 text-center text-slate-600">No professional profile linked to this account.</Card>
        ) : (
          <>
            {/* Header + campaign CTA */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Reviews</h2>
                <p className="text-sm text-slate-500">Monitor, reply, and run campaigns.</p>
              </div>
              <Button
                onClick={() => navigate({ to: "/dashboard/reviews/campaigns" as any })}
                className="gap-2"
              >
                <Megaphone className="h-4 w-4" />
                Launch Review Campaign
              </Button>
            </div>

            {/* Stats bar */}
            <Card className="p-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Overall rating</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-3xl font-semibold text-slate-900">{stats.avg.toFixed(1)}</span>
                    <Stars rating={stats.avg} />
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Total reviews</div>
                  <div className="mt-1 text-3xl font-semibold text-slate-900">{stats.total}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Needs reply</div>
                  <div className="mt-1 text-3xl font-semibold text-amber-600">{stats.needsReply}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Flagged</div>
                  <div className="mt-1 text-3xl font-semibold text-rose-600">{stats.flagged}</div>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">By source</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.bySource).length === 0 ? (
                    <span className="text-sm text-slate-400">No sources yet</span>
                  ) : (
                    Object.entries(stats.bySource).map(([src, n]) => (
                      <Badge key={src} variant="secondary" className="bg-slate-100 text-slate-700 border-0 capitalize">
                        {src}: {n}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </Card>

            {/* Tabs */}
            <div className="border-b border-slate-200 flex gap-6">
              {([
                ["all", `All Reviews (${stats.total})`],
                ["needs_reply", `Needs Reply (${stats.needsReply})`],
                ["flagged", `Flagged (${stats.flagged})`],
                ["by_source", "By Source"],
              ] as Array<[Tab, string]>).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setTab(key);
                    if (key !== "by_source") setActiveSource(null);
                  }}
                  className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === key
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "by_source" && (
              <div className="flex flex-wrap gap-2">
                {Object.keys(stats.bySource).map((src) => (
                  <button
                    key={src}
                    onClick={() => setActiveSource(src)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border ${
                      activeSource === src
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    {src} ({stats.bySource[src]})
                  </button>
                ))}
              </div>
            )}

            {/* Review list */}
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <Card className="p-8 text-center text-slate-500">No reviews in this view.</Card>
              ) : (
                filtered.map((r) => (
                  <Card key={r.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Stars rating={Number(r.rating) || 0} />
                          <span className="font-medium text-slate-900">{r.reviewer_name ?? "Anonymous"}</span>
                          <span className="text-xs text-slate-500">
                            {r.review_date ? new Date(r.review_date).toLocaleDateString() : ""}
                          </span>
                          <SourceBadge source={r.source} />
                          {r.is_flagged ? (
                            <Badge variant="secondary" className="bg-rose-100 text-rose-700 border-0">
                              Flagged
                            </Badge>
                          ) : null}
                        </div>
                        {r.title ? (
                          <div className="mt-2 font-medium text-slate-900">{r.title}</div>
                        ) : null}
                        <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{r.body}</p>

                        {r.reply_body ? (
                          <div className="mt-4 ml-4 pl-4 border-l-2 border-slate-200">
                            <div className="text-xs text-slate-500 mb-1">
                              Your reply
                              {r.reply_date ? ` · ${new Date(r.reply_date).toLocaleDateString()}` : ""}
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{r.reply_body}</p>
                            <button
                              onClick={() => openReply(r)}
                              className="mt-2 text-xs text-slate-500 hover:text-slate-900 underline"
                            >
                              Edit reply
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        {!r.reply_body ? (
                          <Button size="sm" onClick={() => openReply(r)}>
                            Reply
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setFlagOpen(r.id);
                            setFlagReason("");
                          }}
                          className="text-slate-500 hover:text-rose-600 gap-1"
                        >
                          <Flag className="h-3.5 w-3.5" />
                          Flag
                        </Button>
                      </div>
                    </div>

                    {/* Inline reply editor */}
                    {replyOpen === r.id ? (
                      <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                        <Textarea
                          value={replyText}
                          onChange={(e) => {
                            setReplyText(e.target.value);
                            setIssues([]);
                          }}
                          placeholder="Write a reply…"
                          rows={5}
                          className="resize-none"
                        />
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{replyText.length} characters</span>
                          <span>{replyText.trim().split(/\s+/).filter(Boolean).length} words</span>
                        </div>

                        {issues.length > 0 ? (
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                              <AlertTriangle className="h-4 w-4" />
                              Compliance issues
                            </div>
                            {issues.map((i, idx) => (
                              <div key={idx} className="text-xs text-amber-800">
                                <span className="font-mono">{i.severity}</span> · {i.rule_name}
                              </div>
                            ))}
                          </div>
                        ) : replyText.trim().length > 0 ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            No issues detected yet — run compliance check.
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" onClick={onAiDraft} disabled={drafting} className="gap-1">
                            <Sparkles className="h-3.5 w-3.5" />
                            {drafting ? "Drafting…" : "AI draft"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={onCheck} disabled={!replyText.trim()}>
                            Check compliance
                          </Button>
                          <div className="flex-1" />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReplyOpen(null);
                              setReplyText("");
                              setIssues([]);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button size="sm" onClick={onSubmit} disabled={saving || !replyText.trim()} className="gap-1">
                            <Send className="h-3.5 w-3.5" />
                            {saving ? "Saving…" : "Submit reply"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </Card>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={!!flagOpen} onOpenChange={(o) => !o && setFlagOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag review</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-slate-600">Reason</label>
            <Input
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="e.g. fake reviewer, off-topic, harassment"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFlagOpen(null)}>Cancel</Button>
            <Button onClick={onFlag} disabled={!flagReason.trim()}>Flag review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
