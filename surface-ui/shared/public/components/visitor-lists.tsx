import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Columns3, Heart, Star, Trash2, X } from "lucide-react";
import { Button } from "@v3/shared/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@v3/shared/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@v3/shared/components/ui/dialog";
import { EntityAvatar } from "@v3/shared/public/components/visual";
import { ScoreExplainer } from "@v3/shared/public/components/score-explainer";
import { CardActions } from "@v3/shared/public/components/card-actions";
import { getCompareEntities, type CompareEntity } from "@v3/shared/public/utils/engagement.functions";
import { profilePath } from "@v3/shared/public/utils/search";
import { COMPARE_MAX, useCompare, useRecentlyViewed, useSavedList, type ListedDoc } from "@v3/shared/public/utils/visitor-lists";
import { cn } from "@v3/shared/components/utils/utils";

/* --------------------------------- saving --------------------------------- */

export function SaveButton({ doc, className }: { doc: ListedDoc; className?: string }) {
  const saved = useSavedList();
  const on = saved.has(doc.id);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${doc.name} from your saved list` : `Save ${doc.name}`}
      onClick={() => saved.toggle(doc)}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-amber-50 hover:text-amber-700",
        on && "text-amber-700",
        className,
      )}
    >
      <Heart className="h-4 w-4" fill={on ? "currentColor" : "none"} />
    </button>
  );
}

function ListRow({ item, onRemove }: { item: ListedDoc; onRemove: () => void }) {
  return (
    <li className="flex items-start gap-3 border-b border-stone-100 py-3 last:border-0">
      <EntityAvatar name={item.name} src={item.photo_url} kind={item.entity_type} size={38} />
      <div className="min-w-0 flex-1">
        <Link to={profilePath(item)} className="block truncate text-sm font-semibold text-slate-900 hover:text-amber-800">
          {item.name}
        </Link>
        <p className="truncate text-xs text-stone-500">
          {[item.title ?? item.categoryLabel, [item.city, item.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.rating !== null ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-stone-500">
            <Star className="h-3 w-3 text-[#fbbc04]" fill="#fbbc04" /> {Number(item.rating).toFixed(2)}
            {item.review_count ? ` (${item.review_count.toLocaleString()})` : ""}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.name}`}
        className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Header access point: "Saved (n)" with the shortlist in a side sheet. */
