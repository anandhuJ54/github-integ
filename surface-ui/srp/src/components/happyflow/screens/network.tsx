import { useState, type CSSProperties } from "react";
import { Ic, NoraFace } from "../primitives";
import { HappyflowShell, useHf, type Think } from "../shell";

// Demo data (Happyflow prototype)
const HEAD = [
  "Network",
  "The partners who send you buyers, and the referrals between you.",
] as const;

const THINKS: Think[] = [
  {
    t: "Priya and Luis want to promote you.",
    d: "Partners who promote you send buyers and add to your Presence lane.",
    cta: "Show me",
    act: "close",
  },
  {
    t: "Maria and James have not replied.",
    d: "I drafted a short, friendly nudge for both.",
    cta: "Show me",
    act: "close",
  },
];

type PartnerState = "promoted" | "request" | "suggested" | "saved" | "gone";

/** id, name, company, role, avatar colour */
const PARTNERS: [string, string, string, string, string][] = [
  ["mc", "Megan Cole", "Ruhl&Ruhl Realtors", "Agent", "#4285f4"],
  ["tb", "Tom Brandt", "Keller Williams Quad Cities", "Agent", "#34a853"],
  ["al", "Abby Lindqvist", "Quad City Title", "Title", "#9b72f2"],
  ["ps", "Priya Shah", "Mel Foster Co.", "Agent", "#ea4335"],
  ["lo", "Luis Ortega", "NextHome Quad Cities", "Agent", "#e37400"],
  ["jr", "Jenna Ruiz", "Davenport Home Inspections", "Inspector", "#1a73e8"],
  ["kb", "Kyle Benson", "Iowa Realty", "Agent", "#137333"],
  ["sn", "Sara Nguyen", "Coldwell Banker", "Agent", "#7b4ce0"],
];

const WHY: Record<string, string> = {
  ps: "Asked to promote you on her profile",
  lo: "Asked to promote you on his profile",
  jr: "Named in 3 of your Zillow reviews",
  kb: "Co-listed on 4 of your closings this year",
  sn: "Saved Oct 12",
};

const INITIAL_NET: Record<string, PartnerState> = {
  mc: "promoted",
  tb: "promoted",
  al: "promoted",
  ps: "request",
  lo: "request",
  jr: "suggested",
  kb: "suggested",
  sn: "saved",
};

type RefTab = "Received" | "Requested" | "Given";
type RefStatus =
  "new" | "followed" | "closed" | "waiting" | "nudged" | "replied" | "thanked" | "done";

const STS: Record<RefStatus, [string, string, string, string]> = {
  new: ["New · I texted them a welcome", "#e8f0fe", "#1967d2", "Call"],
  followed: ["I followed up twice", "#f3e8fd", "#7b4ce0", "View"],
  closed: ["Closed", "#e6f4ea", "#137333", "View"],
  waiting: ["No reply · 5 days", "#fef7e0", "#b06000", "Nudge"],
  nudged: ["Nudge sent just now", "#e8f0fe", "#1967d2", "View"],
  replied: ["Referred a friend", "#e6f4ea", "#137333", "View"],
  thanked: ["Thanked you", "#e6f4ea", "#137333", "View"],
  done: ["Done", "#e6f4ea", "#137333", "View"],
};

const AC = ["#4285f4", "#34a853", "#9b72f2", "#ea4335", "#e37400"];

const REF_TITLE: Record<RefTab, string> = {
  Received: "Sent to you",
  Requested: "You asked for",
  Given: "You sent",
};

function refRows(nudged: boolean): Record<RefTab, [string, string, string, RefStatus][]> {
  return {
    Received: [
      ["Hannah and Joe Miller", "First-time buyers · FHA", "From Megan Cole · Oct 14", "new"],
      ["Carlos Diaz", "Refinance", "From your profile · Oct 11", "followed"],
      ["Erin Walsh", "VA purchase", "From Tom Brandt · Oct 9", "closed"],
      ["Mark Feld", "Jumbo", "From Abby Lindqvist · Oct 3", "followed"],
    ],
    Requested: [
      ["Maria L.", "Past client · closed in August", "Asked Oct 13", nudged ? "nudged" : "waiting"],
      ["James T.", "Past client · closed in June", "Asked Oct 13", nudged ? "nudged" : "waiting"],
      ["Ana Brooks", "Past client · closed in March", "Asked Oct 10", "replied"],
    ],
    Given: [
      ["Tom Brandt", "You sent him the Parker family", "Oct 12", "thanked"],
      ["Quad City Title", "You sent the Walsh closing", "Oct 9", "done"],
    ],
  };
}

