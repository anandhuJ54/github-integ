import { growthHubStyles } from "@v3/sales/components/sales/growth-hub-styles";
import type { ReactNode } from "react";
import { FileText, Printer } from "lucide-react";
import { Button } from "@v3/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@v3/shared/components/ui/dialog";
import { CATALOG } from "@v3/sales/utils/cpq-catalog";
import type { DealPricing } from "@v3/sales/utils/cpq-pricing";
import type { CpqLine } from "@v3/sales/utils/sales-cpq";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("en-US");

export type InvoiceLine = CpqLine & { section: "Subscription" | "Included Platform Skills" | "Products" | "Enterprise"; description?: string | null; included?: boolean; passthrough?: boolean; listValue?: number };

export function QuoteInvoice({ open, onOpenChange, quoteId, accountName, lines, deal, referralPartner }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  accountName: string;
  lines: InvoiceLine[];
  deal: DealPricing;
  referralPartner: number;
}) {
  const sections = ["Subscription", "Included Platform Skills", "Products", "Enterprise"] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cpq-invoice max-h-[94vh] max-w-5xl overflow-y-auto p-0 print:static print:max-h-none print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:border-0 print:shadow-none">
        <style>{growthHubStyles(".cpq-invoice") + INVOICE_CSS}</style><DialogHeader className="sr-only"><DialogTitle>Quote invoice</DialogTitle><DialogDescription>Itemized quote and entitlements addendum.</DialogDescription></DialogHeader>
        <div className="sticky top-0 z-10 flex justify-end border-b bg-background px-8 py-3 print:hidden">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print invoice</Button>
        </div>
        <InvoicePage page="1 / 2">
          <header className="flex items-start justify-between border-b pb-8">
            <div><p className="text-xs font-bold uppercase text-muted-foreground">Experience.com</p><h2 className="mt-2 text-3xl font-semibold">Annual subscription quote</h2><p className="mt-2 text-sm text-muted-foreground">Prepared for {accountName || "Customer"}</p></div>
            <div className="text-right text-sm"><p className="font-semibold">{quoteId}</p><p className="text-muted-foreground">Provisional entitlements</p><p className="mt-1 text-muted-foreground">Quoted, not live</p></div>
          </header>
          <div className="mt-8 space-y-8">
            {sections.map((section) => {
              const grouped = lines.filter((line) => line.section === section);
              if (!grouped.length) return null;
              return <section key={section}><h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{section}</h3><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Entitlement</th><th>Count</th><th>Rate</th><th className="text-right">Annual</th></tr></thead><tbody>{grouped.map((line, index) => <tr key={`${line.productKey}-${index}`} className="border-b"><td className="py-3"><span className="font-medium">{line.label}</span>{line.passthrough ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">NO DISCOUNT</span> : null}</td><td>{number.format(line.qty)}</td><td>{line.included ? "$0 included" : money.format(line.unitPrice)}</td><td className="text-right font-medium">{line.included ? "$0" : money.format(line.net)}</td></tr>)}</tbody></table></section>;
            })}
          </div>
          <Totals deal={deal} referralPartner={referralPartner} />
        </InvoicePage>
        <InvoicePage page="2 / 2" className="print:break-before-page">
          <header className="border-b pb-6"><p className="text-xs font-bold uppercase text-muted-foreground">{quoteId}</p><h2 className="mt-2 text-3xl font-semibold">Entitlements Addendum</h2><p className="mt-2 text-sm text-muted-foreground">Schedule of provisional entitlements for {accountName || "Customer"}</p></header>
          <div className="mt-8 space-y-7">
            {sections.map((section) => {
              const grouped = lines.filter((line) => line.section === section);
              if (!grouped.length) return null;
              return <section key={section}><h3 className="border-b pb-2 text-xs font-bold uppercase text-muted-foreground">{section}</h3><div className="divide-y">{grouped.map((line, index) => <div key={`${line.productKey}-${index}`} className="grid grid-cols-[140px_1fr] gap-5 py-3 text-sm"><div><p className="font-semibold">{number.format(line.qty)} entitlement{line.qty === 1 ? "" : "s"}</p><p className="text-xs text-muted-foreground">{line.included ? "Included" : line.passthrough ? "Pass-through" : money.format(line.unitPrice)}</p></div><div><p className="font-semibold">{line.label}</p><p className="mt-1 leading-relaxed text-muted-foreground">{line.description || CATALOG.products[line.productKey]?.description || "Catalog entitlement."}</p></div></div>)}</div></section>;
            })}
            <section><h3 className="border-b pb-2 text-xs font-bold uppercase text-muted-foreground">Terms</h3><div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground"><p><strong className="text-foreground">Entitlement scope.</strong> Counts apply only to the locations, professionals, users, profiles, credits, projects, or hours stated above.</p><p><strong className="text-foreground">Included items.</strong> Included Platform Skills carry no separate charge while the selected base package remains active.</p><p><strong className="text-foreground">Credits and overage.</strong> Credit balances and any overage are governed by the contracted wallet and catalog rate.</p><p><strong className="text-foreground">Google Ads pass-through.</strong> Media spend is billed at cost, receives no discount, and is non-commissionable.</p><p><strong className="text-foreground">Taxes.</strong> Applicable taxes are additional unless expressly stated otherwise.</p><p><strong className="text-foreground">Precedence.</strong> The signed agreement controls if this schedule conflicts with master terms.</p></div></section>
          </div>
        </InvoicePage>
      </DialogContent>
    </Dialog>
  );
}

function InvoicePage({ page, className, children }: { page: string; className?: string; children: ReactNode }) {
  return <article className={`mx-auto min-h-[1056px] w-full max-w-[816px] bg-background px-12 py-10 ${className ?? ""}`} data-invoice-page={page.startsWith("1") ? "1" : "2"}>{children}<footer className="mt-12 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> Experience.com confidential</span><span>Page {page}</span></footer></article>;
}

function Totals({ deal, referralPartner }: { deal: DealPricing; referralPartner: number }) {
  return <dl className="ml-auto mt-10 w-full max-w-sm space-y-2 text-sm"><Row name="Products subtotal" value={deal.subtotal} /><Row name={`Volume discount (${deal.volumePct}%)`} value={-deal.volumeDiscount} /><Row name="Platform fee" value={deal.platformFee} /><Row name="Voluntary write-down" value={-deal.writeDown} /><Row name="Ad pass-through (no discount)" value={deal.passthrough} /><div className="flex justify-between border-t pt-3 text-base font-bold"><dt>Annual contract value</dt><dd>{money.format(deal.acv)}</dd></div>{referralPartner ? <p className="pt-2 text-right text-xs text-muted-foreground">Referral / partner adjustment: {money.format(referralPartner)}</p> : null}</dl>;
}

function Row({ name, value }: { name: string; value: number }) { return <div className="flex justify-between"><dt className="text-muted-foreground">{name}</dt><dd>{money.format(value)}</dd></div>; }
const INVOICE_CSS = `.cpq-invoice{border-radius:16px;border:1px solid var(--gh-line);box-shadow:var(--gh-shadow);padding:0}.cpq-invoice>button{z-index:20}.cpq-invoice>div.sticky{padding-right:52px}.cpq-invoice article{background:var(--gh-surface)}.cpq-invoice article>header{border-top:4px solid var(--gh-blue);padding-top:20px}.cpq-invoice th{padding:10px 8px}.cpq-invoice td{padding:12px 8px}.cpq-invoice h2{color:var(--gh-ink)}@media(max-width:640px){.cpq-invoice article{padding:24px 16px;min-height:0}.cpq-invoice article>header{flex-wrap:wrap;gap:16px}.cpq-invoice .grid{grid-template-columns:1fr;gap:6px}}@media print{.cpq-invoice article>header{border-top:0}.cpq-invoice tbody tr:hover{background:transparent}}`;
