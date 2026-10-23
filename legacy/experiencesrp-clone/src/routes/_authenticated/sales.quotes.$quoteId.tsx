import { growthHubStyles } from "@/components/sales/growth-hub-styles";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { createContractFromQuote } from "@/lib/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, FileText, Info, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageBody, PageHeader, Panel } from "@/components/console/primitives";
import { QuoteInvoice, type InvoiceLine } from "@/components/sales/quote-invoice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { CATALOG, STEPS, catalogAnnualRate, catalogPrice, loadCatalog, type PackageId } from "@/lib/cpq-catalog";
import { evaluateApproval, creditCogs, loadPricingContext, type PricedLine } from "@/lib/cpq-depth";
import { priceDeal, safeNumber, validateState, volumeTierPct } from "@/lib/cpq-pricing";
import { normalizePackageInclusions, type QuoteState } from "@/lib/cpq-state";
import { buildLineItems, commitEntitlements, listAccounts, loadContractApproval, loadQuote, saveQuote, writeLocalDraft } from "@/lib/sales-cpq";
import { setMarginApproval } from "@/lib/sales";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/sales/quotes/$quoteId")({
  head: ({ params }) => ({ meta: [
    { title: `Quote ${params.quoteId} — Experience.com CPQ` },
    { name: "description", content: "Build a catalog-priced Experience.com quote and review its entitlement schedule." },
    { property: "og:title", content: `Quote ${params.quoteId} — Experience.com CPQ` },
    { property: "og:description", content: "Catalog-driven quote builder and entitlement schedule." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: QuotePage,
});

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-US");
const PLATFORM_INCLUSIONS = "Enterprise features, controls, hierarchy, 1 standard ingestion connection, AI training, reporting, onboarding + first 3 campaigns";
const PRODUCT_KEYS = ["listings", "voce", "conversion_agents", "sponsored"];
const ENTERPRISE_KEYS = ["enterprise_first_publishing", "add_credits", "campaigns", "benchmark", "custom_integration", "custom_development", "voce_boosts"];

function Num({ value, onChange, min = 0, step = 1, prefix, className }: { value: number; onChange: (n: number) => void; min?: number; step?: number; prefix?: string; className?: string }) {
  return <div className={cn("relative", className)}>{prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span> : null}<Input type="number" min={min} step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(safeNumber(event.target.value))} className={cn("h-9 text-right tabular-nums", prefix && "pl-7")} /></div>;
}

function QuotePage() {
  const { quoteId } = Route.useParams();
  const quote = useQuery({ queryKey: ["cpq-quote", quoteId], queryFn: () => loadQuote(quoteId) });
  const catalog = useQuery({ queryKey: ["cpq-catalog"], queryFn: loadCatalog });
  const [state, setState] = useState<QuoteState | null>(null);
  useEffect(() => { if (quote.data) setState(quote.data.state); }, [quote.data, quoteId]);
  if (catalog.error) return <PageBody className="cpq-builder"><style>{growthHubStyles(".cpq-builder") + BUILDER_CSS}</style><PageHeader eyebrow="Growth Hub · CPQ" title={`Quote ${quoteId}`} /><p className="text-sm text-destructive">Could not load the product catalog: {(catalog.error as Error).message}</p></PageBody>;
  if (!state || !catalog.data) return <PageBody className="cpq-builder"><style>{growthHubStyles(".cpq-builder") + BUILDER_CSS}</style><PageHeader eyebrow="Growth Hub · CPQ" title={`Quote ${quoteId}`} /><div className="h-64 animate-pulse rounded-lg bg-muted" /></PageBody>;
  return <Configurator state={state} setState={setState} saved={!!quote.data?.saved} />;
}

function Configurator({ state, setState, saved }: { state: QuoteState; setState: (state: QuoteState) => void; saved: boolean }) {
  const pricingContext = useQuery({ queryKey: ["cpq-pricing-context"], queryFn: loadPricingContext });
  const accounts = useQuery({ queryKey: ["cpq-accounts"], queryFn: listAccounts });
  const [accountSearch, setAccountSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { quoteId: routeQuoteId } = Route.useParams();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const ctx = pricingContext.data ?? { tiers: [], book: [], products: [] };
  const productQuantities = state.productQuantities ?? {};
  const enterpriseQuantities = state.enterpriseQuantities ?? {};
  const totalProfiles = safeNumber(state.professionals) + safeNumber(state.locations);
  const rawLines = useMemo(() => buildLineItems(state), [state]);
  const creditUtilization = Math.max(CATALOG.config.creditFloorPct, Math.min(100, state.creditUtilizationPct ?? 100));
  const creditsOn = (state.pricingModel ?? "ppu") === "credits";
  const pricedLines = useMemo(() => rawLines.map((line) => {
    const utilization = creditsOn && CATALOG.products[line.productKey]?.creditable ? creditUtilization / 100 : 1;
    return { ...line, unitPrice: line.unitPrice * utilization, net: line.net * utilization, tier: null, baseUnitPrice: line.unitPrice, baseNet: line.net };
  }) as PricedLine[], [rawLines, creditsOn, creditUtilization]);
  const deal = useMemo(() => priceDeal(pricedLines, totalProfiles, state.discount), [pricedLines, totalProfiles, state.discount]);
  const approval = useMemo(() => evaluateApproval(pricedLines, deal.writeDown, ctx.book, deal.writeDownPct / 100), [pricedLines, deal.writeDown, deal.writeDownPct, ctx.book]);
  const validation = useMemo(() => {
    const result = validateState(state);
    const errors = state.accountId ? result.errors : ["Select a customer account before continuing.", ...result.errors];
    return { ...result, errors, valid: errors.length === 0 };
  }, [state]);
  const contractId = state.contractId ?? null;
  const contractApproval = useQuery({ queryKey: ["cpq-contract-approval", contractId], queryFn: () => loadContractApproval(contractId ?? ""), enabled: !!contractId });
  const approvalState = contractApproval.data?.approval_state ?? null;
  const approved = !approval.needsApproval || approvalState === "approved";
  const creditableGross = rawLines.filter((line) => CATALOG.products[line.productKey]?.creditable).reduce((sum, line) => sum + line.net, 0);
  const walletCredits = CATALOG.config.creditPrice > 0 ? creditableGross / CATALOG.config.creditPrice : 0;
  const purchasedCredits = walletCredits * creditUtilization / 100;
  const creditTierPct = volumeTierPct(totalProfiles);
  const discountedCreditRate = CATALOG.config.creditPrice * (1 - creditTierPct / 100);
  const perUserPrice = creditableGross * (1 - creditTierPct / 100);
  const walletPrice = purchasedCredits * discountedCreditRate;
  const underUtilizationGap = perUserPrice - walletPrice;
  const llmCost = creditCogs(creditsOn ? purchasedCredits : 0, CATALOG.config.llmCostBasis);
  const referralPartner = safeNumber(state.referralPartner);
  const commissionable = Math.max(0, deal.acv - deal.passthrough - llmCost - referralPartner);
  const accountMatches = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return (accounts.data ?? []).filter((account) => !query || [account.name, account.industry, account.account_type, account.city].some((value) => value?.toLowerCase().includes(query))).slice(0, 6);
  }, [accounts.data, accountSearch]);

  const update = (mutate: (draft: QuoteState) => void, normalize = false) => {
    const draft = structuredClone(state);
    mutate(draft);
    const next = normalize ? normalizePackageInclusions(draft) : draft;
    writeLocalDraft(next);
    setState(next);
  };
  const setProductQty = (key: string, scope: "professionals" | "locations", value: number) => update((draft) => {
    draft.productQuantities = { ...(draft.productQuantities ?? {}), [key]: { professionals: draft.productQuantities?.[key]?.professionals ?? 0, locations: draft.productQuantities?.[key]?.locations ?? 0, [scope]: value } };
    if (key === "listings") { draft.addOns.listingsProfessionals = scope === "professionals" ? value : draft.addOns.listingsProfessionals; draft.addOns.listingsLocations = scope === "locations" ? value : draft.addOns.listingsLocations; }
    if (key === "voce") draft.addOns.voceUsers = (draft.productQuantities[key]?.professionals ?? 0) + (draft.productQuantities[key]?.locations ?? 0);
    if (key === "conversion_agents") { draft.addOns.conversionAgentsSelected = value > 0 || (draft.productQuantities[key]?.[scope === "professionals" ? "locations" : "professionals"] ?? 0) > 0; draft.addOns.conversionAgentProfessionals = draft.productQuantities[key]?.professionals ?? 0; draft.addOns.conversionAgentLocations = draft.productQuantities[key]?.locations ?? 0; }
    if (key === "sponsored") draft.addOns.sponsoredSearchSelected = value > 0 || (draft.productQuantities[key]?.[scope === "professionals" ? "locations" : "professionals"] ?? 0) > 0;
  });
  const setEnterpriseQty = (key: string, value: number) => update((draft) => {
    draft.enterpriseEnabled = true;
    draft.enterpriseQuantities = { ...(draft.enterpriseQuantities ?? {}), [key]: value };
    if (key === "campaigns") { draft.enterprise.campaigns5Pack.selected = value > 0; draft.enterprise.campaigns5Pack.quantity = value; }
    if (key === "benchmark") { draft.enterprise.benchmarkCampaign.selected = value > 0; draft.enterprise.benchmarkCampaign.quantity = value; }
    if (key === "custom_integration") { draft.enterprise.customIntegration.selected = value > 0; draft.enterprise.customIntegration.quantity = value; }
    if (key === "custom_development") { draft.enterprise.customDevelopment.selected = value > 0; draft.enterprise.customDevelopment.hours = value; }
  });
  const save = async () => { setBusy(true); try { await saveQuote(state, { bundle: 0, addOns: 0, enterprise: 0, discount: deal.writeDown, estimatedArr: deal.acv, ...deal }); toast.success("Draft saved"); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } };
  const commit = async () => { if (!validation.valid) return; setBusy(true); try { const result = await commitEntitlements(state, contractId, { lines: pricedLines, summary: { bundle: 0, addOns: 0, enterprise: 0, discount: deal.writeDown, estimatedArr: deal.acv, ...deal }, approval: { pending: !approved, note: approval.triggers.join("; ") } }); setState({ ...state, contractId: result.contractId }); toast.success(result.pendingApproval ? "Quote submitted for approval" : "Quote saved as provisional entitlements"); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } };
  const decide = async (decision: "approved" | "rejected") => { if (!contractId) return; setBusy(true); try { await setMarginApproval(contractId, decision, approvalNote.trim() || null); await contractApproval.refetch(); toast.success(`Quote ${decision}`); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } };

  const includedLines: InvoiceLine[] = state.packageId ? CATALOG.packages[state.packageId].includeKeys.map((key) => ({ productKey: key, label: CATALOG.products[key]?.name ?? key, qty: totalProfiles, unitPrice: 0, net: 0, section: "Included Platform Skills", included: true, description: CATALOG.products[key]?.description, listValue: catalogAnnualRate(key, "professional") * state.professionals + catalogAnnualRate(key, "location") * state.locations })) : [];
  const invoiceLines: InvoiceLine[] = [
    ...pricedLines.map((line) => ({ ...line, section: (CATALOG.products[line.productKey]?.lane === "base" ? "Subscription" : CATALOG.products[line.productKey]?.lane === "product" ? "Products" : "Enterprise") as InvoiceLine["section"], description: CATALOG.products[line.productKey]?.description, passthrough: CATALOG.products[line.productKey]?.passthrough })),
    ...includedLines,
  ];

  return <PageBody className="cpq-builder max-w-[1600px]"><style>{growthHubStyles(".cpq-builder") + BUILDER_CSS}</style>
    <PageHeader eyebrow="Growth Hub · CPQ" title="Build quote" description={`${state.quoteId}${saved ? "" : " · unsaved"} · Entitlements remain quoted, not live, until Closed/Won.`} actions={<><Button variant="outline" onClick={() => setInvoiceOpen(true)}><FileText className="mr-2 h-4 w-4" /> View invoice</Button><Button onClick={save} disabled={busy}>Save draft</Button>{saved && approved && validation.valid ? <QuoteContractButton quoteId={routeQuoteId} /> : null}</>} />
    <ol className="quote-steps mb-6 flex flex-wrap gap-2">{STEPS.map((step, index) => <li key={step} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs", step === "Entitlements" ? "border-primary bg-accent font-semibold text-accent-foreground" : "text-muted-foreground")}><span className="grid h-5 w-5 place-items-center rounded bg-muted text-[11px]">{index === 0 ? <Check className="h-3 w-3" /> : index + 1}</span>{step}</li>)}</ol>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="space-y-6">
        <Panel title="Customer" description="Select the account that owns this quote and contract."><Input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search accounts" />{accountMatches.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{accountMatches.map((account) => <Button key={account.id} variant={state.accountId === account.id ? "default" : "outline"} className="h-auto justify-between px-3 py-2" onClick={() => update((draft) => { draft.accountId = account.id; draft.accountOrgId = account.org_id; draft.accountName = account.name; })}><span className="truncate">{account.name}</span>{state.accountId === account.id ? <Check className="h-4 w-4" /> : null}</Button>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No matching accounts.</p>}</Panel>

        <Panel title="Base package" description="Choose à la carte or one catalog package.">
          <div className="grid gap-3 md:grid-cols-3"><PackageCard name="None" description="À la carte" selected={!state.packageId} onClick={() => update((draft) => { draft.packageId = null; }, true)} />{(["engage", "amplify"] as PackageId[]).map((id) => { const pkg = CATALOG.packages[id]; return <PackageCard key={id} name={pkg.name} description={pkg.tagline} selected={state.packageId === id} price={`${money.format(pkg.professionalMonthly)}/pro · ${money.format(pkg.locationMonthly)}/loc`} onClick={() => update((draft) => { draft.packageId = id; }, true)} />; })}</div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2"><Quantity label="# Locations (offices)" value={state.locations} onChange={(value) => update((draft) => { draft.locations = value; }, true)} /><Quantity label="# Professionals (agents)" value={state.professionals} onChange={(value) => update((draft) => { draft.professionals = value; }, true)} /></div>
        </Panel>

        <Panel title="Included skills ($0)" description={state.packageId ? `${CATALOG.packages[state.packageId].name} package inclusions from the catalog.` : "Choose a base package to include platform skills."}>
          {includedLines.length ? <div className="grid gap-2 sm:grid-cols-2">{includedLines.map((line) => <div key={line.productKey} className="flex items-start justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-semibold">{line.label}</p><p className="mt-1 text-xs text-muted-foreground">{number.format(state.locations)} loc · {number.format(state.professionals)} pro</p></div><span className="rounded bg-[color:var(--color-g-green-soft)] px-2 py-1 text-xs font-bold">$0</span></div>)}</div> : <p className="text-sm text-muted-foreground">No included skills with à la carte pricing.</p>}
        </Panel>

        <Panel title="Products" description="Set location and professional quantities independently." bodyClassName="p-0"><Table headers={["Product", "Locations", "Professionals", "Catalog rates"]}>{PRODUCT_KEYS.map((key) => { const product = CATALOG.products[key]; if (!product || !product.active) return null; const included = !!state.packageId && CATALOG.packages[state.packageId].includeKeys.includes(key); const qty = productQuantities[key] ?? { locations: key === "listings" ? state.addOns.listingsLocations : 0, professionals: key === "listings" ? state.addOns.listingsProfessionals : 0 }; return <tr key={key} className="border-b last:border-0"><Cell><p className="font-semibold">{product.name}</p><p className="mt-1 max-w-md text-xs text-muted-foreground">{product.description}</p>{included ? <span className="mt-2 inline-block rounded bg-[color:var(--color-g-green-soft)] px-2 py-0.5 text-[11px] font-semibold">Included by {CATALOG.packages[state.packageId ?? "engage"].name}</span> : null}</Cell><Cell><Num value={qty.locations} onChange={(value) => setProductQty(key, "locations", value)} className="w-24" /></Cell><Cell><Num value={qty.professionals} onChange={(value) => setProductQty(key, "professionals", value)} className="w-24" /></Cell><Cell>{included ? "$0 included" : `${money.format(catalogPrice(key, "location")?.list_price ?? 0)}/loc · ${money.format(catalogPrice(key, "professional")?.list_price ?? 0)}/pro`}</Cell></tr>; })}</Table></Panel>

        <Panel title="Enterprise SKUs" description="Enterprise, services, credits, and pass-through charges." bodyClassName="p-0"><Table headers={["SKU", "Quantity", "Rate", "Annual"]}>{ENTERPRISE_KEYS.map((key) => { const product = CATALOG.products[key]; if (!product || !product.active) return null; const autoProfiles = key === "benchmark"; const benchmarkSelected = state.enterprise.benchmarkCampaign.selected; const qty = autoProfiles ? (benchmarkSelected ? totalProfiles : 0) : safeNumber(enterpriseQuantities[key]); const rate = catalogPrice(key)?.list_price ?? (key === "add_credits" ? CATALOG.config.creditPrice : 0); const annualRate = catalogAnnualRate(key); const amount = key === "voce_boosts" ? safeNumber(state.adPassthrough) : key === "enterprise_first_publishing" ? Math.max(qty ? safeNumber(product.min_charge) : 0, qty * rate) : qty * annualRate; return <tr key={key} className="border-b last:border-0"><Cell><div className="flex items-center gap-2"><p className="font-semibold">{product.name}</p>{product.passthrough ? <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold">NO DISCOUNT</span> : null}</div><p className="mt-1 max-w-md text-xs text-muted-foreground">{product.description}</p>{product.min_charge ? <p className="mt-1 text-xs font-medium">Minimum {money.format(product.min_charge)}</p> : null}</Cell><Cell>{autoProfiles ? <label className="flex items-center gap-2"><Checkbox checked={benchmarkSelected} onCheckedChange={(checked) => setEnterpriseQty(key, checked ? totalProfiles : 0)} /><span className="tabular-nums">{benchmarkSelected ? `${number.format(totalProfiles)} profiles` : "Not selected"}</span></label> : key === "voce_boosts" ? <Num value={safeNumber(state.adPassthrough)} onChange={(value) => update((draft) => { draft.enterpriseEnabled = true; draft.adPassthrough = value; })} prefix="$" className="w-32" /> : <Num value={qty} onChange={(value) => setEnterpriseQty(key, value)} step={key === "add_credits" ? 1000 : 1} className="w-32" />}</Cell><Cell>{key === "voce_boosts" ? "At cost" : `${rate < 1 ? money2.format(rate) : money.format(rate)}/${catalogPrice(key)?.unit ?? "unit"}`}</Cell><Cell right>{money.format(amount)}</Cell></tr>; })}</Table></Panel>

        <Panel title="Priced lines" description="The exact annual lines carried into the provisional contract." bodyClassName="p-0"><Table headers={["Line", "Count", "Rate", "Annual"]}><tr className="border-b bg-muted/60"><Cell><p className="font-semibold">Platform fee</p><p className="mt-1 max-w-xl text-xs text-muted-foreground">{PLATFORM_INCLUSIONS}</p></Cell><Cell>1</Cell><Cell>Calculated</Cell><Cell right>{money.format(deal.platformFee)}</Cell></tr>{invoiceLines.map((line, index) => <tr key={`${line.productKey}-${index}`} className="border-b last:border-0"><Cell><p className="font-medium">{line.label}</p>{line.included && line.listValue ? <p className="text-xs text-muted-foreground">List value <s>{money.format(line.listValue)}</s></p> : null}{line.passthrough ? <span className="text-[10px] font-bold text-muted-foreground">NO DISCOUNT</span> : null}</Cell><Cell>{number.format(line.qty)}</Cell><Cell>{line.included ? "$0" : line.unitPrice < 1 ? money2.format(line.unitPrice) : money.format(line.unitPrice)}</Cell><Cell right>{line.included ? "$0" : money.format(line.net)}</Cell></tr>)}</Table><div className="ml-auto max-w-md space-y-2 p-5 text-sm"><SummaryLine label="Products subtotal" value={deal.subtotal} /><SummaryLine label={`Volume discount (${deal.volumePct}%)`} value={-deal.volumeDiscount} /><SummaryLine label="Platform fee" value={deal.platformFee} /><SummaryLine label="Voluntary write-down" value={-deal.writeDown} /><SummaryLine label="+ Ad pass-through (no discount)" value={deal.passthrough} /><div className="flex justify-between border-t pt-3 text-base font-bold"><span>Annual contract value</span><span>{money.format(deal.acv)}</span></div></div></Panel>
      </main>

      <aside className="space-y-6 xl:sticky xl:top-4 xl:self-start">
        <Panel className="gh-stat" title="Voluntary write-down" description="Applied after the volume tier."><div className="flex items-end justify-between"><div><p className="text-3xl font-semibold tabular-nums">{deal.writeDownPct.toFixed(1)}%</p><p className="text-xs text-muted-foreground">{deal.writeDownPct <= CATALOG.config.discountFloorSeller ? "Seller authority" : deal.writeDownPct <= CATALOG.config.discountFloorManager ? "Manager approval" : "Deal desk approval"}</p></div><p className="font-semibold">−{money.format(deal.writeDown)}</p></div><Slider className="mt-5" value={[Math.min(100, deal.writeDownPct)]} max={100} step={0.5} onValueChange={([pct]) => update((draft) => { draft.discount = (deal.subtotal - deal.volumeDiscount) * pct / 100; })} /><div className="mt-3 flex justify-between text-[11px] text-muted-foreground"><span>0%</span><span>Seller ≤ {CATALOG.config.discountFloorSeller}%</span><span>Manager ≤ {CATALOG.config.discountFloorManager}%</span><span>Deal desk</span></div></Panel>

        <Panel className="gh-stat" title="Pay with credits" actions={<Switch checked={creditsOn} onCheckedChange={(checked) => update((draft) => { draft.pricingModel = checked ? "credits" : "ppu"; })} />}><p className="text-xs leading-relaxed text-muted-foreground">Only catalog items marked creditable enter the wallet. Conversion, Sponsored, and enterprise SKUs remain entitlement charges.</p>{creditsOn ? <div className="mt-5 space-y-4"><div><div className="flex justify-between text-xs"><Label>Wallet utilization</Label><span>{creditUtilization}%</span></div><Slider className="mt-3" value={[creditUtilization]} min={CATALOG.config.creditFloorPct} max={100} step={1} onValueChange={([value]) => update((draft) => { draft.creditUtilizationPct = value; })} /></div><SummaryLine label="Per-user price" value={perUserPrice} /><SummaryLine label={`Credits price · ${number.format(Math.round(purchasedCredits))} @ ${money2.format(discountedCreditRate)}`} value={walletPrice} />{creditUtilization < 100 ? <SummaryLine label="Under-utilization gap" value={underUtilizationGap} /> : null}<p className="text-[11px] text-muted-foreground">The per-credit rate includes the {creditTierPct}% volume tier. At 100% utilization, the credits price equals the per-user price.</p></div> : null}</Panel>

        <Panel className="gh-stat" title="Pricing math"><div className="space-y-2 text-sm"><SummaryLine label="List value" value={deal.subtotal} /><SummaryLine label={`Volume discount (${deal.volumePct}%)`} value={-deal.volumeDiscount} /><SummaryLine label="Net" value={deal.net} /><SummaryLine label="Platform fee" value={deal.platformFee} /><SummaryLine label="Pre-discount" value={deal.net + deal.platformFee + deal.writeDown} /><SummaryLine label="Write-down" value={-deal.writeDown} /><div className="flex justify-between border-t pt-2 font-bold"><span>ACV</span><span>{money.format(deal.acv)}</span></div>{creditsOn ? <div className="mt-3 border-t pt-3 text-xs text-muted-foreground"><p className="font-semibold text-foreground">Credit-wallet breakdown</p><p className="mt-1">{number.format(Math.round(purchasedCredits))} credits · {money2.format(CATALOG.config.creditPrice)} list · {money2.format(discountedCreditRate)} after volume · {creditUtilization}% utilization</p></div> : null}</div></Panel>

        <Panel className="gh-stat" title="Commission factors"><div className="space-y-2 text-sm"><SummaryLine label="Total sale price" value={deal.acv} /><SummaryLine label="Ad pass-through" value={-deal.passthrough} /><SummaryLine label={`LLM cost basis · ${number.format(Math.round(creditsOn ? purchasedCredits : 0))} credits @ ${money2.format(CATALOG.config.llmCostBasis)}`} value={-llmCost} /><div className="flex items-center justify-between gap-3"><Label htmlFor="referral" className="text-muted-foreground">Referral / partner</Label><Num value={referralPartner} onChange={(value) => update((draft) => { draft.referralPartner = value; })} prefix="$" className="w-28" /></div><div className="flex justify-between border-t pt-2 font-bold"><span>Commissionable amount</span><span>{money.format(commissionable)}</span></div><p className="text-[11px] text-muted-foreground">quota attainment + tiered commission applied later.</p></div></Panel>

        <Panel className="gh-panel quote-approval" title="Quote approval"><div className="space-y-3 text-sm">{validation.valid ? <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[color:var(--color-g-green)]" /> Ready to quote</p> : <ul className="space-y-1 text-xs text-destructive">{validation.errors.map((error) => <li key={error}>• {error}</li>)}</ul>}{approval.needsApproval ? <div className="rounded-lg border p-3"><p className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> {approvalState === "approved" ? "Approved" : "Approval required"}</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{approval.triggers.map((trigger) => <li key={trigger}>• {trigger}</li>)}</ul>{contractId && approvalState === "pending" ? <div className="mt-3 space-y-2"><Input value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Approval note" /><div className="flex gap-2"><Button size="sm" onClick={() => decide("approved")}>Approve</Button><Button size="sm" variant="outline" onClick={() => decide("rejected")}>Reject</Button></div></div> : null}</div> : null}<Button className="w-full" disabled={!validation.valid || busy || (approval.needsApproval && approvalState === "pending")} onClick={commit}>{approval.needsApproval && approvalState !== "approved" ? "Submit for approval" : "Continue to pricing"}</Button><p className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Provisional entitlements remain quoted, not live. Use the Create contract button above after quote approval.</p></div></Panel>
      </aside>
    </div>
    <QuoteInvoice open={invoiceOpen} onOpenChange={setInvoiceOpen} quoteId={state.quoteId} accountName={state.accountName} lines={invoiceLines} deal={deal} referralPartner={referralPartner} />
  </PageBody>;
}

function PackageCard({ name, description, price, selected, onClick }: { name: string; description: string; price?: string; selected: boolean; onClick: () => void }) { return <Button variant="outline" className={cn("package-card gh-stat h-full min-h-36 items-start justify-start whitespace-normal p-4 text-left", selected && "border-primary bg-accent ring-1 ring-primary")} onClick={onClick}><span className="block w-full"><span className="flex items-center justify-between gap-2 font-semibold">{name}{selected ? <Check className="h-4 w-4" /> : null}</span>{price ? <span className="mt-3 block text-sm">{price}</span> : null}<span className="mt-2 line-clamp-3 block text-xs font-normal text-muted-foreground">{description}</span></span></Button>; }
function Quantity({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="space-y-2"><span className="text-sm font-semibold">{label}</span><Num value={value} onChange={onChange} className="w-full" /></label>; }
function Table({ headers, children }: { headers: string[]; children: ReactNode }) { return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b">{headers.map((header, index) => <th key={header} className={cn("px-5 py-3 text-left text-[11px] font-bold uppercase text-muted-foreground", index === headers.length - 1 && "text-right")}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
function Cell({ children, right }: { children: ReactNode; right?: boolean }) { return <td className={cn("px-5 py-3 align-middle", right && "text-right tabular-nums")}>{children}</td>; }
function SummaryLine({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="shrink-0 tabular-nums">{money.format(value)}</span></div>; }

function QuoteContractButton({ quoteId }: { quoteId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const existing = useQuery({
    queryKey: ["m4-contract-for-quote", quoteId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("exp_contracts").select("id").eq("quote_id", quoteId).order("created_at", { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0]?.id as string | undefined) ?? null;
    },
  });
  const go = (contractId: string) => void navigate({ to: "/sales/contracts/$contractId", params: { contractId } });
  const onClick = async () => {
    if (existing.data) return go(existing.data);
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const who = (u.user?.user_metadata?.full_name as string | undefined) ?? u.user?.email ?? "Scott Harris";
      const id = await createContractFromQuote(quoteId, who);
      toast.success("Contract created from quote");
      go(id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button onClick={onClick} disabled={busy || existing.isLoading} className="gh-primary">
      <FileText className="mr-2 h-4 w-4" />{existing.data ? "Open contract" : busy ? "Creating…" : "Create contract"}
    </Button>
  );
}

const BUILDER_CSS = `.cpq-builder .quote-steps li{background:var(--gh-surface);border-color:var(--gh-line);border-radius:8px}.cpq-builder .quote-steps li.border-primary{background:var(--gh-primary-gradient);border-color:var(--gh-blue);color:var(--gh-surface);box-shadow:var(--gh-control-shadow)}.cpq-builder .quote-steps li.border-primary span{background:color-mix(in srgb,var(--gh-surface) 20%,transparent);color:var(--gh-surface)}.cpq-builder button.package-card{border-radius:16px;background:linear-gradient(160deg,color-mix(in srgb,var(--gh-tone) 8%,var(--gh-surface)),var(--gh-surface) 62%);box-shadow:var(--gh-shadow);transition:transform .14s,box-shadow .14s}.cpq-builder button.package-card.border-primary{border-color:var(--gh-blue);background:linear-gradient(160deg,color-mix(in srgb,var(--gh-blue) 14%,var(--gh-surface)),var(--gh-surface) 75%);box-shadow:var(--gh-control-shadow)}.cpq-builder .package-card>span{min-width:0}.cpq-builder aside section[class~="gh-stat"]{background:linear-gradient(160deg,color-mix(in srgb,var(--gh-tone) 10%,var(--gh-surface)),var(--gh-surface) 62%)}.cpq-builder aside section.gh-stat>header{padding-top:20px}.cpq-builder .quote-approval{border-top:4px solid var(--gh-blue)}.cpq-builder main .h-auto>span{min-width:0}.cpq-builder main .h-auto{min-width:0}.cpq-builder section input{max-width:100%}.cpq-builder .gh-stat p.text-3xl{color:var(--gh-ink)}`;
