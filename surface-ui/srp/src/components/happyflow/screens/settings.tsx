/**
 * Screen 19 — NORA settings (Happyflow prototype, SRP App `sSet` / `setVals()`).
 * What NORA does on her own, when she works, and what she can touch. All values are demo state.
 */
import { useState, type ReactNode } from "react";
import { useHfPersona, usePersonalize } from "../persona-context";
import { HappyflowShell, Toggle, useHf, type Think } from "../shell";
import { Ic, NoraFace, Tick } from "../primitives";
import type { HfIconName } from "../icons";

// Demo data (Happyflow prototype)
const THINKS: Think[] = [
  {
    t: "Social posts could run on their own.",
    d: "You approved all 6 of my posts unchanged.",
    cta: "Let NORA post",
    act: "close",
  },
  {
    t: "Your quiet hours are set.",
    d: "I will not text you between 9 pm and 7 am, except for urgent reviews.",
    cta: "Got it",
    act: "close",
  },
];

type Cfg = {
  a_rev45: string;
  a_rev13: string;
  a_social: string;
  a_profile: string;
  a_listing: string;
  a_article: string;
  a_web: string;
  a_ref: string;
  a_partner: string;
  a_default: string;
  ap_app: boolean;
  ap_text: boolean;
  ap_email: boolean;
  ap_auto: string;
  ap_undo: string;
  rt_days: string[];
  rt_check: string;
  rt_quiet: string;
  rt_brief: string;
  rt_scan: string;
  t_gbp: string;
  t_web: string;
  t_li: string;
  t_fb: string;
  t_z: string;
  t_yt: string;
  v_tone: string;
  v_sign: string;
  v_avoid: string[];
  v_eho: boolean;
  n_text: boolean;
  n_email: boolean;
  n_neg: boolean;
  n_exp: boolean;
  n_comp: boolean;
  n_win: boolean;
  g_target: string;
  g_area: string;
  g_push: string[];
  g_goal: string;
  paused: boolean;
  mem: number[];
};

type StrKey = { [K in keyof Cfg]: Cfg[K] extends string ? K : never }[keyof Cfg];
type BoolKey = { [K in keyof Cfg]: Cfg[K] extends boolean ? K : never }[keyof Cfg];
type ListKey = { [K in keyof Cfg]: Cfg[K] extends string[] ? K : never }[keyof Cfg];

const CFG0: Cfg = {
  a_rev45: "does",
  a_rev13: "asks",
  a_social: "asks",
  a_profile: "asks",
  a_listing: "does",
  a_article: "asks",
  a_web: "you",
  a_ref: "does",
  a_partner: "asks",
  a_default: "asks",
  ap_app: true,
  ap_text: true,
  ap_email: false,
  ap_auto: "Never",
  ap_undo: "10 seconds",
  rt_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  rt_check: "7:00 am",
  rt_quiet: "9 pm – 7 am",
  rt_brief: "Monday",
  rt_scan: "Nightly",
  t_gbp: "Can act",
  t_web: "Read only",
  t_li: "Read only",
  t_fb: "Can act",
  t_z: "Read only",
  t_yt: "Read only",
  v_tone: "Warm",
  v_sign: "— Alex",
  v_avoid: ["guarantee", "lowest rate", "best rate", "instant approval"],
  v_eho: true,
  n_text: true,
  n_email: true,
  n_neg: true,
  n_exp: true,
  n_comp: true,
  n_win: false,
  g_target: "Riverbend Bank & Trust",
  g_area: "3 miles",
  g_push: ["FHA", "VA", "First-time buyers"],
  g_goal: "450 by day 30",
  paused: false,
  mem: [0, 1, 2, 3, 4],
};

const MEM: [string, string][] = [
  ["You check in weekdays, early morning", "Interview · Oct 16"],
  ["The Alex Sample in Tampa isn't you", "Interview · Oct 16"],
  ["You don't offer reverse mortgages or non-QM", "Interview · Oct 16"],
  ["Your office line is (563) 555-0100, not the old branch line", "Interview · Oct 16"],
  ["You prefer short replies without exclamation marks", "Learned from your edits"],
];

const A = ["does", "asks", "you"];
const AL = ["NORA does it", "Asks first", "You do it"];

