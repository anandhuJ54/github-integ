import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadNotifications, markNotificationRead, type Notification } from "@/lib/contracts";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["m4-notifications"], queryFn: () => loadNotifications(20), refetchInterval: 60_000 });
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const open = async (n: Notification) => {
    if (!n.read_at) {
      try { await markNotificationRead(n.id); } catch { /* still navigate */ }
      void qc.invalidateQueries({ queryKey: ["m4-notifications"] });
    }
    if (n.link) {
      if (/^https?:\/\//.test(n.link)) window.location.href = n.link;
      else void navigate({ to: n.link });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative my-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#e7ebf1] bg-white text-[#4a5670] shadow-[0_2px_6px_-3px_rgba(16,26,46,.2)] transition-colors hover:text-[#2f6bff]">
          <Bell className="h-4 w-4" />
          {unread ? (
            <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-md bg-[linear-gradient(135deg,#2f6bff,#5b8cff)] px-1 text-center text-[10px] font-bold leading-[18px] text-white tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] rounded-[10px] border-[#e7ebf1] p-0 shadow-[0_16px_40px_-16px_rgba(16,26,46,.35)]">
        <div className="flex items-center justify-between border-b border-[#e7ebf1] px-4 py-3">
          <p className="text-sm font-semibold text-[#101a2e]">Notifications</p>
          <span className="text-[11px] text-[#66728a] tabular-nums">{unread} unread</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {q.isLoading ? (
            <p className="px-4 py-6 text-sm text-[#66728a]">Loading…</p>
          ) : q.error ? (
            <p className="px-4 py-6 text-sm text-[#c23a25]">{(q.error as Error).message}</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#66728a]">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <button key={n.id} onClick={() => void open(n)} className={`flex w-full gap-3 border-b border-[#e7ebf1] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[#f3f7ff] ${n.read_at ? "" : "bg-[#f7faff]"}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-[#2f6bff]"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[#101a2e]">{n.title}</span>
                  {n.body ? <span className="line-clamp-2 block text-xs text-[#4a5670]">{n.body}</span> : null}
                  <span className="mt-0.5 block text-[11px] text-[#8792a8]">{ago(n.created_at)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
