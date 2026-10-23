import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { loadAssignments, loadReps, SELLER_ROLES, territoryFor, type SellerRole } from "@/lib/sales";
import { PersonAvatar } from "@/components/sales/entity-avatar";


const STORAGE_KEY = "xp.sales.viewAsRep";

export function useSalesContext() {
  const reps = useQuery({ queryKey: ["sales-reps"], queryFn: loadReps });
  const assignments = useQuery({ queryKey: ["sales-assignments"], queryFn: loadAssignments });
  const [repId, setRepId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored) setRepId(stored);
  }, []);

  // Default to the signed-in user's own rep record when one exists.
  useEffect(() => {
    if (repId || !email || !reps.data?.length) return;
    const mine = reps.data.find((r) => r.email?.toLowerCase() === email.toLowerCase());
    if (mine) setRepId(mine.id);
    else setRepId(reps.data[0]?.id ?? null);
  }, [email, reps.data, repId]);

  const select = (id: string | null) => {
    setRepId(id);
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const rep = reps.data?.find((r) => r.id === repId) ?? null;
  const isOwnRecord = !!rep && !!email && rep.email?.toLowerCase() === email.toLowerCase();
  const territory = territoryFor(repId, assignments.data ?? []);

  return {
    reps: reps.data ?? [],
    assignments: assignments.data ?? [],
    loading: reps.isLoading || assignments.isLoading,
    rep,
    repId,
    email,
    isOwnRecord,
    territory,
    select,
  };
}

export function RepPicker({
  reps,
  repId,
  onSelect,
  allowAll = true,
}: {
  reps: {
    id: string;
    name: string;
    role: string;
    group_key: string;
    photo_url?: string | null;
  }[];
  repId: string | null;
  onSelect: (id: string | null) => void;
  allowAll?: boolean;
}) {
  return (
    <Select value={repId ?? "all"} onValueChange={(v) => onSelect(v === "all" ? null : v)}>
      <SelectTrigger className="h-9 w-[280px]">
        <SelectValue placeholder="View as rep" />
      </SelectTrigger>
      <SelectContent>
        {allowAll ? <SelectItem value="all">Whole group (all territories)</SelectItem> : null}
        {reps.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            <span className="flex items-center gap-2">
              <PersonAvatar name={r.name} photoUrl={r.photo_url} size="xs" ring={false} />
              <span>
                {r.name} — {SELLER_ROLES[r.role as SellerRole]?.label ?? r.role}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>

    </Select>
  );
}
