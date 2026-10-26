import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@v3/shared/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@v3/shared/components/ui/tabs";
import { cn } from "@v3/shared/components/utils/utils";

/* ─────────── Page header ─────────── */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start gap-4 pb-8", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-ink-3)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="truncate text-[26px] font-semibold leading-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[color:var(--color-ink-2)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ─────────── Page container ─────────── */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1400px] px-8 py-8", className)}>{children}</div>;
}

/* ─────────── Card ─────────── */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[20px] border border-[color:var(--color-hairline)] bg-card shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      {title || actions ? (
        <header className="flex items-start gap-3 border-b border-[color:var(--color-hairline)] px-6 py-4">
          <div className="min-w-0 flex-1">
            {title ? <h2 className="text-sm font-semibold text-ink">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-xs text-[color:var(--color-ink-2)]">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={cn("px-6 py-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─────────── Stat tile ─────────── */
const TONES = {
  blue: "text-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue-soft)]",
  green: "text-[#1e8e3e] bg-[color:var(--color-g-green-soft)]",
  yellow: "text-[#b06000] bg-[color:var(--color-g-yellow-soft)]",
  red: "text-[#c5221f] bg-[color:var(--color-g-red-soft)]",
  purple: "text-[#7b4ce0] bg-[color:var(--color-g-purple-soft)]",
  neutral: "text-[color:var(--color-ink-2)] bg-[color:var(--color-surface-3)]",
} as const;

export type StatTone = keyof typeof TONES;

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "blue",
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: StatTone;
  loading?: boolean;
}) {
  return (
    <div className="rounded-[20px] border border-[color:var(--color-hairline)] bg-card p-5 shadow-[var(--shadow-xs)] transition-shadow hover:shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-[color:var(--color-ink-3)]">
          {label}
        </p>
        {icon ? (
          <span className={cn("grid h-8 w-8 place-items-center rounded-full", TONES[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight text-ink">
        {loading ? <span className="inline-block h-7 w-20 animate-pulse rounded bg-[color:var(--color-surface-3)]" /> : value}
      </p>
      {hint ? <p className="mt-2 text-xs text-[color:var(--color-ink-3)]">{hint}</p> : null}
    </div>
  );
}

/* ─────────── Empty state ─────────── */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] text-center",
        compact ? "px-6 py-8" : "px-6 py-14",
      )}
    >
      {icon ? (
        <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-white text-[color:var(--color-ink-3)] shadow-[var(--shadow-xs)]">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-[color:var(--color-ink-2)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ─────────── Data table ─────────── */
export type Column<T> = {
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  cell: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  loading,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-[color:var(--color-surface-2)]" />
        ))}
      </div>
    );
  }
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" compact />}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[color:var(--color-hairline)]">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]",
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-[color:var(--color-hairline)] last:border-0 transition-colors",
                onRowClick && "cursor-pointer hover:bg-[color:var(--color-surface-2)]",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-3 py-3 align-middle text-ink",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────── Detail drawer ─────────── */
export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  aside,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Optional second column (e.g. a live preview); widens the drawer when present. */
  aside?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex h-full w-full flex-col gap-0 p-0",
          aside ? "sm:max-w-[min(1180px,96vw)]" : "sm:max-w-lg",
        )}
      >
        <SheetHeader className="border-b border-[color:var(--color-hairline)] px-6 py-4">
          <SheetTitle className="text-base text-ink">{title}</SheetTitle>
          {description ? (
            <p className="text-xs text-[color:var(--color-ink-2)]">{description}</p>
          ) : null}
        </SheetHeader>
        {aside ? (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 lg:max-w-lg lg:border-r lg:border-[color:var(--color-hairline)]">
              {children}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[color:var(--color-surface-2)] px-6 py-5">
              {aside}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
        )}
        {footer ? (
          <div className="shrink-0 border-t border-[color:var(--color-hairline)] px-6 py-4">{footer}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/* ─────────── Console tabs ─────────── */
export function ConsoleTabs({
  tabs,
  defaultValue,
  className,
}: {
  tabs: { value: string; label: string; content: ReactNode }[];
  defaultValue?: string;
  className?: string;
}) {
  return (
    <Tabs defaultValue={defaultValue ?? tabs[0]?.value} className={cn("w-full", className)}>
      <TabsList className="h-auto w-full justify-start gap-1 rounded-full bg-[color:var(--color-surface-3)] p-1">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="rounded-full px-4 py-1.5 text-sm data-[state=active]:bg-white data-[state=active]:text-[color:var(--color-g-blue)] data-[state=active]:shadow-[var(--shadow-xs)]"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="mt-6">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/* ─────────── Placeholder surface ─────────── */
export function SurfaceStub({
  eyebrow,
  title,
  description,
  bullets,
}: {
  eyebrow: string;
  title: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <PageBody>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <Panel title="Coming next">
        {bullets?.length ? (
          <ul className="space-y-2.5">
            {bullets.map((b) => (
              <li key={b} className="flex gap-3 text-sm text-[color:var(--color-ink-2)]">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--color-g-blue)]" />
                {b}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Not built yet" description="This surface is routed and reserved." compact />
        )}
      </Panel>
    </PageBody>
  );
}
