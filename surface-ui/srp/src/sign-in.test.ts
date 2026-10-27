// Sign-in page helpers (srp/local-login-srp-home, task 10): messages for each failure and a safe landing path.
import { describe, expect, test } from "bun:test";
import { AuthError } from "@v3/state/auth/adapters/api";
import { safeLanding, showSignOut, signInErrorMessage } from "@v3/srp/utils/sign-in";

describe("signInErrorMessage", () => {
  test("each failure has its own plain message", () => {
    expect(signInErrorMessage(new AuthError("invalid_credentials"))).toBe("The email or password is not right.");
    expect(signInErrorMessage(new AuthError("no_professional_seat"))).toBe(
      "This user has no professional seat, so there is no home to open.",
    );
    expect(signInErrorMessage(new AuthError("unavailable"))).toBe("Sign-in is not available right now. Try again.");
  });

  test("anything else is the unavailable message, never the raw error", () => {
    const msg = signInErrorMessage(new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2"));
    expect(msg).toBe("Sign-in is not available right now. Try again.");
    expect(signInErrorMessage("boom")).toBe(msg);
  });
});

describe("safeLanding", () => {
  test("keeps an in-app path", () => {
    expect(safeLanding("/seat/professional/42")).toBe("/seat/professional/42");
  });

  test.each([undefined, "", "seat/professional/42", "//evil.example", "https://evil.example", "/\\evil.example"])(
    "%p falls back to the home page",
    (path) => {
      expect(safeLanding(path as string | undefined)).toBe("/");
    },
  );
});

describe("showSignOut", () => {
  test("the seat shows a Sign out control only for the API sign-in", () => {
    expect(showSignOut("api")).toBe(true);
    expect(showSignOut("supabase")).toBe(false); // the Admin Console layout has its own
    expect(showSignOut("fake")).toBe(false);
  });
});
