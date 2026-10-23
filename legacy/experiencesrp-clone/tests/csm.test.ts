import { describe, expect, test } from "bun:test";
import { isMine } from "../src/lib/csm";

describe("My accounts matching", () => {
  test("matches on user id", () => {
    expect(isMine({ csm_user_ref: "u1", csm_email: null }, "u1", "a@x.com")).toBe(true);
  });
  test("falls back to email match", () => {
    expect(isMine({ csm_user_ref: "other", csm_email: "A@x.com" }, "u1", "a@x.com")).toBe(true);
  });
  test("rejects someone else's assignment", () => {
    expect(isMine({ csm_user_ref: "u2", csm_email: "b@x.com" }, "u1", "a@x.com")).toBe(false);
  });
});
