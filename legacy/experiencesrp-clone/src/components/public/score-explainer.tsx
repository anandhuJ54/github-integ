import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const PARTS = [
  {
    title: "Reviews & sentiment",
    body: "Verified review volume, average rating and how recent the feedback is.",
  },
  {
    title: "Proof of expertise",
    body: "Licences, certifications, credentials and years in the profession, each verified against a source.",
  },
  {
    title: "Profile completeness",
    body: "How much of the profile is filled in with real, sourced detail — services, areas served, languages, hours.",
  },
  {
    title: "Content & answers",
    body: "Published guides, articles and answers that show working knowledge of the subject.",
  },
  {
    title: "Local relevance",
    body: "Areas actually served, plus the offices, teams and brands the profile is connected to.",
  },
] as const;

/**
 * Shared transparency explainer for the Experience Score. Used on search
 * result surfaces and on profiles so the wording is identical everywhere.
 */
export function ScoreExplainer({ className, label = "How the Experience Score works" }: { className?: string; label?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-amber-800 underline-offset-2 hover:underline",
            className,
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" /> {label}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg rounded-lg">
        <DialogHeader>
          <DialogTitle className="font-editorial text-2xl">How the Experience Score works</DialogTitle>
          <DialogDescription>
            One score built from proof we can verify — never from advertising. Sponsored placements
            are always labelled and never change a score.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {PARTS.map((part) => (
            <li key={part.title} className="rounded-lg border border-stone-200 bg-[#fbfaf7] p-3">
              <p className="text-sm font-semibold text-slate-900">{part.title}</p>
              <p className="mt-1 text-sm leading-6 text-stone-600">{part.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-stone-500">
          Where a profile has not been scored yet, we show that plainly instead of estimating a
          number.
        </p>
      </DialogContent>
    </Dialog>
  );
}
