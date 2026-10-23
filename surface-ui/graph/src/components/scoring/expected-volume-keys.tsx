import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { useRole } from "@v3/ui/lib/roles";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v3/ui/components/ui/dialog";

/** Expected-Volume keys for the five content lanes.
 *  Each lane shows two per-category keys (Pro / Location) in the lane's natural
 *  real-world unit. Values are seeded from the category's EA-table row; the
 *  display unit is converted back to the internal decay-adjusted target on save. */

export type LaneVolumeKey = "reviews" | "articles" | "qa" | "videos" | "audio";

export interface VolumeConfig {
  unit: string;
  /** internal_target = display_value x factor */
  factor: number;
  source: string;
}

export const VOLUME_CONFIG: Record<LaneVolumeKey, VolumeConfig> = {
  reviews: { unit: "reviews/year", factor: 1, source: "exp_category_ear" },
  articles: { unit: "articles/year", factor: 0.75, source: "exp_category_eaa" },
  qa: { unit: "answers (lifetime)", factor: 1, source: "exp_category_eaq" },
  videos: { unit: "videos/year", factor: 1, source: "exp_category_eav" },
  audio: { unit: "audio pieces/year", factor: 1, source: "default (pro 3 / location 8)" },
};

function toDisplay(internal: number | null | undefined, factor: number) {
  if (internal === null || internal === undefined) return null;
  const d = internal / factor;
  return Math.round(d * 100) / 100;
}

interface KeyRowProps {
  gcid: string;
  lane: LaneVolumeKey;
  scope: "professional" | "location";
  categoryLabel: string;
  internal: number | null | undefined;
  onSaved: () => void;
}

function KeyRow({ gcid, lane, scope, categoryLabel, internal, onSaved }: KeyRowProps) {
  const cfg = VOLUME_CONFIG[lane];
  const { canEdit, logAudit } = useRole();
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<string>(String(toDisplay(internal, cfg.factor) ?? ""));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = toDisplay(internal, cfg.factor);
  const label = scope === "professional" ? "Pro Expected Volume" : "Location Expected Volume";
  const scopeWord = scope === "professional" ? "Pro" : "Location";

  const beginEdit = () => {
    setDraft(String(display ?? ""));
    setUnlocked(true);
    setError(null);
  };

  const save = async () => {
    const num = Number(draft);
    if (!Number.isFinite(num) || num < 0) {
      setError("Enter a number of 0 or more.");
      return;
    }
    setSaving(true);
    setError(null);
    const internalValue = num * cfg.factor;
    const { error: rpcError } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>)("exp_set_expected_volume", {
      p_gcid: gcid,
      p_lane: lane,
      p_scope: scope,
      p_value: internalValue,
      p_rationale: `Expected volume for ${lane}/${scope} set to ${num} ${cfg.unit} from the math view`,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await logAudit("set_expected_volume", gcid, {
      lane,
      scope,
      display_value: num,
      unit: cfg.unit,
      internal_value: internalValue,
    });
    setConfirming(false);
    setUnlocked(false);
    onSaved();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        {unlocked ? (
          <div className="mt-1 flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode="decimal"
              className="h-8 w-28 font-mono text-sm"
            />
            <span className="text-xs text-slate-500">{cfg.unit}</span>
          </div>
        ) : (
          <div className="mt-0.5 text-sm font-mono text-slate-900">
            {display ?? "—"} <span className="text-xs font-sans text-slate-500">{cfg.unit}</span>
          </div>
        )}
        {error && <div className="mt-1 text-[11px] text-red-600">{error}</div>}
      </div>

      <div className="flex items-center gap-2">
        {unlocked ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              <LockOpen className="h-3 w-3" />
              unlocked
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUnlocked(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => setConfirming(true)}>
              Save
            </Button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Lock className="h-3 w-3" />
              locked
            </span>
            {canEdit && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={beginEdit}>
                Unlock
              </Button>
            )}
          </>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change expected volume?</DialogTitle>
            <DialogDescription>
              This changes the expected volume for every {scopeWord} in {categoryLabel} and re-runs the scoring
              math. Continue?
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600">
            {display ?? "—"} → {draft} {cfg.unit} ({cfg.source})
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ExpectedVolumeKeys({
  gcid,
  lane,
  categoryLabel,
  proInternal,
  locationInternal,
  onSaved,
}: {
  gcid: string;
  lane: LaneVolumeKey;
  categoryLabel: string;
  proInternal: number | null | undefined;
  locationInternal: number | null | undefined;
  onSaved: () => void;
}) {
  const cfg = VOLUME_CONFIG[lane];
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Expected Volume keys — {cfg.unit}
        </div>
        <div className="text-[10px] font-mono text-slate-400">{cfg.source}</div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <KeyRow
          gcid={gcid}
          lane={lane}
          scope="professional"
          categoryLabel={categoryLabel}
          internal={proInternal}
          onSaved={onSaved}
        />
        <KeyRow
          gcid={gcid}
          lane={lane}
          scope="location"
          categoryLabel={categoryLabel}
          internal={locationInternal}
          onSaved={onSaved}
        />
      </div>
      {cfg.factor !== 1 && (
        <div className="mt-2 text-[11px] text-slate-400">
          Shown in {cfg.unit}; stored internally as the decay-adjusted target (display × {cfg.factor}).
        </div>
      )}
    </div>
  );
}
