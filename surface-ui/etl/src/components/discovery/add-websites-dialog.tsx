import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Button } from "@v3/ui/components/ui/button";
import { Textarea } from "@v3/ui/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@v3/ui/components/ui/dialog";
import { useRole } from "@v3/ui/lib/roles";

/* Manual add (2026-10-16): websites the discovery did not find are added to the category's pending company list
   (disco_add_companies_manual) and approved with the same checklist. One website per line: "domain" or "Name, domain".
   Existing sources of the category are never changed; invalid, duplicate or already-listed entries are skipped with
   the reason. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Result = { proposal_id: number | null; added: string[]; skipped: { domain: string; reason: string }[] };

export function AddWebsitesButton({ gcid }: { gcid: string }) {
  const qc = useQueryClient();
  const { logAudit } = useRole();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const add = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("disco_add_companies_manual", { p_category: gcid, p_entries: lines });
      if (error) throw error;
      return data as Result;
    },
    onSuccess: async (r) => {
      setResult(r);
      if (r.added.length) {
        toast.success(`${r.added.length} website${r.added.length === 1 ? "" : "s"} added to the list — tick and approve them below`);
        setText("");
      } else {
        toast.info("Nothing added — see the reasons");
      }
      await logAudit("etl_companies_added_manually", gcid, { added: r.added, skipped: r.skipped });
      qc.invalidateQueries({ queryKey: ["disco_proposal", gcid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setResult(null); setOpen(true); }}>
        <Plus className="h-3.5 w-3.5" /> Add websites
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!add.isPending) setOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add websites to this category</DialogTitle>
            <DialogDescription>
              One website per line, as <span className="font-mono">domain</span> or <span className="font-mono">Name, domain</span>.
              They join the company list marked “manual”; approve them there like the others.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Northwestern Mutual, northwesternmutual.com\nweichert.com"}
            className="min-h-[140px] font-mono text-xs"
          />
          <p className={lines.length > 100 ? "text-xs text-red-700" : "text-xs text-slate-500"}>
            {lines.length} line{lines.length === 1 ? "" : "s"}{lines.length > 100 ? " — at most 100 at a time" : ""}.
            Websites already in this category are skipped and never changed.
          </p>
          {result ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="font-semibold text-slate-700">
                {result.added.length} added{result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}
              </div>
              {result.added.length ? <div className="mt-1 text-slate-600">Added: {result.added.join(", ")}</div> : null}
              {result.skipped.length ? (
                <ul className="mt-1 space-y-0.5 text-slate-600">
                  {result.skipped.map((s, i) => <li key={`${s.domain}-${i}`}><span className="font-mono">{s.domain}</span> — {s.reason}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={add.isPending} onClick={() => setOpen(false)}>Close</Button>
            <Button disabled={add.isPending || lines.length === 0 || lines.length > 100} onClick={() => add.mutate()}>
              {add.isPending ? "Adding…" : "Add to the list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
