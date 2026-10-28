/**
 * Screen 8 · Connections — every account NORA can use, and what it powers.
 * Ported 1:1 from the Happyflow prototype (SRP App, `sConn`).
 */
import { HappyflowShell, useHf, type Think } from "../shell";
import { Hov, Ic, NoraFace, Tick } from "../primitives";
import { useConnectionsModel } from "../connections-context";
import type { ConnCard, ConnThink, ConnType } from "@v3/srp/utils/connections-model";

const HEAD = ["Connections", "Every account NORA can use, and what it powers."] as const;

const PURPOSE: Record<string, string> = {
  search_console: "see which searches find your page",
  website_cms: "apply your website fixes myself",
};

const PILL: Record<Exclude<ConnType, "connect">, [string, string, string]> = {
  on: ["Connected", "#e6f4ea", "#137333"],
  matched: ["Matched", "#e6f4ea", "#137333"],
  partial: ["Partial", "#fef7e0", "#b06000"],
};

/** NORA's notes as the shell shows them: each button's Connect only marks the account connected on screen. */
export function connectThinks(notes: ConnThink[]): Think[] {
  return notes.map((n) => ({ t: n.t, d: n.d, cta: n.cta, act: (api) => api.connect(n.connect) }));
}

/** Connect clicks that add to the stored count: only an account that is not connected yet (the shell's sources sheet can also mark an already connected one). */
export function clickedCount(cards: ConnCard[], connected: Record<string, unknown>): number {
  return cards.filter((c) => c.type === "connect" && connected[c.name]).length;
}

export function ConnectionsScreen() {
  const model = useConnectionsModel();
  const thinks = connectThinks(model.thinks);
  return (
    <HappyflowShell screen="connections" day={1} title={HEAD[0]} sub={HEAD[1]} nora={{ thinks }}>
      <ConnectionsBody />
    </HappyflowShell>
  );
}

function ConnectionsBody() {
  const hf = useHf();
  const model = useConnectionsModel();
  const { isD, connected } = hf;
  const connOn = model.connected + clickedCount(model.cards, connected);
  const names = model.suggest.map((x) => x.name);
  const tail =
    names.length === 2 ? (
      <>
        {" Connect "}
        <b>Search Console</b>
        {" and your"} <b>Website / CMS</b>
        {" and I can fix your website myself instead of handing it to your webmaster."}
      </>
    ) : names.length === 1 ? (
      <>
        {" Connect "}
        <b>{names[0]}</b>
        {` and I can ${PURPOSE[model.suggest[0].key] ?? "use it"}.`}
      </>
    ) : null;

  return (
    <>
      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          borderRadius: 20,
          background: "#eef3fe",
          border: "1.5px solid #d2e3fc",
          padding: "14px 16px",
          animation: "hf-rise .32s ease both",
        }}
      >
        <NoraFace size={40} />
        <span style={{ flex: 1, fontSize: 15, lineHeight: 1.5 }}>
          <b>
            {connOn}
            {` connected, ${model.matched} matched.`}
          </b>
          {tail}
        </span>
      </section>

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: isD ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)",
        }}
      >
        {model.cards.map(({ name: n, mono: m, color: c, type: t, status: s, powers: p }, i) => {
          const conn = t === "connect" && !!connected[n];
          const ty: ConnType = conn ? "on" : t;
          const pill = ty === "connect" ? null : PILL[ty];
          const st = conn ? "Connected just now" : s;
          const stFg = ty === "partial" ? "#b06000" : ty === "connect" ? "#80868b" : "#137333";
          return (
            <div
              key={n}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderRadius: 18,
                background: "rgba(255,255,255,.95)",
                padding: 14,
                boxShadow: "0 4px 12px rgba(66,133,244,.08)",
                animation: `hf-rise .3s ease ${i * 30}ms both`,
              }}
            >
              <span
                style={{
                  width: 42,
                  height: 42,
                  flex: "none",
                  borderRadius: 12,
                  background: c,
                  display: "grid",
                  placeItems: "center",
                  fontSize: m.length > 1 ? 14 : 18,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                {m}
              </span>
              <div
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>{n}</span>
                <span style={{ fontSize: 12, lineHeight: 1.4, color: "#5f6368" }}>{p}</span>
                {st ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: stFg }}>{st}</span>
                ) : null}
              </div>
              {ty === "connect" ? (
                <Hov
                  onClick={() => hf.connect(n)}
                  style={{
                    flex: "none",
                    height: 34,
                    border: 0,
                    borderRadius: 999,
                    background: "#1a73e8",
                    padding: "0 16px",
                    font: "700 13px Arial,sans-serif",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                  hover={{ background: "#1557b0" }}
                >
                  Connect
                </Hov>
              ) : (
                <span
                  style={{
                    flex: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    borderRadius: 999,
                    background: pill ? pill[1] : "",
                    padding: "5px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: pill ? pill[2] : "",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ty === "partial" ? (
                    <Ic name="alert" size={12} color="#b06000" sw={2.4} />
                  ) : (
                    <Tick size={11} color="#137333" />
                  )}
                  {pill ? pill[0] : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {model.locked ? (
        <button
          type="button"
          onClick={() => hf.out("Billing")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            border: "1px solid #fbe3a4",
            borderRadius: 18,
            background: "#fef7e0",
            padding: 16,
            textAlign: "left",
            cursor: "pointer",
            animation: "hf-rise .32s ease .3s both",
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: "50%",
              background: "#fff",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Ic name="lock" size={16} color="#b06000" sw={2.4} />
          </span>
          <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 3 }}>
            <b style={{ fontSize: 15 }}>{model.locked.title}</b>
            <span style={{ fontSize: 13, color: "#5f6368" }}>{model.locked.text}</span>
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#b06000" }}>Unlock →</span>
        </button>
      ) : null}
    </>
  );
}