const SEC_KEYS = [
  "Autonomy",
  "Approvals",
  "Run time",
  "Tool access",
  "Voice and compliance",
  "Notifications",
  "Goals",
  "Memory and control",
  "Account and security",
  "Reviews and QR code",
] as const;
type SecKey = (typeof SEC_KEYS)[number];

type Ctl =
  | { kind: "seg"; k: StrKey; opts: string[]; labels?: string[] }
  | { kind: "toggle"; k: BoolKey | null }
  | { kind: "chips"; k: ListKey; all: string[]; addable?: boolean }
  | { kind: "select"; k: StrKey; opts: string[] }
  | { kind: "action"; cta: string; on: () => void; danger?: boolean; locked?: boolean }
  | { kind: "mem" };

type Row = [string, string, Ctl];

export function SettingsScreen() {
  return (
    <HappyflowShell
      screen="settings"
      day={1}
      title="NORA settings"
      sub="What NORA does on her own, when she works, and what she can touch."
      nora={{ thinks: THINKS }}
    >
      <SettingsBody />
    </HappyflowShell>
  );
}

function SettingsBody() {
  const PERSONA = useHfPersona();
  const t = usePersonalize();
  const hf = useHf();
  const { isD } = hf;
  const [sec, setSec] = useState<SecKey>("Autonomy");
  const [tip, setTip] = useState<"open" | "done" | "no">("open");
  const [c, setC] = useState<Cfg>(() => ({ ...CFG0, v_sign: t(CFG0.v_sign) }));

  const put = (k: StrKey, v: string) => setC((x) => ({ ...x, [k]: v }));
  const flip = (k: BoolKey) => setC((x) => ({ ...x, [k]: !x[k] }));
  const multi = (k: ListKey, v: string) =>
    setC((x) => {
      const a = x[k];
      return { ...x, [k]: a.includes(v) ? a.filter((y) => y !== v) : a.concat(v) };
    });

  const seg = (k: StrKey, opts: string[], labels?: string[]): Ctl => ({
    kind: "seg",
    k,
    opts,
    labels,
  });
  const tog = (k: BoolKey | null): Ctl => ({ kind: "toggle", k });
  const act = (cta: string, on: () => void, danger?: boolean, locked?: boolean): Ctl => ({
    kind: "action",
    cta,
    on,
    danger,
    locked,
  });

  const SECS: Record<SecKey, [HfIconName, string, Row[]]> = {
    Autonomy: [
      "sliders",
      'For each task, choose who does it. "Asks first" means I draft it and wait for your OK.',
      [
        ["Review replies, 4–5★", "I reply within a few hours", seg("a_rev45", A, AL)],
        [
          "Review replies, 1–3★",
          "Sensitive, so I never post these alone",
          seg("a_rev13", A.slice(1), AL.slice(1)),
        ],
        ["Social posts", "About 3 a week", seg("a_social", A, AL)],
        ["Profile edits", "Bio, hours, services", seg("a_profile", A, AL)],
        [
          "Listing corrections",
          "Fixing your phone, address and hours on other sites",
          seg("a_listing", A, AL),
        ],
        ["Articles (VOCE)", "Drafted from your expertise", seg("a_article", A, AL)],
        ["Website fixes", "Connect your Website / CMS and I can apply them", seg("a_web", A, AL)],
        ["Referral follow-ups", "Nudges after 5 days of silence", seg("a_ref", A, AL)],
        ["Partner requests", "Accepting agents who want to promote you", seg("a_partner", A, AL)],
        ["New kinds of tasks", "What I do when something new comes up", seg("a_default", A, AL)],
      ],
    ],
    Approvals: [
      "check",
      "How you approve what I draft, and what happens if you are busy.",
      [
        ["In the app", "Cards in Needs you", tog("ap_app")],
        ["By text", "Reply YES to (563) 555-0144", tog("ap_text")],
        ["By email", "alex.sample@demomortgage.com", tog("ap_email")],
        [
          "If you don’t answer",
          "I can go ahead after a while. Sensitive items always wait.",
          seg("ap_auto", ["Never", "After 24 hours", "After 48 hours"]),
        ],
        [
          "Undo window",
          "Time to take back anything after you approve",
          seg("ap_undo", ["10 seconds", "30 seconds", "1 minute"]),
        ],
        ["Compliance check", "Every draft is checked before it can go out", tog(null)],
      ],
    ],
    "Run time": [
      "clock",
      "When I work and when I stay quiet.",
      [
        [
          "Working days",
          "When I can post, reply and fix",
          { kind: "chips", k: "rt_days", all: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
        ],
        [
          "Daily check-in",
          "Your morning summary by text",
          {
            kind: "select",
            k: "rt_check",
            opts: ["6:00 am", "7:00 am", "8:00 am", "12:00 pm", "5:00 pm"],
          },
        ],
        [
          "Quiet hours",
          "No texts, except a 1–3★ review",
          {
            kind: "select",
            k: "rt_quiet",
            opts: ["8 pm – 7 am", "9 pm – 7 am", "10 pm – 6 am", "None"],
          },
        ],
        [
          "Weekly brief",
          "Your score, rank and what I did",
          { kind: "select", k: "rt_brief", opts: ["Monday", "Friday", "Sunday"] },
        ],
        ["Scans", "Score, map rank and AI citations", seg("rt_scan", ["Nightly", "Weekly"])],
      ],
    ],
    "Tool access": [
      "plug",
      "What I can read, and where I can act for you. Turning a tool to read only never deletes anything.",
      [
        [
          "Google Business Profile",
          "Replies, posts, hours, photos",
          seg("t_gbp", ["Read only", "Can act"]),
        ],
        ["Website", "demomortgage.com/alex-sample", seg("t_web", ["Read only", "Can act"])],
        ["LinkedIn", "Photo, title, credentials", seg("t_li", ["Read only", "Can act"])],
        ["Facebook", "Posts and messages", seg("t_fb", ["Read only", "Can act"])],
        ["Zillow", "Reviews shown on your profile", seg("t_z", ["Read only", "Can act"])],
        ["YouTube", "Your videos", seg("t_yt", ["Read only", "Can act"])],
        ["Search Console", "Not connected yet", act("Connect", () => hf.connect("Search Console"))],
      ],
    ],
    "Voice and compliance": [
      "msg",
      "How I sound when I write as you.",
      [
        ["Tone", "I also learn from your edits", seg("v_tone", ["Warm", "Professional", "Brief"])],
        [
          "Sign-off",
          c.v_sign,
          act("Change", () =>
            hf.openSheet(
              {
                title: "Sign-off",
                ph: "Sign-off",
                cta: "Save",
                nora: "I add this to replies and posts.",
                input: true,
                done: "Sign-off saved",
              },
              c.v_sign,
            ),
          ),
        ],
        [
          "Words I never use",
          "Tap one to remove it",
          { kind: "chips", k: "v_avoid", all: c.v_avoid, addable: true },
        ],
        ["NMLS number on every post", "NMLS 482913", tog(null)],
        ["No rate or approval promises", "I flag any draft that sounds like one", tog(null)],
        ["Equal Housing Opportunity line", "Added to social posts", tog("v_eho")],
      ],
    ],
    Notifications: [
      "bell",
      "How I reach you, and what counts as urgent.",
      [
        ["Text", "(563) 555-0144", tog("n_text")],
        ["Email", "alex.sample@demomortgage.com", tog("n_email")],
        ["A 1–3★ review", "Right away, even in quiet hours", tog("n_neg")],
        ["A connection is about to expire", "A few days before", tog("n_exp")],
        ["A competitor passes you", "In the map or the score", tog("n_comp")],
        ["Every small win", "Each reply posted, each point gained", tog("n_win")],
      ],
    ],
    Goals: [
      "target",
      "What I am working toward for you.",
      [
        ["Competitor to beat", c.g_target, act("Change", () => hf.go("insights"))],
        [
          "Area",
          "Around 100 Main St, Davenport",
          seg("g_area", ["1 mile", "3 miles", "5 miles", "10 miles"]),
        ],
        [
          "Loans to grow",
          "I write and post more about these",
          {
            kind: "chips",
            k: "g_push",
            all: [
              "Conventional",
              "FHA",
              "VA",
              "USDA",
              "Jumbo",
              "Refinance",
              "HELOC",
              "First-time buyers",
            ],
          },
        ],
        [
          "This month",
          "Score target",
          {
            kind: "select",
            k: "g_goal",
            opts: ["420 by day 30", "450 by day 30", "480 by day 30"],
          },
        ],
      ],
    ],
    "Memory and control": [
      "brain",
      "What I remember about you. Remove anything and I will forget it.",
      [
        ["What I remember", "", { kind: "mem" }],
        ["Pause NORA", "I stop posting and fixing. Your profile stays live.", tog("paused")],
        [
          "Reset NORA",
          "Clears my memory and settings. Your profile and reviews stay.",
          act(
            "Reset",
            () =>
              hf.openSheet({
                title: "Reset NORA?",
                body: "I will forget what I learned about you and go back to default settings. Your profile, reviews and connections stay.",
                cta: "Reset NORA",
                nora: "You can run the interview again afterwards.",
                done: "NORA reset",
              }),
            true,
          ),
        ],
      ],
    ],
    "Account and security": [
      "shield",
      "How you sign in and how we reach you if you are locked out.",
      [
        [
          "Recovery email",
          PERSONA.email,
          act("Change", () =>
            hf.openSheet(
              {
                title: "Recovery email",
                input: true,
                ph: "Email",
                cta: "Save",
                nora: "We send a confirmation link to the new address before it takes over.",
                done: "Check your inbox to confirm the new recovery email",
              },
              PERSONA.email,
            ),
          ),
        ],
        [
          "Phone number",
          `${PERSONA.mobile} · sign-in codes and texts`,
          act("Change", () =>
            hf.openSheet(
              {
                title: "Phone number",
                input: true,
                ph: "Mobile number",
                cta: "Send code",
                nora: "We text a code to confirm the new number.",
                done: "Code sent",
              },
              PERSONA.mobile,
            ),
          ),
        ],
        [
          "Password",
          "Reset it with a link sent to your email",
          act("Reset password", () =>
            hf.openSheet({
              title: "Reset your password?",
              body: `We will email a reset link to ${PERSONA.email}. The link works once and expires after an hour.`,
              cta: "Send reset link",
              nora: "Your profile, reviews and connections are not affected.",
              done: "Reset link sent",
            }),
          ),
        ],
      ],
    ],
    "Reviews and QR code": [
      "star",
      "How reviews are requested and answered, and the QR code that sends clients to your review page.",
      [
        [
          "Review settings",
          "Request timing, auto-replies and which reviews show on your profile — available soon",
          act("Locked", () => hf.toast("Review settings are not configurable yet"), false, true),
        ],
        [
          "Review QR code",
          "Print it or show it on your phone — it opens your review page",
          act("Show QR code", () =>
            hf.openSheet({
              title: "Your review QR code",
              body: "Clients scan it to land on your Experience.com review page. Add it to closing packets, email signatures and your office desk.",
              cta: "Download PNG",
              nora: "I can add it to your closing follow-up texts too.",
              done: "QR code downloaded",
            }),
          ),
        ],
      ],
    ],
  };

  const cur = SECS[sec];
  const tipOn = sec === "Autonomy" && tip === "open" && c.a_social !== "does";
  const p = c.paused;

  const renderCtl = (l: string, ctl: Ctl): ReactNode => {
    switch (ctl.kind) {
      case "seg":
        return (
          <div
            style={{
              display: "inline-flex",
              flexWrap: "wrap",
              gap: 2,
              borderRadius: 12,
              background: "#f1f3f4",
              padding: 3,
            }}
          >
            {ctl.opts.map((o, i) => {
              const on = c[ctl.k] === o;
              return (
                <button
                  type="button"
                  key={o}
                  onClick={() => put(ctl.k, o)}
                  style={{
                    height: 32,
                    border: 0,
                    borderRadius: 9,
                    background: on ? "#fff" : "transparent",
                    padding: "0 12px",
                    font: "700 12px Arial,sans-serif",
                    color: on ? "#1967d2" : "#5f6368",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    boxShadow: on ? "0 1px 3px rgba(60,64,67,.15)" : "none",
                  }}
                >
                  {ctl.labels ? ctl.labels[i] : o}
                </button>
              );
            })}
          </div>
        );
      case "toggle": {
        const k = ctl.k;
        return (
          <Toggle
            on={k ? c[k] : true}
            locked={!k}
            label={l}
            onClick={() => (k ? flip(k) : undefined)}
          />
        );
      }
      case "chips":
        return (
          <div style={{ flex: "1 1 100%", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ctl.all.map((o) => {
              const on = c[ctl.k].includes(o);
              return (
                <button
                  type="button"
                  key={o}
                  onClick={() => multi(ctl.k, o)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 34,
                    border: `1.5px solid ${on ? "#c6dafc" : "#e3e5e8"}`,
                    borderRadius: 999,
                    background: on ? "#e8f0fe" : "#fff",
                    padding: "0 12px",
                    font: "700 12px Arial,sans-serif",
                    color: on ? "#1967d2" : "#80868b",
                    cursor: "pointer",
                  }}
                >
                  {on ? <Tick size={11} color="#1967d2" /> : null}
                  {o}
                </button>
              );
            })}
            {ctl.addable ? (
              <button
                type="button"
                onClick={() =>
                  hf.openSheet(
                    {
                      title: "Add a word to avoid",
                      ph: "Word or phrase",
                      cta: "Add",
                      nora: "I will never use it in anything I write for you.",
                      input: true,
                      done: "Added to words I avoid",
                    },
                    "",
                  )
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 34,
                  border: "1.5px dashed #c6dafc",
                  borderRadius: 999,
                  background: "#fff",
                  padding: "0 12px",
                  font: "700 12px Arial,sans-serif",
                  color: "#1a73e8",
                  cursor: "pointer",
                }}
              >
                <Ic name="plus" size={16} />
                Add
              </button>
            ) : null}
          </div>
        );
      case "select":
        return (
          <select
            value={c[ctl.k]}
            onChange={(e) => put(ctl.k, e.target.value)}
            aria-label={l}
            style={{
              height: 38,
              minWidth: 150,
              border: "1.5px solid #dadce0",
              borderRadius: 12,
              background: "#fff",
              padding: "0 10px",
              font: "600 14px Arial,sans-serif",
              color: "#202124",
              cursor: "pointer",
            }}
          >
            {ctl.opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case "action":
        return (
          <button
            type="button"
            onClick={ctl.on}
            aria-disabled={ctl.locked || undefined}
            style={{
              height: 38,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `1px solid ${ctl.locked ? "#fbe3a4" : ctl.danger ? "#f6c7c3" : "#d2e3fc"}`,
              borderRadius: 12,
              background: ctl.locked ? "#fef7e0" : ctl.danger ? "#fce8e6" : "#fff",
              padding: "0 16px",
              font: "700 13px Arial,sans-serif",
              color: ctl.locked ? "#b06000" : ctl.danger ? "#c5221f" : "#1a73e8",
              cursor: ctl.locked ? "default" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {ctl.locked ? <Ic name="lock" size={13} color="#b06000" sw={2.4} /> : null}
            {ctl.cta}
          </button>
        );
      case "mem":
        return (
          <div style={{ flex: "1 1 100%", display: "flex", flexDirection: "column", gap: 6 }}>
            {c.mem.map((i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 12,
                  background: "#f8f9fb",
                  padding: "10px 12px",
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4 }}>
                  {t(MEM[i][0])}
                </span>
                <span style={{ fontSize: 11, color: "#80868b", whiteSpace: "nowrap" }}>
                  {MEM[i][1]}
                </span>
                <button
                  type="button"
                  onClick={() => setC((x) => ({ ...x, mem: x.mem.filter((j) => j !== i) }))}
                  aria-label="Forget"
                  style={{
                    width: 28,
                    height: 28,
                    flex: "none",
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
          </div>
        );
    }
  };

  return (
    <>
      <section
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          borderRadius: 20,
          background: p ? "#fef7e0" : "#e6f4ea",
          border: `1.5px solid ${p ? "#fbe3a4" : "#ceead6"}`,
          padding: "14px 16px",
          animation: "hf-rise .32s ease both",
        }}
      >
        <NoraFace size={40} mood={p ? "idle" : "working"} />
        <div
          style={{
            flex: "1 1 220px",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <b style={{ fontSize: 15 }}>{p ? "NORA is paused" : "NORA is on"}</b>
          <span style={{ fontSize: 13, color: "#5f6368" }}>
            {p
              ? "Nothing goes out until you resume. Your profile stays live."
              : `Working ${c.rt_days.length === 7 ? "every day" : c.rt_days.join(", ")} · check-in at ${c.rt_check} · quiet ${c.rt_quiet}`}
          </span>
        </div>
      </section>
      <div
        style={{
          display: "grid",
          gap: 16,
          ...(isD
            ? { gridTemplateColumns: "240px minmax(0,1fr)", alignItems: "start" }
            : { gridTemplateColumns: "minmax(0,1fr)" }),
        }}
      >
        <nav
          style={{
            position: isD ? "sticky" : "relative",
            top: 0,
            display: "flex",
            flexDirection: isD ? "column" : "row",
            gap: 4,
            overflowX: "auto",
            padding: 2,
          }}
        >
          {SEC_KEYS.map((k) => {
            const on = k === sec;
            return (
              <button
                type="button"
                key={k}
                onClick={() => setSec(k)}
                style={{
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: isD ? 44 : 38,
                  border: on
                    ? "1.5px solid #c6dafc"
                    : isD
                      ? "1.5px solid transparent"
                      : "1.5px solid #e3e5e8",
                  borderRadius: isD ? 12 : 999,
                  background: on ? "#e8f0fe" : isD ? "transparent" : "#fff",
                  padding: "0 14px",
                  font: `${on ? 700 : 500} 14px Arial,sans-serif`,
                  color: on ? "#1967d2" : "#3c4043",
                  cursor: "pointer",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                }}
              >
                <Ic name={SECS[k][0]} size={16} />
                {k}
              </button>
            );
          })}
        </nav>
        <section
          style={{
            minWidth: 0,
            borderRadius: 24,
            background: "rgba(255,255,255,.96)",
            padding: isD ? "20px 22px" : "14px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            boxShadow: "0 4px 12px rgba(66,133,244,.08)",
            animation: "hf-rise .3s ease both",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 4px 8px" }}>
            <span style={{ fontSize: 20, fontWeight: 700 }}>{sec}</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: "#5f6368" }}>{cur[1]}</span>
          </div>
          {tipOn ? (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                borderRadius: 16,
                background: "#eef3fe",
                border: "1.5px solid #d2e3fc",
                padding: "12px 14px",
                marginBottom: 6,
              }}
            >
              <NoraFace size={26} />
              <span style={{ flex: "1 1 200px", fontSize: 14, lineHeight: 1.45 }}>
                You approved all 6 of my social posts without changes. Want me to post them on my
                own?
              </span>
              <button
                type="button"
                onClick={() => {
                  setTip("done");
                  put("a_social", "does");
                }}
                style={{
                  height: 36,
                  border: 0,
                  borderRadius: 10,
                  background: "#1a73e8",
                  padding: "0 14px",
                  font: "700 13px Arial,sans-serif",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Yes, post them
              </button>
              <button
                type="button"
                onClick={() => setTip("no")}
                style={{
                  height: 36,
                  border: "1px solid #d2e3fc",
                  borderRadius: 10,
                  background: "#fff",
                  padding: "0 12px",
                  font: "700 13px Arial,sans-serif",
                  color: "#1a73e8",
                  cursor: "pointer",
                }}
              >
                Not now
              </button>
            </div>
          ) : null}
          {cur[2].map(([l, sub, ctl], i) => {
            const lock = ctl.kind === "toggle" && ctl.k === null;
            return (
              <div
                key={l}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  borderTop: i ? "1px solid #f1f3f4" : "0",
                  padding: "14px 4px",
                }}
              >
                <div
                  style={{
                    flex: "1 1 220px",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                  >
                    {l}
                    {lock ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          borderRadius: 999,
                          background: "#e6f4ea",
                          padding: "1px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#137333",
                        }}
                      >
                        <Ic name="shield" size={12} color="#137333" sw={2.4} />
                        Always on
                      </span>
                    ) : null}
                  </span>
                  {sub ? (
                    <span style={{ fontSize: 12, lineHeight: 1.4, color: "#5f6368" }}>{sub}</span>
                  ) : null}
                </div>
                {renderCtl(l, ctl)}
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
