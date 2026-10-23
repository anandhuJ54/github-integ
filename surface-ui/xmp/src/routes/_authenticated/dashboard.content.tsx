import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  PenSquare,
  Eye,
  Sparkles,
  TrendingUp,
  MessageSquare,
  Edit3,
  ExternalLink,
  FileText,
} from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Button } from "@v3/ui/components/ui/button";
import { Card } from "@v3/ui/components/ui/card";
import { Badge } from "@v3/ui/components/ui/badge";
import { DashboardShell } from "@v3/xmp/components/dashboard-shell";

export const Route = createFileRoute("/_authenticated/dashboard/content")({
  ssr: false,
  component: ContentPage,
});

type Professional = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  gcid: string | null;
};

type ContentItem = {
  id: string;
  title: string | null;
  slug: string | null;
  excerpt: string | null;
  status: string | null;
  published_at: string | null;
  views: number | null;
  ai_mentions: number | null;
  keywords: string[] | null;
  topic_ids: string[] | null;
  published_url: string | null;
  content_type: string | null;
};

type TaxTerm = {
  id: string;
  term: string;
  term_display: string | null;
  level: string;
  search_volume_monthly: number | null;
  search_intent: string | null;
  priority: number | null;
};

const STATUS_META: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  review: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-rose-100 text-rose-700",
};

function ContentPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState<Professional | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [topics, setTopics] = useState<TaxTerm[]>([]);
  const [questions, setQuestions] = useState<TaxTerm[]>([]);
  const [topicMap, setTopicMap] = useState<Map<string, TaxTerm>>(new Map());

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate({ to: "/auth" as any });
        return;
      }
      const { data: proRow } = await supabase
        .from("professionals")
        .select("id,display_name,first_name,last_name,photo_url,gcid")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!proRow) {
        setLoading(false);
        return;
      }
      setPro(proRow as Professional);

      const [{ data: ci }, topicsRes, qRes, allTerms] = await Promise.all([
        supabase
          .from("content_items")
          .select(
            "id,title,slug,excerpt,status,published_at,views,ai_mentions,keywords,topic_ids,published_url,content_type",
          )
          .eq("author_type", "professional")
          .eq("author_id", proRow.id)
          .order("created_at", { ascending: false })
          .limit(100),
        proRow.gcid
          ? supabase
              .from("exp_taxonomy")
              .select("id,term,term_display,level,search_volume_monthly,search_intent,priority")
              .eq("gcid", proRow.gcid)
              .eq("level", "topic")
              .eq("is_active", true)
              .order("search_volume_monthly", { ascending: false, nullsFirst: false })
              .limit(5)
          : Promise.resolve({ data: [] as TaxTerm[] }),
        proRow.gcid
          ? supabase
              .from("exp_taxonomy")
              .select("id,term,term_display,level,search_volume_monthly,search_intent,priority")
              .eq("gcid", proRow.gcid)
              .eq("level", "question")
              .eq("is_active", true)
              .order("search_volume_monthly", { ascending: false, nullsFirst: false })
              .limit(20)
          : Promise.resolve({ data: [] as TaxTerm[] }),
        proRow.gcid
          ? supabase
              .from("exp_taxonomy")
              .select("id,term,term_display,level,search_volume_monthly,search_intent,priority")
              .eq("gcid", proRow.gcid)
          : Promise.resolve({ data: [] as TaxTerm[] }),
      ]);
      setItems((ci as ContentItem[]) ?? []);
      setTopics((topicsRes.data as TaxTerm[]) ?? []);
      const allQ = (qRes.data as TaxTerm[]) ?? [];

      const map = new Map<string, TaxTerm>();
      for (const t of (allTerms.data as TaxTerm[]) ?? []) map.set(t.id, t);
      setTopicMap(map);

      // Filter answered questions: any content item whose topic_ids include the question id
      const answered = new Set<string>();
      for (const c of (ci as ContentItem[]) ?? []) {
        for (const tid of c.topic_ids ?? []) answered.add(tid);
      }
      setQuestions(allQ.filter((q) => !answered.has(q.id)).slice(0, 6));
      setLoading(false);
    })();
  }, [navigate]);

  const stats = useMemo(() => {
    const published = items.filter((i) => i.status === "published");
    const views = items.reduce((s, i) => s + (i.views ?? 0), 0);
    const mentions = items.reduce((s, i) => s + (i.ai_mentions ?? 0), 0);
    // 100pt content bucket: ~5pt per published article up to cap
    const scoreFromContent = Math.min(100, published.length * 5 + Math.min(20, Math.floor(views / 500)));
    return { publishedCount: published.length, views, mentions, scoreFromContent };
  }, [items]);

  const goVoce = (params?: Record<string, string>) => {
    const search = params ? `?${new URLSearchParams(params).toString()}` : "";
    navigate({ to: ("/dashboard/voce" + search) as any });
  };

  return (
    <DashboardShell title="Content" currentPath="/dashboard/content" user={pro ?? undefined}>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Content</h2>
            <p className="text-sm text-slate-500">
              Gateway to VOCE — your AI content publishing engine.
            </p>
          </div>
          <Button size="lg" onClick={() => goVoce()} className="gap-2">
            <PenSquare className="h-5 w-5" />
            Write New Article
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : !pro ? (
          <Card className="p-6 text-sm text-slate-600">No professional profile found.</Card>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Articles published" value={stats.publishedCount} />
              <Stat label="Total views" value={stats.views.toLocaleString()} />
              <Stat label="AI search mentions" value={stats.mentions} />
              <Stat label="Score from content" value={`+${stats.scoreFromContent}`} tone="emerald" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Article list */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900">Your articles</h3>
                {items.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-slate-500">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    No articles yet. Click "Write New Article" to start.
                  </Card>
                ) : (
                  <Card className="divide-y">
                    {items.map((c) => {
                      const tags = (c.topic_ids ?? [])
                        .map((id) => topicMap.get(id)?.term_display || topicMap.get(id)?.term)
                        .filter(Boolean) as string[];
                      const allTags = [...tags, ...(c.keywords ?? [])].slice(0, 4);
                      const cls = STATUS_META[c.status ?? "draft"] ?? STATUS_META.draft;
                      return (
                        <div key={c.id} className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-semibold text-slate-900">
                                  {c.title || "Untitled"}
                                </h4>
                                <Badge variant="secondary" className={`${cls} border-0 capitalize`}>
                                  {c.status ?? "draft"}
                                </Badge>
                              </div>
                              {c.excerpt ? (
                                <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                                  {c.excerpt}
                                </p>
                              ) : null}
                              <div className="flex items-center gap-3 text-xs text-slate-500 mt-2 flex-wrap">
                                {c.published_at ? (
                                  <span>
                                    Published{" "}
                                    {new Date(c.published_at).toLocaleDateString()}
                                  </span>
                                ) : (
                                  <span>Not published</span>
                                )}
                                <span className="inline-flex items-center gap-1">
                                  <Eye className="h-3 w-3" />
                                  {(c.views ?? 0).toLocaleString()} views
                                </span>
                                {allTags.map((t) => (
                                  <Badge
                                    key={t}
                                    variant="outline"
                                    className="text-[10px] font-normal py-0 h-5"
                                  >
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => goVoce({ edit: c.id })}
                              >
                                <Edit3 className="h-4 w-4 mr-1.5" /> Edit
                              </Button>
                              {c.published_url ? (
                                <Button size="sm" variant="outline" asChild>
                                  <a href={c.published_url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-4 w-4 mr-1.5" /> View
                                  </a>
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-4 w-4 text-violet-600" />
                    <h3 className="text-sm font-semibold text-slate-900">Suggested topics</h3>
                  </div>
                  {topics.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No topics configured for your category yet.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {topics.map((t) => (
                        <li
                          key={t.id}
                          className="border-b border-slate-100 last:border-0 pb-3 last:pb-0"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-900">
                                {t.term_display || t.term}
                              </div>
                              {t.search_volume_monthly ? (
                                <Badge
                                  variant="secondary"
                                  className="bg-blue-50 text-blue-700 border-0 text-[10px] mt-1 gap-1"
                                >
                                  <TrendingUp className="h-3 w-3" />
                                  {t.search_volume_monthly.toLocaleString()}/mo
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 h-7 px-2 text-xs"
                            onClick={() => goVoce({ topic: t.id })}
                          >
                            Write about this →
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold text-slate-900">Q&amp;A — unanswered</h3>
                  </div>
                  {questions.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No open questions. Great work.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {questions.map((q) => (
                        <li
                          key={q.id}
                          className="border-b border-slate-100 last:border-0 pb-3 last:pb-0"
                        >
                          <p className="text-sm text-slate-800">
                            {q.term_display || q.term}
                          </p>
                          {q.search_volume_monthly ? (
                            <span className="text-[10px] text-slate-500">
                              {q.search_volume_monthly.toLocaleString()} searches/mo
                            </span>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-1 h-7 px-2 text-xs block"
                            onClick={() => goVoce({ question: q.id })}
                          >
                            Answer this →
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "emerald";
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${
          tone === "emerald" ? "text-emerald-600" : "text-slate-900"
        }`}
      >
        {value}
      </div>
    </Card>
  );
}