const card: CSSProperties = {
  borderRadius: 24,
  background: "rgba(255,255,255,.95)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  boxShadow: "0 4px 12px rgba(66,133,244,.08)",
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  borderRadius: 16,
  background: "#f8f9fb",
  padding: 12,
};

const avatar = (c: string): CSSProperties => ({
  width: 40,
  height: 40,
  flex: "none",
  borderRadius: "50%",
  background: c,
  display: "grid",
  placeItems: "center",
  fontSize: 14,
  fontWeight: 700,
  color: "#fff",
});

const rowText: CSSProperties = {
  flex: "1 1 160px",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const btnPrimary: CSSProperties = {
  height: 34,
  border: 0,
  borderRadius: 10,
  background: "#1a73e8",
  padding: "0 14px",
  font: "700 13px Arial,sans-serif",
  color: "#fff",
  cursor: "pointer",
};

const btnBlue: CSSProperties = {
  height: 34,
  border: "1px solid #d2e3fc",
  borderRadius: 10,
  background: "#fff",
  padding: "0 12px",
  font: "700 13px Arial,sans-serif",
  color: "#1a73e8",
  cursor: "pointer",
};

const kitBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  border: 0,
  borderRadius: 14,
  background: "#f8f9fb",
  padding: 10,
  textAlign: "left",
  cursor: "pointer",
};

const initials = (n: string) =>
  n
    .split(" ")
    .map((w) => w[0])
    .join("");

export function NetworkScreen() {
  return (
    <HappyflowShell
      screen="network"
      day={1}
      title={HEAD[0]}
      sub={HEAD[1]}
      nora={{ thinks: THINKS }}
    >
      <NetworkBody />
    </HappyflowShell>
  );
}

