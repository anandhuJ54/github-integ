import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Upload, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@v3/shared/components/ui/sheet";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Label } from "@v3/shared/components/ui/label";
import { Switch } from "@v3/shared/components/ui/switch";
import { Checkbox } from "@v3/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import { PersonAvatar } from "@v3/shared/components/ui/entity-avatar";
import { useOptionalRole } from "@v3/state/access/roles";
import {
  loadSellerSetup,
  quarterStarts,
  saveSellerSetup,
  SELLER_ROLE_OPTIONS,
  uploadSellerPhoto,
  type SellerSetupInput,
} from "@v3/sales/utils/seller-setup";
import { cn } from "@v3/shared/components/utils/utils";

/* ─────────── layout bits (light Google style) ─────────── */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[color:var(--color-hairline)] bg-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint ? (
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--color-ink-2)]">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[12px] font-semibold text-[color:var(--color-ink-2)]">
        {label}
        {required ? <span className="ml-1 text-[#d93025]">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

const YEARS = [2024, 2025, 2026, 2027, 2028];

export function SellerSetupSheet({
  repId,
  open,
  onOpenChange,
  onSaved,
}: {
  /** null = create mode */
  repId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (repId: string) => void;
}) {
  const qc = useQueryClient();
  const role = useOptionalRole();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const fileRef = useRef<HTMLInputElement>(null);

  const setup = useQuery({
    queryKey: ["seller-setup", repId, year],
    queryFn: () => loadSellerSetup(repId, year),
    enabled: open,
  });

  /* form state */
  const [f, setF] = useState<SellerSetupInput>({
    repId: null,
    name: "",
    email: "",
    phone: "",
    title: "",
    photoUrl: null,
    hireDate: "",
    onDuty: true,
    backupRepId: null,
    role: "SRE",
    primaryGroupKey: "",
    extraVerticals: [],
    teamName: "",
    territoryId: null,
    brandLinkIds: [],
    year,
    quotas: [
      { target: 0, actual: 0 },
      { target: 0, actual: 0 },
      { target: 0, actual: 0 },
      { target: 0, actual: 0 },
    ],
    attributionTarget: null,
    sdrcloudUrl: "",
  });
  const patch = (p: Partial<SellerSetupInput>) => setF((prev) => ({ ...prev, ...p }));

  const d = setup.data;

  /* hydrate from DB whenever the loaded data changes */
  useEffect(() => {
    if (!d) return;
    const starts = quarterStarts(year);
    const quotas = starts.map((s) => {
      const row = d.quotas.find((q) => q.period_start === s);
      return { target: row?.target ?? 0, actual: row?.actual ?? 0 };
    });
    const mine = d.territories.find((t) => t.seller_id === (d.rep?.id ?? "__none"));
    setF((prev) => ({
      ...prev,
      repId: d.rep?.id ?? null,
      name: d.rep?.name ?? prev.name,
      email: d.rep?.email ?? "",
      phone: d.rep?.phone ?? "",
      title: d.rep?.title ?? "",
      photoUrl: d.rep?.photo_url ?? null,
      hireDate: d.rep?.hire_date ?? "",
      onDuty: d.rep?.on_duty ?? true,
      backupRepId: d.rep?.backup_rep_id ?? null,
      role: d.rep?.role ?? prev.role,
      primaryGroupKey: d.rep?.group_key ?? prev.primaryGroupKey,
      extraVerticals: d.verticals
        .map((v) => v.group_key)
        .filter((g) => g !== (d.rep?.group_key ?? "")),
      teamName: d.rep?.team_name ?? "",
      territoryId: mine?.id ?? null,
      brandLinkIds: mine ? d.brandLinks.filter((b) => b.territoryId === mine.id).map((b) => b.linkId) : [],
      year,
      quotas,
      attributionTarget: d.rep?.attribution_target ?? null,
      sdrcloudUrl: d.rep?.sdrcloud_url ?? "",
    }));
  }, [d, year]);

  const groupOptions = d?.groups ?? [];
  const slots = useMemo(
    () =>
      (d?.territories ?? []).filter(
        (t) => t.group_key === f.primaryGroupKey && (t.tier ?? "") === f.role,
      ),
    [d?.territories, f.primaryGroupKey, f.role],
  );
  const verticalBrands = useMemo(() => {
    const ids = new Set(
      (d?.territories ?? []).filter((t) => t.group_key === f.primaryGroupKey).map((t) => t.id),
    );
    return (d?.brandLinks ?? []).filter((b) => ids.has(b.territoryId));
  }, [d?.brandLinks, d?.territories, f.primaryGroupKey]);

  const [uploading, setUploading] = useState(false);
  async function onPickPhoto(file: File) {
    setUploading(true);
    try {
      const url = await uploadSellerPhoto(file, repId);
      patch({ photoUrl: url });
      toast.success("Photo uploaded — save to keep it");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const save = useMutation({
    mutationFn: () => saveSellerSetup({ ...f, year }),
    onSuccess: (res) => {
      toast.success(repId ? "Seller updated" : "Seller created");
      void role?.logAudit("seller_upsert", res.repId, {
        mode: repId ? "edit" : "create",
        name: f.name,
        role: f.role,
        group_key: f.primaryGroupKey,
        territory_id: f.territoryId,
        year,
        changes: res.changes,
      });
      for (const key of [
        "seller-setup",
        "seller-desk",
        "teams-summary",
        "group-teams",
        "brand-links",
        "sales-board",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
      onSaved?.(res.repId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !!f.name.trim() && !!f.role && !!f.primaryGroupKey && !save.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-[color:var(--color-surface-2)] sm:max-w-2xl"
      >
        <SheetHeader className="mb-5">
          <SheetTitle>{repId ? "Edit user" : "Add seller"}</SheetTitle>
          <SheetDescription>
            Everything on this form writes to live tables — identity, employment, verticals,
            territory, logos and quarterly quotas.
          </SheetDescription>
        </SheetHeader>

        {setup.isLoading ? (
          <p className="text-sm text-[color:var(--color-ink-2)]">Loading current setup…</p>
        ) : (
          <div className="space-y-4 pb-28">
            {/* Identity */}
            <Section title="Identity" hint="exp_sales_reps · name, email, phone, title, photo_url">
              <div className="mb-4 flex items-center gap-4">
                <PersonAvatar name={f.name || "New seller"} photoUrl={f.photoUrl} size="xl" />
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onPickPhoto(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-3.5 w-3.5" />
                    )}
                    {f.photoUrl ? "Replace photo" : "Upload photo"}
                  </Button>
                  {f.photoUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-1 text-[color:var(--color-ink-2)]"
                      onClick={() => patch({ photoUrl: null })}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" required>
                  <Input value={f.name} onChange={(e) => patch({ name: e.target.value })} />
                </Field>
                <Field label="Title">
                  <Input
                    value={f.title ?? ""}
                    placeholder="Search Rank Expert"
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={f.email ?? ""}
                    onChange={(e) => patch({ email: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input value={f.phone ?? ""} onChange={(e) => patch({ phone: e.target.value })} />
                </Field>
              </div>
            </Section>

            {/* Employment */}
            <Section title="Employment" hint="exp_sales_reps · hire_date, on_duty, backup_rep_id">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Hire date">
                  <Input
                    type="date"
                    value={f.hireDate ?? ""}
                    onChange={(e) => patch({ hireDate: e.target.value })}
                  />
                </Field>
                <Field label="Backup rep (routing fallback)">
                  <Select
                    value={f.backupRepId ?? "__none"}
                    onValueChange={(v) => patch({ backupRepId: v === "__none" ? null : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">None</SelectItem>
                      {(d?.reps ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Switch checked={f.onDuty} onCheckedChange={(v) => patch({ onDuty: v })} />
                  <span className="text-[13px] text-ink">
                    On duty — leads route to this seller now
                  </span>
                </div>
              </div>
            </Section>

            {/* Role + verticals + team */}
            <Section
              title="Role, verticals and team"
              hint="exp_sales_reps · role, group_key, team_name — extra verticals in exp_sales_rep_verticals"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sales level" required>
                  <Select value={f.role} onValueChange={(v) => patch({ role: v, territoryId: null })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SELLER_ROLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Primary vertical" required>
                  <Select
                    value={f.primaryGroupKey || undefined}
                    onValueChange={(v) =>
                      patch({ primaryGroupKey: v, territoryId: null, brandLinkIds: [] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a category group" />
                    </SelectTrigger>
                    <SelectContent>
                      {groupOptions.map((g) => (
                        <SelectItem key={g.group_key} value={g.group_key}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Team name" className="sm:col-span-2">
                  <Input
                    value={f.teamName ?? ""}
                    placeholder="Team 1"
                    list="seller-team-names"
                    onChange={(e) => patch({ teamName: e.target.value })}
                  />
                  <datalist id="seller-team-names">
                    {(d?.teamNames ?? []).map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </Field>
              </div>

              <div className="mt-4">
                <Label className="text-[12px] font-semibold text-[color:var(--color-ink-2)]">
                  Additional verticals
                </Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.extraVerticals.length === 0 ? (
                    <span className="text-[12px] text-[color:var(--color-ink-3)]">
                      None beyond the primary vertical.
                    </span>
                  ) : null}
                  {f.extraVerticals.map((g) => (
                    <span
                      key={g}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-g-blue-soft)] px-3 py-1 text-[12px] font-semibold text-[color:var(--color-g-blue)]"
                    >
                      {groupOptions.find((x) => x.group_key === g)?.label ?? g}
                      <button
                        type="button"
                        onClick={() =>
                          patch({ extraVerticals: f.extraVerticals.filter((x) => x !== g) })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <Select
                  value="__add"
                  onValueChange={(v) => {
                    if (v === "__add") return;
                    if (v === f.primaryGroupKey || f.extraVerticals.includes(v)) return;
                    patch({ extraVerticals: [...f.extraVerticals, v] });
                  }}
                >
                  <SelectTrigger className="mt-3 w-full sm:w-72">
                    <span className="inline-flex items-center gap-2 text-[13px]">
                      <Plus className="h-3.5 w-3.5" /> Add a vertical
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__add" disabled>
                      Choose a category group
                    </SelectItem>
                    {groupOptions
                      .filter(
                        (g) =>
                          g.group_key !== f.primaryGroupKey &&
                          !f.extraVerticals.includes(g.group_key),
                      )
                      .map((g) => (
                        <SelectItem key={g.group_key} value={g.group_key}>
                          {g.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </Section>

            {/* Territory */}
            <Section
              title="Territory assignment"
              hint="exp_territories · seller_id + status. Slots shown match the chosen vertical and sales level."
            >
              {slots.length === 0 ? (
                <p className="text-[13px] text-[color:var(--color-ink-2)]">
                  No territory slots exist for this vertical at this level yet — generate them on the
                  Teams page first.
                </p>
              ) : (
                <Select
                  value={f.territoryId ?? "__none"}
                  onValueChange={(v) =>
                    patch({ territoryId: v === "__none" ? null : v, brandLinkIds: [] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Unassigned</SelectItem>
                    {slots.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                        {t.seller_id && t.seller_id !== f.repId ? " · taken" : ""}
                        {` · ${t.brand_count ?? 0} logos · ${t.agent_count ?? 0} profiles`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Section>

            {/* Logos */}
            <Section
              title="Logos assigned"
              hint="exp_territory_brand · ticking a logo moves that brand (and its offices and profiles) into this seller's slot."
            >
              {!f.territoryId ? (
                <p className="text-[13px] text-[color:var(--color-ink-2)]">
                  Pick a territory first — logos hang off the territory slot.
                </p>
              ) : verticalBrands.length === 0 ? (
                <p className="text-[13px] text-[color:var(--color-ink-2)]">
                  No brands are linked to this vertical's territories yet.
                </p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {verticalBrands.map((b) => {
                    const on = f.brandLinkIds.includes(b.linkId);
                    return (
                      <label
                        key={b.linkId}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-[color:var(--color-surface-2)]"
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) =>
                            patch({
                              brandLinkIds: v
                                ? [...f.brandLinkIds, b.linkId]
                                : f.brandLinkIds.filter((x) => x !== b.linkId),
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{b.name}</span>
                        <span className="text-[11px] text-[color:var(--color-ink-3)]">
                          {b.territoryId === f.territoryId ? "theirs" : b.territoryLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Quotas */}
            <Section
              title="Quarterly quotas"
              hint="exp_sales_quotas · period_type = quarter, one row per quarter start of the selected year."
            >
              <Field label="Year" className="mb-4 w-40">
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <p className="text-[12px] font-semibold text-ink">Q{i + 1}</p>
                    <Field label="Target">
                      <Input
                        type="number"
                        min={0}
                        value={String(f.quotas[i]?.target ?? 0)}
                        onChange={(e) => {
                          const q = [...f.quotas];
                          q[i] = { target: Number(e.target.value || 0), actual: q[i]?.actual ?? 0 };
                          patch({ quotas: q });
                        }}
                      />
                    </Field>
                    <Field label="Actual">
                      <Input
                        type="number"
                        min={0}
                        value={String(f.quotas[i]?.actual ?? 0)}
                        onChange={(e) => {
                          const q = [...f.quotas];
                          q[i] = { target: q[i]?.target ?? 0, actual: Number(e.target.value || 0) };
                          patch({ quotas: q });
                        }}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </Section>

            {/* Attribution + SSO */}
            <Section
              title="Attribution target and SDRCloud"
              hint="exp_sales_reps · attribution_target, sdrcloud_url"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Contract attribution target ($)">
                  <Input
                    type="number"
                    min={0}
                    value={f.attributionTarget == null ? "" : String(f.attributionTarget)}
                    onChange={(e) =>
                      patch({
                        attributionTarget: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="SDRCloud SSO URL">
                  <Input
                    value={f.sdrcloudUrl ?? ""}
                    placeholder="https://sdrcloud.experience.com/sso?seller=…"
                    onChange={(e) => patch({ sdrcloudUrl: e.target.value })}
                  />
                </Field>
              </div>
            </Section>
          </div>
        )}

        <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-[color:var(--color-hairline)] bg-card px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {repId ? "Save changes" : "Create seller"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
