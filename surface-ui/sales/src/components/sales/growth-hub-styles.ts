/** Shared visual vocabulary, emitted in each surface's scoped inline style. */
export function growthHubStyles(scope: string) {
  return `
${scope}{--color-ink:var(--gh-ink);--color-ink-2:var(--gh-muted);--color-ink-3:var(--gh-muted);--color-hairline:var(--gh-line);--color-g-blue:var(--gh-blue);--color-surface-2:var(--gh-header);--color-surface-3:var(--gh-canvas);--primary:var(--gh-blue);--foreground:var(--gh-ink);--muted-foreground:var(--gh-muted);--border:var(--gh-line);--input:var(--gh-line);--ring:var(--gh-blue);background:var(--gh-canvas);color:var(--gh-ink);font-variant-numeric:tabular-nums;min-width:0}
${scope} :is(h1,h2,h3,h4){letter-spacing:0;color:var(--gh-ink)}
${scope} section[class~="bg-card"],${scope} .gh-panel{border:1px solid var(--gh-line);border-radius:16px!important;box-shadow:var(--gh-shadow);background:var(--gh-surface);min-width:0}
${scope} section[class~="bg-card"]>header{border-color:var(--gh-line)}
${scope} :is(input,select,textarea){border-color:var(--gh-line);border-radius:8px;font-variant-numeric:tabular-nums}
${scope} :is(button,a)[class~="bg-primary"],${scope} [role="tab"][data-state="active"],${scope} .gh-primary{background:var(--gh-primary-gradient);color:var(--gh-surface);border-color:var(--gh-blue);box-shadow:var(--gh-control-shadow)}
${scope} :is(button,a)[class~="border-input"],${scope} [role="tab"]{background:var(--gh-surface);border:1px solid var(--gh-line);border-radius:8px;transition:background .14s,transform .14s,box-shadow .14s}
${scope} :is(button,a)[class~="border-input"]:not(:disabled):hover,${scope} [role="tab"]:not([data-state="active"]):hover{background:var(--gh-control-hover);transform:translateY(-1px)}
${scope} :is(button,a)[class~="bg-primary"]:not(:disabled):hover{background:var(--gh-primary-gradient);transform:translateY(-1px)}
${scope} [role="tablist"]{height:auto;flex-wrap:wrap;justify-content:flex-start;gap:6px;padding:0;background:transparent;border-radius:8px}
${scope} [role="tab"][data-state="active"]{background:var(--gh-primary-gradient);color:var(--gh-surface);border-color:var(--gh-blue);box-shadow:var(--gh-control-shadow)}
${scope} table{font-variant-numeric:tabular-nums}
${scope} th{background:var(--gh-header);color:var(--gh-muted);text-transform:uppercase;letter-spacing:0;font-size:10.5px;border-color:var(--gh-line)}
${scope} td,${scope} tr{border-color:var(--gh-line)}
${scope} tbody tr{transition:background .14s}
${scope} tbody tr:hover{background:var(--gh-hover)}
${scope} :is(.gh-stat,.gh-stats>div){--gh-tone:var(--gh-blue);position:relative;overflow:hidden;border:1px solid var(--gh-line);border-radius:16px!important;background:linear-gradient(160deg,color-mix(in srgb,var(--gh-tone) 11%,var(--gh-surface)),var(--gh-surface) 62%);box-shadow:var(--gh-shadow);transition:transform .14s,box-shadow .14s;min-width:0}
${scope} :is(.gh-stat,.gh-stats>div)::before{content:"";position:absolute;inset:0 0 auto;height:4px;background:linear-gradient(90deg,var(--gh-tone),color-mix(in srgb,var(--gh-tone) 35%,var(--gh-surface)))}
${scope} :is(.gh-stat,.gh-stats>div):hover{transform:translateY(-2px)}
${scope} :is(.gh-stat,.gh-stats>div):nth-child(7n+2){--gh-tone:var(--gh-slate)}
${scope} :is(.gh-stat,.gh-stats>div):nth-child(7n+3){--gh-tone:var(--gh-green)}
${scope} :is(.gh-stat,.gh-stats>div):nth-child(7n+4){--gh-tone:var(--gh-purple)}
${scope} :is(.gh-stat,.gh-stats>div):nth-child(7n+5){--gh-tone:var(--gh-amber)}
${scope} :is(.gh-stat,.gh-stats>div):nth-child(7n+6){--gh-tone:var(--gh-ink)}
${scope} :is(.gh-stat,.gh-stats>div):nth-child(7n+7){--gh-tone:var(--gh-red)}
${scope} .gh-status{--gh-status-tone:var(--gh-muted);display:inline-flex;align-items:center;border:1px solid color-mix(in srgb,var(--gh-status-tone) 20%,var(--gh-line));border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;color:color-mix(in srgb,var(--gh-status-tone) 75%,var(--gh-ink));background:color-mix(in srgb,var(--gh-status-tone) 11%,var(--gh-surface));white-space:nowrap}
${scope} .gh-status:is([data-status="active"],[data-status="approved"],[data-status="won"],[data-status="positive"]){--gh-status-tone:var(--gh-green)}
${scope} .gh-status:is([data-status="pending"],[data-status="negotiating"],[data-status="review"],[data-status="in_progress"]){--gh-status-tone:var(--gh-amber)}
${scope} .gh-status:is([data-status="awaiting_signature"],[data-status="out_for_signature"]){--gh-status-tone:var(--gh-purple)}
${scope} .gh-status[data-status="renewing"]{--gh-status-tone:var(--gh-teal)}
${scope} .gh-status:is([data-status="rejected"],[data-status="lost"],[data-status="negative"]){--gh-status-tone:var(--gh-red)}
@media(max-width:640px){${scope}{padding:20px 16px}${scope}>div:first-of-type{min-width:0}${scope} section[class~="bg-card"]>header{padding:16px;flex-wrap:wrap}${scope} section[class~="bg-card"]>div{padding-left:16px;padding-right:16px}${scope} h1{white-space:normal;overflow-wrap:anywhere}${scope} [role="tab"]{flex:none}}
@media(max-width:640px){
div:has(>aside):has(${scope})>aside{width:56px}
div:has(>aside):has(${scope})>aside>div:first-child{padding:12px;justify-content:center}
div:has(>aside):has(${scope})>aside>div:first-child>div,div:has(>aside):has(${scope})>aside nav p,div:has(>aside):has(${scope})>aside nav a>span{display:none}
div:has(>aside):has(${scope})>aside nav{padding:8px 6px}
div:has(>aside):has(${scope})>aside nav a{padding:10px;justify-content:center}
div:has(>aside):has(${scope})>aside>div:last-child{padding:6px}
div:has(>aside):has(${scope})>aside>div:last-child button{font-size:0;justify-content:center;padding:10px}
div:has(>aside):has(${scope})>div>header{padding:8px;gap:6px}
div:has(>aside):has(${scope})>div>header>div:first-child{min-width:0}
div:has(>aside):has(${scope})>div>header>div:last-child{flex-shrink:0}
${scope}>div:has(>div>h1){flex-direction:column;align-items:stretch}
${scope}>div:has(>div>h1)>div:last-child{flex-wrap:wrap;flex-shrink:1}
}
@media(prefers-reduced-motion:reduce){${scope} *,${scope} *::before{transition:none!important;animation:none!important}${scope} :is(button,a,.gh-stat):hover{transform:none!important}}
`;
}