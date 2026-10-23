import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { BrandIcon } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import type { CityArticle } from "@/lib/city-home.functions";

/** Graph-grounded city Q&A. Shows the labelled stub until an AI method is wired. */
export function AskExperience({ area }: { area: string }) {
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    if (question.trim().length < 2) return;
    setLoading(true);
    try {
      const response = await fetch("/api/search-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, area }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      setMessage(data.message ?? data.error ?? "AI answers coming soon");
    } catch {
      setMessage("AI answers coming soon");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg bg-slate-950 p-5 text-white">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="font-editorial text-xl font-semibold">
            Let&apos;s talk about {area || "your area"}
          </h2>
          <p className="mt-1 text-sm text-stone-300">
            Ask about local pros, places and what people say about them.
          </p>
        </div>
      </div>
      <form
        className="mt-4 flex gap-2 rounded-lg bg-white p-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          aria-label={`Ask about ${area || "your area"}`}
          placeholder={`Who is the best rated plumber in ${area.split(",")[0] || "town"}?`}
          className="min-w-0 flex-1 bg-transparent px-2.5 text-sm text-slate-950 outline-none"
        />
        <Button type="submit" disabled={loading} className="bg-amber-500 text-slate-950 hover:bg-amber-400">
          {loading ? "Checking…" : "Ask"}
        </Button>
      </form>
      <p
        role="status"
        className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200"
      >
        {message ?? "AI answers coming soon"}
      </p>
    </section>
  );
}

export function CityArticles({ area, articles }: { area: string; articles: CityArticle[] }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="font-editorial text-xl font-semibold text-slate-950">
        {area || "Local"} articles
      </h2>
      {articles.length ? (
        <ul className="mt-3 space-y-3">
          {articles.map((article) => (
            <li key={article.id} className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
              {article.slug ? (
                <Link
                  to="/voce-articles"
                  className="text-sm font-semibold text-slate-900 hover:text-amber-800"
                >
                  {article.title}
                </Link>
              ) : (
                <span className="text-sm font-semibold text-slate-900">{article.title}</span>
              )}
              {article.excerpt ? (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{article.excerpt}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-stone-400">
                {[article.authorName, article.topic, article.publishedOn].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-500">
          No published articles from this area yet — new local writing appears here as it is
          published.
        </p>
      )}
    </section>
  );
}

export function WhatIsExperience() {
  return (
    <section className="rounded-lg border border-stone-200 bg-[#fbfaf7] p-5">
      <div className="flex items-center gap-2">
        <BrandIcon size={24} />
        <h2 className="font-editorial text-xl font-semibold text-slate-950">
          What is Experience.com?
        </h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        We rank people and places by proof, not ads: verified reviews, credentials, licences and
        the details each profile can actually show. Search in plain language and see the evidence
        behind every result.
      </p>
      <Link
        to="/trust"
        className="mt-3 inline-block text-sm font-semibold text-amber-800 hover:underline"
      >
        How our ranking works →
      </Link>
    </section>
  );
}
