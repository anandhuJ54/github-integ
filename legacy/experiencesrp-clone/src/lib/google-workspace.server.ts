// Server-only Google Workspace helpers. Secrets are read from the vault-backed
// environment by the reference NAMES stored in exp_integration_google — never from the table.

export type GoogleIntegrationRow = {
  status: string;
  domain: string;
  domain_status: string;
  client_id_ref: string;
  client_secret_ref: string;
  service_account_ref: string;
  requested_scopes: string[];
};

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export function secretByRef(ref: string | null | undefined): string | null {
  if (!ref || !/^[A-Z_][A-Z0-9_]*$/.test(ref)) return null;
  const value = process.env[ref];
  return value && value.trim() ? value : null;
}

export function secretsPresent(row: Pick<GoogleIntegrationRow, "client_id_ref" | "client_secret_ref" | "service_account_ref">) {
  return {
    clientId: !!secretByRef(row.client_id_ref),
    clientSecret: !!secretByRef(row.client_secret_ref),
    serviceAccount: !!secretByRef(row.service_account_ref),
  };
}

/** Delivery is live only after a human authorized, the domain was verified, and delegation credentials exist. */
export function canDeliver(row: GoogleIntegrationRow | null): boolean {
  return !!row && row.status === "connected" && row.domain_status === "verified" && !!secretByRef(row.service_account_ref);
}

const b64url = (input: ArrayBuffer | string) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importPrivateKey(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** Domain-wide delegation: mint an access token impersonating `subject` (the employee's own address). */
export async function delegatedAccessToken(row: GoogleIntegrationRow, subject: string, scopes: string[]): Promise<string> {
  const raw = secretByRef(row.service_account_ref);
  if (!raw) throw new Error("Service account credentials are not configured");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope: scopes.join(" "), aud: tokenUri, iat: now, exp: now + 3600 }))}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token request failed [${res.status}]: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const header = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${btoa(Array.from(new TextEncoder().encode(v), (b) => String.fromCharCode(b)).join(""))}?=`);

export async function sendGmail(row: GoogleIntegrationRow, from: string, to: string[], subject: string, body: string): Promise<string> {
  const token = await delegatedAccessToken(row, from, ["https://www.googleapis.com/auth/gmail.send"]);
  const mime = [`From: ${from}`, `To: ${to.join(", ")}`, `Subject: ${header(subject)}`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "", body].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: b64url(mime) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed [${res.status}]: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export async function createCalendarEvent(row: GoogleIntegrationRow, organizer: string, input: { summary: string; description: string; start: string; end: string; attendees: string[] }): Promise<string> {
  const token = await delegatedAccessToken(row, organizer, ["https://www.googleapis.com/auth/calendar.events"]);
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ summary: input.summary, description: input.description, start: { dateTime: input.start }, end: { dateTime: input.end }, attendees: input.attendees.map((email) => ({ email })) }),
  });
  if (!res.ok) throw new Error(`Calendar event failed [${res.status}]: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}
