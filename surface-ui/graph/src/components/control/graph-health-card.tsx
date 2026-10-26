import { useQuery } from "@tanstack/react-query";
import { api } from "@v3/state/api/server-fn";
import { Card, CardContent, CardHeader, CardTitle } from "@v3/shared/components/ui/card";
import { Badge } from "@v3/shared/components/ui/badge";
import { cn } from "@v3/shared/components/utils/utils";

type CheckRow = { check_code: string; passed: boolean; detail: string };

/** Graph Health — live rows from exp_validate_graph(). */
export function GraphHealthCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["exp_validate_graph"],
    queryFn: () => api.get<CheckRow[]>("/graph/control/validate"),
  });

  const rows = data ?? [];
  const passed = rows.filter((r) => r.passed).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Graph Health</CardTitle>
        {rows.length > 0 && (
          <Badge
            variant="secondary"
            className={cn(
              passed === rows.length
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800",
            )}
          >
            {passed} / {rows.length} passing
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-xs text-slate-500">Running graph checks…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-slate-500">No checks returned.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {rows.map((v) => (
              <div
                key={v.check_code}
                className={cn(
                  "flex items-start gap-2 text-xs rounded-md px-2.5 py-1.5 border",
                  v.passed
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-amber-200 bg-amber-50/50",
                )}
              >
                <span
                  className={cn(
                    "font-mono shrink-0",
                    v.passed ? "text-emerald-700" : "text-amber-700",
                  )}
                >
                  {v.passed ? "✓" : "✗"}
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[11px] text-slate-700">{v.check_code}</div>
                  <div className="text-[11px] text-slate-500 truncate">{v.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
