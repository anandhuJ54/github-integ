import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Download, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContractPrintDocument, CONTRACT_PRINT_CSS } from "@/components/contracts/contract-print-document";
import { getContract } from "@/lib/contracts";
import { printDoc } from "@/lib/contract-print";

const contractQuery = (id: string) => queryOptions({ queryKey: ["m4-contract", id], queryFn: () => getContract(id) });

// Trailing underscores keep this leaf outside sales chrome and the detail workspace.
export const Route = createFileRoute("/_authenticated/sales_/contracts/$contractId_/print")({
  validateSearch: (search: Record<string, unknown>) => ({ doc: printDoc(search.doc) }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(contractQuery(params.contractId)),
  head: ({ match }) => {
    const certificate = match.search.doc === "certificate";
    const title = `${certificate ? "Completion certificate" : "Order form PDF"} — Experience.com Growth Hub`;
    const description = certificate ? "Print the contract completion certificate and recorded signer audit evidence." : "Print the assembled contract order form, signatures and exhibits.";
    return { meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex,nofollow" }] };
  },
  errorComponent: ({ error }) => <main className="contract-print"><style>{CONTRACT_PRINT_CSS}</style><article className="print-paper"><h1>Contract unavailable</h1><p>{error instanceof Error ? error.message : "Unable to load this contract."}</p></article></main>,
  component: ContractPrintPage,
});

function ContractPrintPage() {
  const { contractId } = Route.useParams();
  const { doc } = Route.useSearch();
  const { data } = useSuspenseQuery(contractQuery(contractId));
  return <main className="contract-print">
    <style>{CONTRACT_PRINT_CSS}</style>
    <nav className="print-toolbar" aria-label="Document actions">
      <Button variant="outline" asChild><Link to="/sales/contracts/$contractId" params={{ contractId }}><ArrowLeft className="h-4 w-4" />Back to contract</Link></Button>
      <Button onClick={() => window.print()}><Download className="h-4 w-4" />Download PDF</Button>
    </nav>
    <ContractPrintDocument D={data} doc={doc} />
  </main>;
}