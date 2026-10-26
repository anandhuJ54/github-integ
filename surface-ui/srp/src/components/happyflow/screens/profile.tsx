/**
 * Screen 7 · Profile — every fact NORA knows about Dana, with its source.
 * Ported 1:1 from the Happyflow prototype (SRP App, `sProfile`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DANA, PRODUCTS } from "../demo-data";
import { HappyflowShell, useHf, type HfApi, type Think } from "../shell";
import { Hov, Ic, NoraFace, ProBadge } from "../primitives";
import { useSpeech } from "../use-speech";
import type { HfIconName } from "../icons";
import { extractProfileChanges, type ProfileChanges, type ProfileField } from "./profile-voice";
import { loadStored, saveStored } from "./profile-store";

// Demo data (Happyflow prototype)
const HEAD = ["Profile", "Every fact NORA knows about you, with its source."] as const;

const BIO_DRAFT =
  "Dana Whitfield has helped Quad Cities families buy and refinance homes for 12 years, with a focus on first-time buyers and FHA and VA loans.";

const PEARL_BG =
  "radial-gradient(120% 90% at 0% 0%,oklch(0.965 0.021 30) 0%,transparent 55%),radial-gradient(110% 90% at 100% 0%,oklch(0.955 0.025 285) 0%,transparent 55%),linear-gradient(180deg,oklch(0.985 0.004 285),#fff)";

/** Profile facts are editable for the demo session; `apply` writes changes and returns what changed. */
type Apply = (changes: ProfileChanges, how: string) => ProfileField[];

const INITIAL: Record<ProfileField, string> = {
  Name: DANA.name,
  Title: DANA.title,
  Bio: "Thin",
  "Year started": "",
  Office: DANA.officePhone,
  Mobile: DANA.mobile,
  Email: DANA.email,
  Address: DANA.address,
  Hours: "Mon–Fri 9:00–5:00",
  NMLS: DANA.nmls,
  "Licensed in": DANA.states,
  "Service areas": "",
  Designations: "",
  Awards: "",
  Education: "",
};

/** Which demo fields each card's edit sheet shows (every one can be typed or dictated). */
const CARD_FIELDS: Record<string, ProfileField[]> = {
  Identity: ["Name", "Title", "Bio", "Year started"],
  Contact: ["Office", "Mobile", "Email", "Address", "Hours"],
  Licences: ["NMLS", "Licensed in"],
  "Services and areas": ["Service areas"],
  Credentials: ["Designations", "Awards", "Education"],
};

type ProfileState = {
  f: Record<ProfileField, string>;
  src: Partial<Record<ProfileField, string>>;
  apply: Apply;
  /** Fields changed by the latest save — flashed green on the card. */
  recent: ProfileField[];
  reset: () => void;
};

const ProfileCtx = createContext<ProfileState | null>(null);
function useProfile() {
  const v = useContext(ProfileCtx);
  if (!v) throw new Error("useProfile must be used inside ProfileScreen");
  return v;
}

const FIELDS = Object.keys(INITIAL) as ProfileField[];
const isField = (k: string): k is ProfileField => (FIELDS as string[]).includes(k);

const CARD_ORDER = Object.keys(CARD_FIELDS);
/** Which card a field lives on, for the review list. */
const FIELD_CARD = Object.fromEntries(
  Object.entries(CARD_FIELDS).flatMap(([card, keys]) => keys.map((k) => [k, card])),
) as Partial<Record<ProfileField, string>>;

type SheetApi = Pick<HfApi, "openSheet" | "closeSheet" | "toast">;

/**
 * Read a voice/typed note, then show what was found — field, current value, new value — and
 * apply only what the user approves. "Back" returns to the note with the text kept.
 */
function reviewNote(
  api: SheetApi,
  apply: Apply,
  f: Record<ProfileField, string>,
  text: string,
  how: string,
  back: (text: string) => void,
) {
  if (!text.trim()) return;
  api.openSheet({
    title: "Review changes",
    cta: "",
    hideCta: true,
    content: (
      <ReviewChanges
        key={text}
        note={text}
        found={extractProfileChanges(text)}
        current={f}
        onApply={(sel) => {
          api.closeSheet();
          const changed = apply(sel, how);
          api.toast(`Updated ${changed.map((k) => k.toLowerCase()).join(", ")}`);
        }}
        onBack={() => back(text)}
        onCancel={api.closeSheet}
      />
    ),
  });
}