export function SavedSheet({ tone = "light" }: { tone?: "light" | "dark" }) {
  const saved = useSavedList();
  if (!saved.ready) return null;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
            tone === "dark"
              ? "border-white/20 bg-slate-950/70 text-white hover:border-amber-400"
              : "border-stone-200 bg-white text-slate-700 hover:border-amber-400 hover:text-amber-800",
          )}
        >
          <Heart className="h-3.5 w-3.5 text-amber-600" fill={saved.count ? "currentColor" : "none"} />
          Saved ({saved.count})
        </button>
      </SheetTrigger>
      <SheetContent className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-editorial text-2xl">Your saved list</SheetTitle>
          <SheetDescription>
            Kept on this device — no account needed.
          </SheetDescription>
        </SheetHeader>
        {saved.items.length ? (
          <>
            <ul className="mt-4">
              {saved.items.map((item) => (
                <ListRow key={item.id} item={item} onRemove={() => saved.remove(item.id)} />
              ))}
            </ul>
            <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Want to keep this list?</p>
              <p className="mt-1 text-sm text-stone-600">
                Create a free account and your saved profiles follow you to any device. Optional —
                your list works without one.
              </p>
              <Button asChild className="mt-3 bg-amber-500 text-slate-950 hover:bg-amber-400">
                <Link to="/auth">Create an account</Link>
              </Button>
            </div>
            <button
              type="button"
              onClick={saved.clear}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear list
            </button>
          </>
        ) : (
          <p className="mt-4 text-sm text-stone-500">
            Nothing saved yet. Tap the heart on any result to build a shortlist.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ----------------------------- recently viewed ---------------------------- */

export function RecentlyViewed() {
  const { items, ready } = useRecentlyViewed();
  if (!ready || items.length < 1) return null;
  return (
    <section className="border-b border-stone-200 bg-white px-5 py-5 sm:px-6">
      <div className="mx-auto max-w-[1320px]">
        <h2 className="inline-flex items-center gap-2 font-editorial text-xl font-semibold text-slate-950">
          <Clock className="h-4 w-4 text-amber-700" aria-hidden="true" /> Pick up where you left off
        </h2>
        <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1">
          {items.map((item) => (
            <Link
              key={item.id}
              to={profilePath(item)}
              className="flex w-60 shrink-0 items-center gap-2.5 rounded-lg border border-stone-200 bg-white p-3 hover:border-amber-400"
            >
              <EntityAvatar name={item.name} src={item.photo_url} kind={item.entity_type} size={36} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{item.name}</span>
                <span className="block truncate text-xs text-stone-500">
                  {[item.title ?? item.categoryLabel, [item.city, item.state].filter(Boolean).join(", ")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- compare -------------------------------- */

export function CompareToggle({ doc }: { doc: ListedDoc }) {
  const compare = useCompare();
  const on = compare.has(doc.id);
  const full = !on && compare.count >= COMPARE_MAX;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={full}
      onClick={() => compare.toggle(doc)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
        on
          ? "border-amber-500 bg-amber-50 text-amber-900"
          : "border-stone-200 bg-white text-slate-700 hover:border-amber-400",
        full && "cursor-not-allowed opacity-50",
      )}
      title={full ? `Compare up to ${COMPARE_MAX} at a time` : undefined}
    >
      <Columns3 className="h-3.5 w-3.5" aria-hidden="true" /> {on ? "Comparing" : "Compare"}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-stone-200 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <div className="mt-1 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function CompareColumn({ entity }: { entity: CompareEntity }) {
  return (
    <div className="min-w-[240px] flex-1 rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2.5">
        <EntityAvatar
          name={entity.name}
          src={entity.photoUrl}
          kind={entity.entityType as "professional" | "location" | "brand"}
          size={40}
        />
        <div className="min-w-0">
          <Link
            to={profilePath({ entity_type: entity.entityType as "professional", slug: entity.slug })}
            className="block truncate text-sm font-semibold text-slate-950 hover:text-amber-800"
          >
            {entity.name}
          </Link>
          <p className="truncate text-xs text-stone-500">{entity.categoryLabel ?? ""}</p>
        </div>
      </div>

      <Row label="Experience Score">
        {entity.score !== null ? (
          <span className="font-semibold tabular-nums">
            {entity.score}
            {entity.band ? <span className="ml-1 text-xs text-stone-500">({entity.band})</span> : null}
          </span>
        ) : (
          <span className="text-stone-500">Not calculated yet</span>
        )}
        {entity.components.length ? (
          <ul className="mt-1.5 space-y-0.5 text-xs capitalize text-stone-600">
            {entity.components.map((component) => (
              <li key={component.label}>
                {component.label}: <span className="tabular-nums">{component.value}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Row>
      <Row label="Rating">
        {entity.rating !== null ? (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-[#fbbc04]" fill="#fbbc04" />
            {entity.rating.toFixed(2)}
            {entity.reviewCount ? (
              <span className="text-xs text-stone-500">({entity.reviewCount.toLocaleString()})</span>
            ) : null}
          </span>
        ) : (
          <span className="text-stone-500">No verified rating yet</span>
        )}
      </Row>
      <Row label="Location">{entity.location ?? <span className="text-stone-500">—</span>}</Row>
      <Row label="Specialties">
        {entity.specialties.length ? entity.specialties.join(", ") : <span className="text-stone-500">—</span>}
      </Row>
      <Row label="Languages">
        {entity.languages.length ? entity.languages.join(", ") : <span className="text-stone-500">—</span>}
      </Row>
      <Row label="Credentials">
        {entity.credentials.length ? entity.credentials.join(", ") : <span className="text-stone-500">—</span>}
      </Row>
      <Row label="Contact">
        <CardActions actions={entity.actions} name={entity.name} />
      </Row>
    </div>
  );
}

/** Sticky compare bar plus the side-by-side dialog. */
export function CompareBar() {
  const compare = useCompare();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CompareEntity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !compare.items.length) return;
    let alive = true;
    setLoading(true);
    void getCompareEntities({ data: { docIds: compare.items.map((item) => item.id) } })
      .then((next) => {
        if (alive) setRows(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, compare.items]);

  if (!compare.ready || compare.count === 0) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,.4)] backdrop-blur">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-slate-800">
            <span className="font-semibold">{compare.count}</span> selected to compare
            <span className="ml-2 truncate text-xs text-stone-500">
              {compare.items.map((item) => item.name).join(" · ")}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={compare.clear}
              className="text-xs font-semibold text-stone-500 hover:text-stone-800"
            >
              Clear
            </button>
            <Button
              disabled={compare.count < 2}
              onClick={() => setOpen(true)}
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              Compare {compare.count < 2 ? "(pick 2)" : ""}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto rounded-lg">
          <DialogHeader>
            <DialogTitle className="font-editorial text-2xl">Side by side</DialogTitle>
          </DialogHeader>
          {loading && !rows.length ? (
            <p className="text-sm text-stone-500">Loading the details…</p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row">
              {rows.map((entity) => (
                <CompareColumn key={entity.id} entity={entity} />
              ))}
            </div>
          )}
          <ScoreExplainer />
        </DialogContent>
      </Dialog>
    </>
  );
}