function NetworkBody() {
  const hf = useHf();
  const { isD } = hf;
  const [net, setNet] = useState<Record<string, PartnerState>>(INITIAL_NET);
  const [netTab, setNetTab] = useState<"Partners" | "Referrals">("Partners");
  const [refTab, setRefTab] = useState<RefTab>("Received");
  const [nudged, setNudged] = useState(false);
  const [netNora, setNetNora] = useState<"open" | "done">("open");

  const set = (id: string, v: PartnerState) => () => setNet((x) => ({ ...x, [id]: v }));
  const of = (g: PartnerState) =>
    PARTNERS.filter((p) => net[p[0]] === g).map(([id, n, co, role, c]) => ({
      id,
      n,
      co,
      role,
      c,
      ini: initials(n),
      why: WHY[id] ?? "Saved just now",
    }));
  const promoted = of("promoted");
  const requests = of("request");
  const suggested = of("suggested");
  const saved = of("saved");

  const REF = refRows(nudged);
  const refs = REF[refTab].map(([n, d, meta, k], i) => {
    const [l, bg, fg, cta] = STS[k];
    return {
      n,
      d,
      meta,
      l,
      bg,
      fg,
      cta,
      c: AC[i % 5],
      ini: n
        .split(" ")
        .filter((w) => /^[A-Z]/.test(w))
        .slice(0, 2)
        .map((w) => w[0])
        .join(""),
      on:
        cta === "Nudge"
          ? () => setNudged(true)
          : cta === "Call"
            ? () => hf.toast("Calling Hannah and Joe…")
            : () => hf.toast("Opens " + n),
    };
  });

  const reqN = requests.length;
  const noraB =
    netNora === "done"
      ? "Done, they are on your profile now. "
      : reqN
        ? requests.map((r) => r.n.split(" ")[0]).join(" and ")
        : "";
  const noraT =
    netNora === "done"
      ? "Jenna and Kyle are next: both already send you buyers."
      : reqN
        ? " asked to promote you, and I found 2 more partners worth adding."
        : "Your partner list is up to date. I will tell you when someone new asks.";

  const acceptAll = () => {
    setNet((x) => {
      const n = { ...x };
      Object.keys(n).forEach((k) => {
        if (n[k] === "request") n[k] = "promoted";
      });
      return n;
    });
    setNetNora("done");
  };

  const searchPartner = () => hf.toast("Search agents, title companies and inspectors");
  const newGroup = () =>
    hf.openSheet(
      {
        title: "Create a group",
        ph: "Group name",
        cta: "Create",
        nora: "Name it and I'll suggest who belongs in it.",
        input: true,
        done: "Group created",
      },
      "",
    );
  const requestRef = () =>
    hf.openSheet(
      {
        title: "Ask for a referral",
        ph: "Message",
        cta: "Send to 6 past clients",
        nora: "I picked 6 clients who closed in the last year and left 5★. Approve and I will text them.",
        input: true,
        done: "Sent · I will follow up in 5 days",
      },
      "Hi! It was a joy helping you with your home. If a friend is thinking about buying, I would love to help them too. — Dana",
    );
  const nudgeAll = () => {
    setNudged(true);
    hf.toast("Nudges sent to Maria and James");
  };

  const netGrid: CSSProperties = isD
    ? { gridTemplateColumns: "minmax(0,8fr) minmax(0,4fr)", alignItems: "start" }
    : { gridTemplateColumns: "minmax(0,1fr)" };

  const tabs: [string, string][] = [
    ["Partners", promoted.length + " promoted"],
    ["Referrals", REF.Received.length + " received"],
  ];

  return (
    <>
      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
          borderRadius: 20,
          background: "#eef3fe",
          border: "1.5px solid #d2e3fc",
          padding: "14px 16px",
          animation: "hf-rise .32s ease both",
        }}
      >
        <NoraFace size={40} mood="idle" />
        <span style={{ flex: "1 1 240px", fontSize: 15, lineHeight: 1.5 }}>
          <b>{noraB}</b>
          {noraT}
        </span>
        {reqN > 0 && netNora === "open" ? (
          <button
            type="button"
            onClick={acceptAll}
            style={{
              height: 40,
              border: 0,
              borderRadius: 12,
              background: "#1a73e8",
              padding: "0 16px",
              font: "700 14px Arial,sans-serif",
              color: "#fff",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Accept both
          </button>
        ) : null}
      </section>

      <div style={{ display: "flex", gap: 8 }}>
        {tabs.map(([l, n]) => {
          const on = netTab === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => setNetTab(l as "Partners" | "Referrals")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 42,
                border: `1.5px solid ${on ? "#1a73e8" : "#e3e5e8"}`,
                borderRadius: 999,
                background: on ? "#e8f0fe" : "#fff",
                padding: "0 16px",
                font: "700 14px Arial,sans-serif",
                color: on ? "#1967d2" : "#3c4043",
                cursor: "pointer",
              }}
            >
              {l}
              <span style={{ fontSize: 12, fontWeight: 600, color: on ? "#1967d2" : "#80868b" }}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {netTab === "Partners" ? (
        <div style={{ display: "grid", gap: 16, ...netGrid }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <button
              type="button"
              onClick={searchPartner}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                height: 52,
                border: "1.5px solid #e3e5e8",
                borderRadius: 16,
                background: "#fff",
                padding: "0 16px",
                font: "15px Arial,sans-serif",
                color: "#80868b",
                cursor: "text",
                textAlign: "left",
                boxShadow: "0 1px 3px rgba(60,64,67,.08)",
              }}
            >
              <Ic name="search" size={18} color="#80868b" />
              Search agents, title companies, inspectors…
            </button>

            <section style={{ ...card, gap: 12, animation: "hf-rise .32s ease .04s both" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Promoted on your profile</span>
                <span style={{ fontSize: 12, color: "#5f6368" }}>Buyers see them on your page</span>
                <b
                  style={{
                    marginLeft: "auto",
                    fontSize: 13,
                    color: "#1967d2",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {promoted.length + " of 8"}
                </b>
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: isD ? "repeat(3,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))",
                }}
              >
                {promoted.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      position: "relative",
                      borderRadius: 18,
                      background: "#f8f9fb",
                      padding: "14px 12px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      textAlign: "center",
                      animation: "hf-pop .35s ease both",
                    }}
                  >
                    <span
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        background: p.c,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 16,
                        fontWeight: 700,
                        color: "#fff",
                      }}
                    >
                      {p.ini}
                    </span>
                    <b style={{ fontSize: 14 }}>{p.n}</b>
                    <span style={{ fontSize: 12, lineHeight: 1.35, color: "#5f6368" }}>{p.co}</span>
                    <button
                      type="button"
                      onClick={set(p.id, "saved")}
                      aria-label="Remove"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 26,
                        height: 26,
                        border: 0,
                        borderRadius: "50%",
                        background: "#fff",
                        display: "grid",
                        placeItems: "center",
                        cursor: "pointer",
                        color: "#80868b",
                      }}
                    >
                      <Ic name="x" size={16} />
                    </button>
                  </div>
                ))}
                {promoted.length < 8 ? (
                  <button
                    type="button"
                    onClick={searchPartner}
                    style={{
                      border: "1.5px dashed #c6dafc",
                      borderRadius: 18,
                      background: "transparent",
                      padding: "14px 12px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      minHeight: 132,
                      font: "700 13px Arial,sans-serif",
                      color: "#1a73e8",
                      cursor: "pointer",
                    }}
                  >
                    <Ic name="plus" size={16} />
                    Add a partner
                  </button>
                ) : null}
              </div>
            </section>

            {reqN > 0 ? (
              <section style={{ ...card, animation: "hf-rise .32s ease .08s both" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>Want to promote you</span>
                  <span
                    style={{
                      minWidth: 22,
                      height: 22,
                      borderRadius: 11,
                      background: "#ea4335",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    {reqN}
                  </span>
                </div>
                {requests.map((p) => (
                  <div key={p.id} style={row}>
                    <span style={avatar(p.c)}>{p.ini}</span>
                    <div style={rowText}>
                      <b style={{ fontSize: 14 }}>
                        {p.n} <span style={{ fontWeight: 400, color: "#5f6368" }}>· {p.co}</span>
                      </b>
                      <span style={{ fontSize: 12, color: "#5f6368" }}>{p.why}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={set(p.id, "promoted")} style={btnPrimary}>
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={set(p.id, "gone")}
                        style={{ ...btnBlue, border: "1px solid #dadce0", color: "#3c4043" }}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {suggested.length > 0 ? (
              <section style={{ ...card, animation: "hf-rise .32s ease .12s both" }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  <Ic name="spark" size={14} color="#7b4ce0" />
                  NORA suggests
                </span>
                {suggested.map((p) => (
                  <div key={p.id} style={{ ...row, background: "#f5f9ff" }}>
                    <span style={avatar(p.c)}>{p.ini}</span>
                    <div style={rowText}>
                      <b style={{ fontSize: 14 }}>
                        {p.n}{" "}
                        <span style={{ fontWeight: 400, color: "#5f6368" }}>
                          · {p.role}, {p.co}
                        </span>
                      </b>
                      <span style={{ fontSize: 12, color: "#7b4ce0" }}>{p.why}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={set(p.id, "promoted")} style={btnPrimary}>
                        Promote
                      </button>
                      <button type="button" onClick={set(p.id, "saved")} style={btnBlue}>
                        Save
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {saved.length > 0 ? (
              <section style={card}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Saved for later</span>
                {saved.map((p) => (
                  <div key={p.id} style={row}>
                    <span style={avatar(p.c)}>{p.ini}</span>
                    <div style={rowText}>
                      <b style={{ fontSize: 14 }}>
                        {p.n} <span style={{ fontWeight: 400, color: "#5f6368" }}>· {p.co}</span>
                      </b>
                      <span style={{ fontSize: 12, color: "#80868b" }}>{p.why}</span>
                    </div>
                    <button
                      type="button"
                      onClick={set(p.id, "promoted")}
                      style={{ ...btnBlue, padding: "0 14px" }}
                    >
                      Promote
                    </button>
                  </div>
                ))}
              </section>
            ) : null}

            <button
              type="button"
              onClick={newGroup}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                height: 52,
                border: "1.5px dashed #c6dafc",
                borderRadius: 18,
                background: "transparent",
                font: "700 14px Arial,sans-serif",
                color: "#1a73e8",
                cursor: "pointer",
              }}
            >
              <Ic name="plus" size={16} />
              Create a group
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <section style={{ ...card, gap: 10, animation: "hf-rise .32s ease .1s both" }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>Office visit kit</span>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  borderRadius: 14,
                  background: "#eef3fe",
                  padding: "10px 12px",
                }}
              >
                <NoraFace size={26} mood="idle" />
                <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
                  Visiting an office this week? Show the 2-minute video, then leave the slides.
                </span>
              </div>
              <button
                type="button"
                onClick={() => hf.toast("Plays the SRS demo video")}
                style={kitBtn}
              >
                <span
                  style={{
                    width: 52,
                    height: 40,
                    flex: "none",
                    borderRadius: 10,
                    background: "linear-gradient(135deg,#12294d,#1a73e8)",
                    display: "grid",
                    placeItems: "center",
                    color: "#fff",
                  }}
                >
                  <Ic name="play" size={16} color="#fff" />
                </span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontSize: 14 }}>SRS demo video</b>
                  <span style={{ fontSize: 12, color: "#5f6368" }}>2:06</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => hf.toast("Downloading SRS demo slides")}
                style={kitBtn}
              >
                <span
                  style={{
                    width: 52,
                    height: 40,
                    flex: "none",
                    borderRadius: 10,
                    background: "#e8f0fe",
                    display: "grid",
                    placeItems: "center",
                    color: "#1a73e8",
                  }}
                >
                  <Ic name="download" size={16} color="#1a73e8" />
                </span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontSize: 14 }}>SRS demo slides</b>
                  <span style={{ fontSize: 12, color: "#5f6368" }}>Download · PDF</span>
                </span>
              </button>
            </section>
          </div>
        </div>
      ) : null}

      {netTab === "Referrals" ? (
        <div style={{ display: "grid", gap: 16, ...netGrid }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                gap: 6,
                borderRadius: 18,
                background: "#eceff5",
                padding: 5,
              }}
            >
              {(Object.keys(REF) as RefTab[]).map((k) => {
                const on = refTab === k;
                const fg = on ? "#1967d2" : "#3c4043";
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRefTab(k)}
                    style={{
                      border: `1.5px solid ${on ? "#1a73e8" : "transparent"}`,
                      borderRadius: 14,
                      background: on ? "#fff" : "rgba(255,255,255,.6)",
                      padding: "10px 6px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 2,
                      cursor: "pointer",
                      boxShadow: on ? "0 4px 12px rgba(66,133,244,.12)" : "none",
                    }}
                  >
                    <b
                      style={{
                        fontSize: 24,
                        lineHeight: 1,
                        color: fg,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {REF[k].length}
                    </b>
                    <span style={{ fontSize: 12, fontWeight: 700, color: fg }}>{k}</span>
                  </button>
                );
              })}
            </div>
            <section style={card}>
              <span style={{ fontSize: 16, fontWeight: 700, padding: "0 2px 4px" }}>
                {REF_TITLE[refTab]}
              </span>
              {refs.map((r) => (
                <div
                  key={`${refTab}-${r.n}`}
                  style={{ ...row, animation: "hf-rise .3s ease both" }}
                >
                  <span style={avatar(r.c)}>{r.ini}</span>
                  <div
                    style={{
                      flex: "1 1 170px",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <b style={{ fontSize: 14 }}>{r.n}</b>
                    <span style={{ fontSize: 12, color: "#5f6368" }}>
                      {r.d} · {r.meta}
                    </span>
                    <span
                      style={{
                        alignSelf: "flex-start",
                        borderRadius: 999,
                        background: r.bg,
                        padding: "2px 9px",
                        fontSize: 11,
                        fontWeight: 700,
                        color: r.fg,
                      }}
                    >
                      {r.l}
                    </span>
                  </div>
                  <button type="button" onClick={r.on} style={{ ...btnBlue, padding: "0 14px" }}>
                    {r.cta}
                  </button>
                </div>
              ))}
            </section>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <section
              style={{
                borderRadius: 24,
                backgroundImage:
                  "radial-gradient(120% 90% at 0% 0%,oklch(0.965 0.021 30) 0%,transparent 55%),radial-gradient(110% 90% at 100% 0%,oklch(0.955 0.025 285) 0%,transparent 55%),linear-gradient(180deg,oklch(0.985 0.004 285),#fff)",
                padding: 18,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                boxShadow: "0 12px 32px rgba(66,133,244,.12)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <NoraFace size={26} mood="idle" />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".12em",
                    color: "#7b4ce0",
                  }}
                >
                  ASK FOR REFERRALS
                </span>
              </div>
              <span style={{ font: "600 22px/1.25 Lora,Georgia,serif" }}>
                Happy clients are your best leads.
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: "#3c4043" }}>
                I&apos;ll write the message and pick who to send it to. You approve.
              </span>
              <button
                type="button"
                onClick={requestRef}
                style={{
                  height: 46,
                  border: 0,
                  borderRadius: 14,
                  background: "#1a73e8",
                  font: "700 15px Arial,sans-serif",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Request a referral
              </button>
            </section>
            {!nudged ? (
              <section
                style={{
                  borderRadius: 24,
                  background: "#fef7e0",
                  border: "1px solid #fbe3a4",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1.45 }}>
                  <b>Maria and James haven&apos;t replied in 5 days.</b> I drafted a short, friendly
                  nudge for both.
                </span>
                <span
                  style={{
                    borderRadius: 12,
                    background: "#fff",
                    padding: "10px 12px",
                    fontSize: 13,
                    lineHeight: 1.45,
                    color: "#3c4043",
                  }}
                >
                  &quot;Hi! Just checking in — if anyone you know is thinking about buying, I&apos;d
                  love to help. — Dana&quot;
                </span>
                <button
                  type="button"
                  onClick={nudgeAll}
                  style={{
                    height: 40,
                    border: 0,
                    borderRadius: 12,
                    background: "#1a73e8",
                    font: "700 14px Arial,sans-serif",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Send both
                </button>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
