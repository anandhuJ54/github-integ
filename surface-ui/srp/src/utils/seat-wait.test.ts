// A professional's seat holds its pages until the seat has loaded, so screens that start from the person's
// name never start from the sample one (srp/local-login-srp-home).
import { describe, expect, test } from "bun:test";
import { waitingForSeat } from "@v3/srp/utils/seat-wait";

describe("waitingForSeat", () => {
  test("a professional's seat waits while the seat is loading", () => {
    expect(waitingForSeat(true, "pending")).toBe(true);
  });

  test("it shows the pages once the seat loaded", () => {
    expect(waitingForSeat(true, "success")).toBe(false);
  });

  test("it still shows the pages when the seat could not be loaded, with the sample person", () => {
    expect(waitingForSeat(true, "error")).toBe(false);
  });

  test("a location seat never waits for a professional", () => {
    expect(waitingForSeat(false, "pending")).toBe(false);
  });

  test("it waits while ANY of the loads is pending (the seat and its Home data)", () => {
    expect(waitingForSeat(true, "success", "pending")).toBe(true);
    expect(waitingForSeat(true, "pending", "success")).toBe(true);
  });

  test("it shows the pages once every load has finished, whether it worked or not", () => {
    expect(waitingForSeat(true, "success", "success")).toBe(false);
    expect(waitingForSeat(true, "success", "error")).toBe(false);
    expect(waitingForSeat(true, "error", "error")).toBe(false);
  });

  test("a location seat never waits, whatever the statuses", () => {
    expect(waitingForSeat(false, "pending", "pending")).toBe(false);
  });
});