/** One edit per card: a single box — type or tap the mic, in your own words. */
function editCard(
  api: SheetApi,
  apply: Apply,
  title: string,
  f: Record<ProfileField, string>,
  value = "",
) {
  const t = title.toLowerCase();
  api.openSheet(
    {
      title: "Edit profile",
      input: true,
      ph: `Started from ${t} — change anything in one go, e.g. “name Dana Ross and phone 563 555 0177”`,
      cta: "Continue",
      nora: "Change any fields across your profile at once, in your own words. I'll show you what I found before anything changes.",
      onSave: (text) =>
        reviewNote(api, apply, f, text, "Updated by you · just now", (v) =>
          editCard(api, apply, title, f, v),
        ),
    },
    value,
  );
}

function openEdit(api: Pick<HfApi, "openSheet">, apply: Apply, k: string, v: string) {
  api.openSheet(
    {
      title: "Edit " + k.toLowerCase(),
      ph: k,
      cta: "Save",
      nora: "I'll update this everywhere it shows.",
      input: true,
      done: `Saved · I'll update ${k.toLowerCase()} everywhere`,
      onSave: (val) => {
        if (isField(k) && val.trim()) apply({ [k]: val.trim() }, "Updated by you · just now");
      },
    },
    v,
  );
}

function openBio(api: Pick<HfApi, "openSheet">, apply: Apply) {
  api.openSheet(
    {
      title: "Your bio",
      ph: "Bio",
      cta: "Approve bio",
      nora: "I wrote this from your website and LinkedIn. Approve it and I'll publish it everywhere.",
      input: true,
      done: "Bio approved · +8 points",
      onSave: (val) => {
        if (val.trim()) apply({ Bio: val.trim() }, "Approved by you · just now");
      },
    },
    BIO_DRAFT,
  );
}

const makeThinks = (apply: Apply): Think[] => [
  {
    t: "Your bio is thin.",
    d: "I drafted a fuller one from your website and LinkedIn. It's ready for your OK.",
    cta: "Review draft",
    act: (api) => openBio(api, apply),
  },
  {
    t: "Two things are missing.",
    d: "Year started and service areas both count toward Completeness — 55 points are open there.",
    cta: "Add service areas",
    act: (api) => openEdit(api, apply, "Service areas", ""),
  },
];

type RowSpec = {
  k: string;
  v: string;
  src: string;
  nora?: boolean;
  cta?: string;
  ctaOn?: () => void;
  missSrc?: string;
};
type CardSpec = {
  title: string;
  icon: HfIconName;
  note?: string;
  noteFg?: string;
  chips?: string[];
  rows?: RowSpec[];
  nora?: boolean;
  bars?: [string, number, string][];
};

const row = (
  k: string,
  v: string,
  src: string,
  o: Omit<RowSpec, "k" | "v" | "src"> = {},
): RowSpec => ({ k, v, src, ...o });

export function ProfileScreen() {
  const [stored] = useState(() => loadStored(INITIAL));
  const [f, setF] = useState(stored?.f ?? INITIAL);
  const [src, setSrc] = useState<Partial<Record<ProfileField, string>>>(stored?.src ?? {});
  const [recent, setRecent] = useState<ProfileField[]>([]);

  useEffect(() => {
    saveStored(f, src);
  }, [f, src]);

  useEffect(() => {
    if (!recent.length) return;
    const t = setTimeout(() => setRecent([]), 4000);
    return () => clearTimeout(t);
  }, [recent]);

  const apply = useCallback<Apply>((changes, how) => {
    const keys = (Object.keys(changes) as ProfileField[]).filter((k) => changes[k]);
    if (keys.length) {
      setF((x) => ({ ...x, ...changes }));
      setSrc((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, how])) }));
      setRecent(keys);
    }
    return keys;
  }, []);
  const reset = useCallback(() => {
    setF(INITIAL);
    setSrc({});
    setRecent([]);
  }, []);
  const state = useMemo(() => ({ f, src, apply, recent, reset }), [f, src, apply, recent, reset]);
  const thinks = useMemo(() => makeThinks(apply), [apply]);
  return (
    <ProfileCtx.Provider value={state}>
      <HappyflowShell
        screen="profile"
        day={1}
        title={HEAD[0]}
        sub={HEAD[1]}
        nora={{ thinks }}
        headerRight={<ResetDemoButton />}
      >
        <ProfileBody />
      </HappyflowShell>
    </ProfileCtx.Provider>
  );
}

