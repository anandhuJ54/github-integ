import { createHmac, randomInt } from "node:crypto";

/* Claim OTP primitives (server only). The stored / logged value is an HMAC keyed by a server
   secret and bound to the claim, so exp_verification_requests / exp_skill_run never reveal
   the code. */

function otpSecret() {
  const s = process.env.CLAIM_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("claim OTP secret missing (CLAIM_OTP_SECRET / service role key)");
  return s;
}

export function otpHash(claimId: string, code: string, secret = otpSecret()) {
  return createHmac("sha256", secret).update(`${claimId}:${code.trim()}`).digest("hex");
}

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
