/**
 * Screen 8 · Connections — every account NORA can use, and what it powers.
 * Ported 1:1 from the Happyflow prototype (SRP App, `sConn`).
 */
import { HappyflowShell, useHf, type Think } from "../shell";
import { Hov, Ic, NoraFace, Tick } from "../primitives";

// Demo data (Happyflow prototype)
const HEAD = ["Connections", "Every account NORA can use, and what it powers."] as const;

const THINKS: Think[] = [
  {
    t: "Search Console is one tap away.",
    d: "It's part of your Google sign-in. It shows me which searches find your page.",
    cta: "Connect it",
    act: (api) => api.connect("Search Console"),
  },
  {
    t: "Your Website / CMS would let me apply fixes.",
    d: "Right now I can only hand them to your webmaster.",
    cta: "Connect it",
    act: (api) => api.connect("Website / CMS"),
  },
];

type AccType = "on" | "connect" | "matched" | "partial";

/** [name, monogram, colour, type, status, powers] */
const ACC: [string, string, string, AccType, string, string][] = [
  [
    "Google Business Profile",
    "G",
    "#4285f4",
    "on",
    "Connected · synced today",
    "GBP lane (67 of 68), hours, photos, reviews",
  ],
  [
    "Search Console",
    "SC",
    "#34a853",
    "connect",
    "Part of the Google sign-in, not yet granted",
    "Indexing and search queries for Website Analytics",
  ],
  ["YouTube", "YT", "#ea4335", "on", "Connected through Google", "Videos lane"],
  ["Facebook", "f", "#1877f2", "on", "Connected", "Connections lane, posting"],
  ["Instagram", "IG", "#d6249f", "connect", "", "Connections lane, posting"],
  ["LinkedIn", "in", "#0a66c2", "on", "Connected", "Connections lane, photo, credentials hints"],
  ["X", "X", "#202124", "connect", "", "Connections lane"],
  [
    "Zillow",
    "Z",
    "#006aff",
    "matched",
    "Matched, no sign-in needed",
    "Reviews shown on the profile",
  ],
  [
    "Yelp",
    "Y",
    "#d32323",
    "partial",
    "Match found · replies need Yelp's partner access",
    "Listing check",
  ],
  ["Website / CMS", "W", "#5f6368", "connect", "", "Lets NORA apply website fixes"],
  ["Loan system (Encompass)", "E", "#7b4ce0", "connect", "", "Review requests after each closing"],
];

const PILL: Record<Exclude<AccType, "connect">, [string, string, string]> = {
  on: ["Connected", "#e6f4ea", "#137333"],
  matched: ["Matched", "#e6f4ea", "#137333"],
  partial: ["Partial", "#fef7e0", "#b06000"],
};

export function ConnectionsScreen() {
  return (
    <HappyflowShell
      screen="connections"
      day={1}
      title={HEAD[0]}
      sub={HEAD[1]}
      nora={{ thinks: THINKS }}
    >
      <ConnectionsBody />
    </HappyflowShell>
  );
}

function ConnectionsBody() {
  const hf = useHf();
  const { isD, connected } = hf;
  const connOn = 4 + Object.keys(connected).length;

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
          <b>{connOn} connected, 2 matched.</b> Connect <b>Search Console</b> and your{" "}
          <b>Website / CMS</b> and I can fix your website myself instead of handing it to your
          webmaster.
        </span>
      </section>

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: isD ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)",
        }}
      >
        {ACC.map(([n, m, c, t, s, p], i) => {
          const conn = t === "connect" && !!connected[n];
          const ty: AccType = conn ? "on" : t;
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
          <b style={{ fontSize: 15 }}>
            Publish your details to Apple Maps, Bing and 28 directories.
          </b>
          <span style={{ fontSize: 13, color: "#5f6368" }}>
            Unlock with Engage, included in Amplify.
          </span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#b06000" }}>Unlock →</span>
      </button>
    </>
  );
}