/** Shown once the demo profile has been edited: puts Dana's original demo values back. */
function ResetDemoButton() {
  const hf = useHf();
  const { src, reset } = useProfile();
  if (!Object.keys(src).length) return null;
  return (
    <button
      type="button"
      onClick={() => {
        reset();
        hf.toast("Demo profile reset");
      }}
      style={{
        flex: "none",
        height: 40,
        border: "1px solid #dadce0",
        borderRadius: 999,
        background: "#fff",
        padding: "0 14px",
        font: "700 13px Arial,sans-serif",
        color: "#3c4043",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      Reset demo
    </button>
  );
}

function ProfileBody() {
  const hf = useHf();
  const { f, src, apply, recent } = useProfile();
  const from = (k: ProfileField, dflt: string) => src[k] ?? dflt;
  const { isD } = hf;
  const [creds, setCreds] = useState<"open" | "added" | "skip">("open");
  const [mini, setMini] = useState(false);

  const jump = (title: string) =>
    document
      .getElementById("hf-prof-" + title)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  // Quick actions stay on the preview card in both its full and minimized form.
  const quick: [string, () => void][] = [
    [`Reviews (${DANA.reviews})`, () => hf.go("reviews")],
    [`★ ${DANA.rating} rating`, () => hf.go("reviews")],
    ["About", () => jump("Identity")],
    ["Services", () => jump("Services and areas")],
    ["Licences", () => jump("Licences")],
    ["Contact", () => jump("Contact")],
  ];
  const quickRow = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {quick.map(([l, on]) => (
        <Hov
          key={l}
          onClick={on}
          style={{
            height: 30,
            border: "1px solid #d2e3fc",
            borderRadius: 999,
            background: "#f5f9ff",
            padding: "0 12px",
            font: "700 12px Arial,sans-serif",
            color: "#1967d2",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          hover={{ background: "#e8f0fe" }}
        >
          {l}
        </Hov>
      ))}
    </div>
  );
  const miniBtn = (
    <button
      type="button"
      onClick={() => setMini((m) => !m)}
      aria-label={mini ? "Expand profile preview" : "Minimize profile preview"}
      aria-expanded={!mini}
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 1,
        height: 30,
        border: 0,
        borderRadius: 999,
        background: "rgba(255,255,255,.9)",
        padding: "0 12px",
        font: "700 12px Arial,sans-serif",
        color: "#1a73e8",
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(60,64,67,.12)",
      }}
    >
      {mini ? "Expand" : "Minimize"}
    </button>
  );

  const credsT =
    creds === "added"
      ? "Added 2 certifications from LinkedIn."
      : "I found 2 certifications on LinkedIn. Add them?";
  const addCreds = () => {
    setCreds("added");
    apply({ Designations: "2 certifications" }, "From LinkedIn · added by you");
    hf.toast("Added · Credentials lane +points next scan");
  };
  const credCount = [f.Designations, f.Awards, f.Education].filter(Boolean).length;

  const cards: CardSpec[] = [
    {
      title: "Identity",
      icon: "user",
      rows: [
        row("Name", f.Name, from("Name", "From LinkedIn")),
        row("Title", f.Title, from("Title", "From LinkedIn")),
        row("Photo", "Profile photo", "From LinkedIn"),
        src.Bio
          ? row("Bio", f.Bio, src.Bio)
          : row("Bio", f.Bio, "NORA draft ready", {
              nora: true,
              cta: "Review draft",
              ctaOn: () => openBio(hf, apply),
            }),
        row("Year started", f["Year started"], from("Year started", "")),
      ],
    },
    {
      title: "Contact",
      icon: "phone",
      rows: [
        row("Office", f.Office, from("Office", "Confirmed by you · Oct 16")),
        row("Mobile", f.Mobile, from("Mobile", "Confirmed by you · Oct 16")),
        row("Email", f.Email, from("Email", "Confirmed by you · Oct 16")),
        row("Address", f.Address, from("Address", "Confirmed by you · Oct 16")),
        row("Hours", f.Hours, from("Hours", "From Google")),
      ],
    },
    {
      title: "Licences",
      icon: "badge",
      rows: [
        row("NMLS", f.NMLS, from("NMLS", "Confirmed by you · Oct 16")),
        row("Licensed in", f["Licensed in"], from("Licensed in", "From NMLS")),
      ],
    },
    {
      title: "Services and areas",
      icon: "list",
      note: "9 loan products",
      noteFg: "#1967d2",
      chips: PRODUCTS,
      rows: [row("Service areas", f["Service areas"], from("Service areas", ""))],
    },
    {
      title: "Credentials",
      icon: "award",
      note: credCount ? `${credCount} of 3 added` : "Missing",
      noteFg: credCount ? "#137333" : "#b06000",
      rows: [
        row("Designations", f.Designations, from("Designations", "")),
        row("Awards", f.Awards, from("Awards", "")),
        row("Education", f.Education, from("Education", "")),
      ],
      nora: creds !== "skip",
    },
    {
      title: "Expertise graph",
      icon: "share",
      note: "67 facts from 6 sources",
      noteFg: "#5f6368",
      bars: [
        ["Identity", 12, "#4285f4"],
        ["Contact", 9, "#ea4335"],
        ["Licence", 6, "#fbbc04"],
        ["Products", 11, "#9b72f2"],
        ["Reviews", 15, "#34a853"],
        ["Presence", 14, "#4285f4"],
      ],
    },
  ];

  // Pieces of the public profile preview, shared by the desktop (horizontal) and mobile layouts.
  const previewIdentity = (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>{f.Name}</span>
        <ProBadge />
      </span>
      <span style={{ fontSize: 14, color: "#5f6368" }}>
        {f.Title} · {DANA.company}
      </span>
      <span style={{ fontSize: 13, color: "#5f6368" }}>
        <span style={{ color: "#f9ab00" }}>★</span>{" "}
        <b style={{ color: "#202124" }}>{DANA.rating}</b> ({DANA.reviews}) · {DANA.city} · NMLS{" "}
        {DANA.nmls}
      </span>
    </div>
  );
  const previewClaimed = (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: 999,
          background: "#e8f0fe",
          padding: "3px 10px 3px 4px",
          fontSize: 12,
          fontWeight: 700,
          color: "#1967d2",
        }}
      >
        <NoraFace size={18} />
        Claimed · managed by NORA
      </span>
      <button
        type="button"
        onClick={() => hf.toast("Opens your public profile")}
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "none",
          padding: 0,
          font: "700 12px Arial,sans-serif",
          color: "#1a73e8",
          cursor: "pointer",
        }}
      >
        View public profile →
      </button>
    </div>
  );
  const previewRing = (
    <div style={{ position: "relative", width: 64, height: 64, flex: "none" }}>
      <svg viewBox="0 0 36 36" style={{ width: 64, height: 64, transform: "rotate(-90deg)" }}>
        <defs>
          <linearGradient id="hf-prof-cmpG" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#4285f4" />
            <stop offset="1" stopColor="#9b72f2" />
          </linearGradient>
        </defs>
        <circle
          cx="18"
          cy="18"
          r="15.9"
          style={{ fill: "none", stroke: "#eceef1", strokeWidth: 3.2 }}
        />
        <circle
          cx="18"
          cy="18"
          r="15.9"
          style={{
            fill: "none",
            stroke: "url(#hf-prof-cmpG)",
            strokeWidth: 3.2,
            strokeLinecap: "round",
            strokeDasharray: "64 100",
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <b style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>64%</b>
        <span style={{ fontSize: 8, color: "#80868b" }}>complete</span>
      </div>
    </div>
  );
  const previewChips = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {PRODUCTS.slice(0, 5).map((s) => (
        <span
          key={s}
          style={{
            borderRadius: 999,
            background: "#f1f3f4",
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 600,
            color: "#3c4043",
          }}
        >
          {s}
        </span>
      ))}
      <span
        style={{
          borderRadius: 999,
          background: "#f1f3f4",
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 600,
          color: "#5f6368",
        }}
      >
        +4
      </span>
    </div>
  );
  const previewPhoto = (size: number) => (
    <img
      src={DANA.photo}
      alt=""
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        objectFit: "cover",
        objectPosition: DANA.photoPos,
        boxShadow: "0 0 0 4px #fff",
      }}
    />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section
        style={{
          position: "relative",
          borderRadius: 24,
          background: "#fff",
          overflow: "hidden",
          boxShadow: "0 12px 32px rgba(66,133,244,.12)",
          animation: "hf-rise .32s ease both",
        }}
      >
        {miniBtn}
        {mini ? (
          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 90 }}>
              <img
                src={DANA.photo}
                alt=""
                style={{
                  width: 44,
                  height: 44,
                  flex: "none",
                  borderRadius: "50%",
                  objectFit: "cover",
                  objectPosition: DANA.photoPos,
                }}
              />
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ fontSize: 15 }}>{f.Name}</b>
                  <ProBadge size="sm" />
                </span>
                <span style={{ fontSize: 12, color: "#5f6368" }}>
                  <span style={{ color: "#f9ab00" }}>★</span> {DANA.rating} ({DANA.reviews}) · 64%
                  complete
                </span>
              </div>
            </div>
            {quickRow}
          </div>
        ) : isD ? (
          <div
            style={{
              backgroundImage: PEARL_BG,
              padding: "22px 24px",
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            {previewPhoto(104)}
            <div
              style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}
            >
              {previewIdentity}
              {quickRow}
              {previewChips}
            </div>
            <div
              style={{
                flex: "none",
                width: 300,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                paddingTop: 28,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {previewClaimed}
                {previewRing}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ height: 88, backgroundImage: PEARL_BG }} />
            <div
              style={{
                padding: "0 22px 22px",
                marginTop: -44,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {previewPhoto(88)}
              {previewIdentity}
              {quickRow}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {previewClaimed}
                {previewRing}
              </div>
              {previewChips}
            </div>
          </>
        )}
      </section>

      <div
        style={{
          display: "grid",
          gap: 12,
          minWidth: 0,
          alignItems: "start",
          gridTemplateColumns: isD ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)",
        }}
      >
        {cards.map((c, i) => (
          <section
            key={c.title}
            id={"hf-prof-" + c.title}
            style={{
              scrollMarginTop: 16,
              borderRadius: 22,
              background: "rgba(255,255,255,.95)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow: "0 4px 12px rgba(66,133,244,.08)",
              animation: `hf-rise .32s ease ${60 + i * 50}ms both`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  flex: "none",
                  borderRadius: 10,
                  background: "#e8f0fe",
                  display: "grid",
                  placeItems: "center",
                  color: "#1a73e8",
                }}
              >
                <Ic name={c.icon} size={16} />
              </span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{c.title}</span>
              {c.note ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: c.noteFg || "#5f6368" }}>
                  {c.note}
                </span>
              ) : null}
              {c.rows && c.rows.length ? (
                <button
                  type="button"
                  onClick={() => editCard(hf, apply, c.title, f)}
                  aria-label={`Edit ${c.title.toLowerCase()}`}
                  style={{
                    width: 32,
                    height: 32,
                    flex: "none",
                    border: 0,
                    borderRadius: "50%",
                    background: "#f1f3f4",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                    color: "#5f6368",
                  }}
                >
                  <Ic name="pen" size={14} />
                </button>
              ) : null}
            </div>

            {(c.rows || []).map((r) => {
              const miss = !r.v;
              const flash = (recent as string[]).includes(r.k);
              const src = miss ? r.missSrc || "Not found anywhere yet" : r.src;
              const srcFg = r.nora
                ? "#7b4ce0"
                : miss
                  ? "#b06000"
                  : r.src.startsWith("Confirmed") ||
                      r.src.startsWith("Verified") ||
                      r.src.startsWith("Updated") ||
                      r.src.startsWith("Approved")
                    ? "#137333"
                    : "#80868b";
              return (
                <div
                  key={r.k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    borderRadius: 14,
                    border: `1.5px ${miss ? "dashed" : "solid"} ${flash ? "#34a853" : miss ? "#dadce0" : "transparent"}`,
                    background: flash ? "#e6f4ea" : miss ? "#fff" : "#f8f9fb",
                    transition: "background .6s ease, border-color .6s ease",
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#80868b" }}>{r.k}</span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: miss ? 400 : 600,
                        color: miss ? "#9aa0a6" : "#202124",
                        wordBreak: "break-word",
                      }}
                    >
                      {miss ? "Missing" : r.v}
                    </span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        color: srcFg,
                      }}
                    >
                      <span
                        style={{ width: 5, height: 5, borderRadius: "50%", background: srcFg }}
                      />
                      {src}
                    </span>
                  </div>
                  {r.cta ? (
                    <button
                      type="button"
                      onClick={r.ctaOn}
                      style={{
                        flex: "none",
                        height: 30,
                        border: 0,
                        borderRadius: 999,
                        background: "#1a73e8",
                        padding: "0 12px",
                        font: "700 12px Arial,sans-serif",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {r.cta}
                    </button>
                  ) : null}
                </div>
              );
            })}

            {c.chips ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {c.chips.map((s) => (
                  <span
                    key={s}
                    style={{
                      borderRadius: 999,
                      background: "#e8f0fe",
                      padding: "5px 11px",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#1967d2",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : null}

            {c.nora ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  borderRadius: 14,
                  background: "#eef3fe",
                  padding: "10px 12px",
                }}
              >
                <NoraFace size={26} />
                <span style={{ flex: "1 1 180px", fontSize: 13, lineHeight: 1.45 }}>{credsT}</span>
                {creds === "open" ? (
                  <>
                    <button
                      type="button"
                      onClick={addCreds}
                      style={{
                        height: 32,
                        border: 0,
                        borderRadius: 10,
                        background: "#1a73e8",
                        padding: "0 12px",
                        font: "700 12px Arial,sans-serif",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Add them
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreds("skip")}
                      style={{
                        height: 32,
                        border: "1px solid #d2e3fc",
                        borderRadius: 10,
                        background: "#fff",
                        padding: "0 12px",
                        font: "700 12px Arial,sans-serif",
                        color: "#1a73e8",
                        cursor: "pointer",
                      }}
                    >
                      Not now
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {c.bars ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {c.bars.map(([l, n, col]) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => hf.toast(`${l}: ${n} facts · sources shown on each fact`)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px minmax(0,1fr) 28px",
                      alignItems: "center",
                      gap: 10,
                      border: 0,
                      background: "none",
                      padding: 0,
                      font: "13px Arial,sans-serif",
                      color: "#202124",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{l}</span>
                    <span
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: "#eceef1",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: ((n / 15) * 100).toFixed(0) + "%",
                          borderRadius: 4,
                          background: col,
                          transformOrigin: "left",
                          animation: "hf-grow .8s cubic-bezier(.2,.8,.2,1) both",
                        }}
                      />
                    </span>
                    <b style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{n}</b>
                  </button>
                ))}
                <span style={{ fontSize: 12, color: "#80868b" }}>
                  Tap any fact to see its source
                </span>
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

/** What NORA found in a note, for the user to check, correct and approve before anything changes. */
function ReviewChanges({
  note,
  found,
  current,
  onApply,
  onBack,
  onCancel,
}: {
  note: string;
  found: ProfileChanges;
  current: Record<ProfileField, string>;
  onApply: (changes: ProfileChanges) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const keys = Object.keys(found) as ProfileField[];
  const [vals, setVals] = useState<ProfileChanges>(found);
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(keys.map((k) => [k, found[k] !== current[k]])),
  );
  const picked = keys.filter((k) => on[k] && (vals[k] ?? "").trim());
  const doIt = () => {
    if (picked.length) onApply(Object.fromEntries(picked.map((k) => [k, (vals[k] ?? "").trim()])));
  };

  // Answer by voice: "do it" applies the ticked changes, "cancel" closes without changing anything.
  const act = useRef({ doIt, onCancel });
  act.current = { doIt, onCancel };
  const handled = useRef(false);
  const speech = useSpeech((heard) => {
    if (handled.current) return;
    const t = heard.toLowerCase();
    if (/\b(cancel|never ?mind|don'?t|stop|no)\b/.test(t)) {
      handled.current = true;
      act.current.onCancel();
    } else if (/\b(do it|yes|go ahead|apply|confirm|okay|ok|sure|save)\b/.test(t)) {
      handled.current = true;
      act.current.doIt();
    }
  });
  const { start: listen } = speech;
  useEffect(() => {
    if (keys.length) listen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const btn = (primary: boolean, disabled = false): CSSProperties => ({
    flex: primary ? 1 : "none",
    height: 44,
    border: primary ? 0 : "1px solid #dadce0",
    borderRadius: 12,
    background: primary ? (disabled ? "#c6dafc" : "#1a73e8") : "#fff",
    padding: "0 16px",
    font: "700 14px Arial,sans-serif",
    color: primary ? "#fff" : "#3c4043",
    cursor: disabled ? "default" : "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          borderRadius: 12,
          background: "#f8f9fb",
          padding: "10px 12px",
          fontSize: 13,
          lineHeight: 1.45,
          color: "#5f6368",
        }}
      >
        <span style={{ fontWeight: 700, color: "#3c4043" }}>You said: </span>“{note.trim()}”
      </div>

      {keys.length === 0 ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            borderRadius: 14,
            background: "#fef7e0",
            padding: "12px 14px",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          <NoraFace size={26} />
          <span>
            I couldn&apos;t tell which field that is. Mention the field — e.g. “mobile”, “title”,
            “hours” — and the new value.
          </span>
        </div>
      ) : (
        <>
          <span style={{ fontSize: 13, color: "#5f6368" }}>
            Here&apos;s what I found. Untick anything that&apos;s wrong, or fix the value, then
            apply.
          </span>
          {[...keys]
            .sort(
              (a, b) =>
                CARD_ORDER.indexOf(FIELD_CARD[a] ?? "") - CARD_ORDER.indexOf(FIELD_CARD[b] ?? ""),
            )
            .map((k) => {
              const same = (vals[k] ?? "") === current[k];
              const old = current[k] && !(k === "Bio" && current[k] === "Thin") ? current[k] : "";
              return (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    borderRadius: 14,
                    border: `1.5px solid ${on[k] ? "#c6dafc" : "#e8eaed"}`,
                    background: on[k] ? "#f5f9ff" : "#fff",
                    padding: "10px 12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!on[k]}
                    onChange={(e) => setOn((x) => ({ ...x, [k]: e.target.checked }))}
                    aria-label={`Apply ${k}`}
                    style={{ marginTop: 3, width: 16, height: 16, accentColor: "#1a73e8" }}
                  />
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <b style={{ fontSize: 13 }}>
                      {k}
                      {FIELD_CARD[k] ? (
                        <span style={{ fontWeight: 400, color: "#80868b" }}>
                          {" "}
                          · {FIELD_CARD[k]}
                        </span>
                      ) : null}
                    </b>
                    <span style={{ fontSize: 12, color: "#80868b" }}>
                      {old ? (
                        <>
                          Now: <s>{old}</s>
                        </>
                      ) : (
                        "Now: empty"
                      )}
                    </span>
                    <input
                      value={vals[k] ?? ""}
                      onChange={(e) => setVals((x) => ({ ...x, [k]: e.target.value }))}
                      aria-label={`New ${k}`}
                      style={{
                        height: 38,
                        border: "1.5px solid #dadce0",
                        borderRadius: 10,
                        padding: "0 10px",
                        font: "600 14px Arial,sans-serif",
                        color: "#202124",
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                    {same ? (
                      <span style={{ fontSize: 11, color: "#b06000" }}>
                        Same as now — no change
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
        </>
      )}

      {keys.length && speech.supported ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 14,
            background: speech.listening ? "#fce8e6" : "#eef3fe",
            padding: "8px 10px",
          }}
        >
          <button
            type="button"
            onClick={() => (speech.listening ? speech.stop() : listen())}
            aria-label={speech.listening ? "Stop listening" : "Answer by voice"}
            aria-pressed={speech.listening}
            style={{
              width: 36,
              height: 36,
              flex: "none",
              border: 0,
              borderRadius: "50%",
              background: speech.listening ? "#ea4335" : "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              animation: speech.listening ? "hf-pulseDot 1.2s ease-out infinite" : "none",
            }}
          >
            <Ic name="mic" size={18} color={speech.listening ? "#fff" : "#1a73e8"} />
          </button>
          <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: "#3c4043" }}>
            {speech.listening ? (
              <>
                Listening — say <b>“do it”</b> or <b>“cancel”</b>.
              </>
            ) : speech.error ? (
              speech.error
            ) : (
              <>
                Tap the mic and say <b>“do it”</b> or <b>“cancel”</b>.
              </>
            )}
          </span>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onCancel} style={btn(false)}>
          Cancel
        </button>
        {keys.length ? (
          <button
            type="button"
            disabled={!picked.length}
            onClick={doIt}
            style={btn(true, !picked.length)}
          >
            {picked.length
              ? `Do it · ${picked.length} change${picked.length === 1 ? "" : "s"}`
              : "Nothing selected"}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onBack}
        style={{
          alignSelf: "flex-start",
          border: 0,
          background: "none",
          padding: 0,
          font: "700 13px Arial,sans-serif",
          color: "#1a73e8",
          cursor: "pointer",
        }}
      >
        ← Back to my note
      </button>
    </div>
  );
}
