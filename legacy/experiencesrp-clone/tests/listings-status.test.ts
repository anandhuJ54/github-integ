import { describe, expect, test } from "bun:test";
import {
  ERROR_KINDS,
  LISTING_STATES,
  LIMBO_FAILURE_THRESHOLD,
  IllegalTransition,
  canTransition,
  classifyPublisherError,
  fromListingsColumns,
  initialState,
  toListingsColumns,
  transition,
  type ListingEvent,
  type MachineState,
} from "../src/lib/listings/status";

const run = (events: ListingEvent[], from: MachineState = initialState()) =>
  events.reduce(transition, from);

describe("listings state machine", () => {
  test("happy path draft → live", () => {
    const s = run([
      { type: "prepare" },
      { type: "submit" },
      { type: "accepted_for_review" },
      { type: "verified_live" },
    ]);
    expect(s).toEqual({ state: "live", failures: 0 });
  });

  test("drift and resync", () => {
    const live = run([{ type: "prepare" }, { type: "submit" }, { type: "verified_live" }]);
    const drift = transition(live, { type: "drift_detected", fields: ["phone"] });
    expect(drift.state).toBe("drift");
    expect(transition(drift, { type: "resynced" }).state).toBe("live");
  });

  test("each failure kind lands in its own state", () => {
    for (const kind of ["validation", "auth", "quota", "rejected", "duplicate"] as const) {
      const s = run([{ type: "prepare" }, { type: "submit" }, { type: "failed", kind }]);
      expect(s.state).toBe(kind);
    }
  });

  test(`${LIMBO_FAILURE_THRESHOLD} counted failures → limbo (Data Axle rule)`, () => {
    let s = initialState();
    for (let i = 0; i < LIMBO_FAILURE_THRESHOLD; i++) {
      s = run(
        [
          { type: "prepare" },
          { type: "submit" },
          { type: "failed", kind: i % 2 ? "rejected" : "validation" },
        ],
        s,
      );
    }
    expect(s).toEqual({ state: "limbo", failures: LIMBO_FAILURE_THRESHOLD });
    expect(() => transition(s, { type: "submit" })).toThrow(IllegalTransition);
    expect(transition(s, { type: "limbo_expired" })).toEqual({ state: "draft", failures: 0 });
  });

  test("non-counting errors (quota/auth) never trip limbo", () => {
    let s = run([{ type: "prepare" }, { type: "submit" }]);
    for (let i = 0; i < 10; i++)
      s = run([{ type: "failed", kind: "quota" }, { type: "submit" }], s);
    expect(s).toEqual({ state: "submitted", failures: 0 });
  });

  test("success clears the failure counter", () => {
    const s = run([
      { type: "prepare" },
      { type: "submit" },
      { type: "failed", kind: "validation" },
      { type: "reset" },
      { type: "submit" },
      { type: "verified_live" },
    ]);
    expect(s).toEqual({ state: "live", failures: 0 });
  });

  test("illegal transitions throw", () => {
    expect(canTransition("draft", "submit")).toBe(false);
    expect(() => transition(initialState(), { type: "verified_live" })).toThrow(IllegalTransition);
    expect(() => transition({ state: "auth", failures: 0 }, { type: "submit" })).toThrow(
      IllegalTransition,
    );
  });
});

describe("projection onto listings.status", () => {
  test("every state maps to a status the console renders", () => {
    const known = new Set(["not_submitted", "ready", "pending", "published", "error"]);
    for (const s of LISTING_STATES) expect(known.has(toListingsColumns(s).status)).toBe(true);
  });
  test("errors → error; drift → published + has_drift", () => {
    for (const k of ERROR_KINDS)
      expect(toListingsColumns(k)).toEqual({ status: "error", has_drift: false });
    expect(toListingsColumns("drift")).toEqual({ status: "published", has_drift: true });
    expect(toListingsColumns("pending_review").status).toBe("pending");
  });
  test("round trip for the coarse states", () => {
    for (const s of ["draft", "ready", "live", "drift"] as const)
      expect(fromListingsColumns(toListingsColumns(s))).toBe(s);
    expect(fromListingsColumns({ status: null })).toBe("draft");
  });
});

describe("classifyPublisherError", () => {
  test("http + code + message signals", () => {
    expect(classifyPublisherError({ httpStatus: 401 })).toBe("auth");
    expect(classifyPublisherError({ code: "PERMISSION_DENIED" })).toBe("auth");
    expect(classifyPublisherError({ httpStatus: 429 })).toBe("quota");
    expect(classifyPublisherError({ code: "RESOURCE_EXHAUSTED" })).toBe("quota");
    expect(classifyPublisherError({ httpStatus: 409 })).toBe("duplicate");
    expect(classifyPublisherError({ message: "Listing rejected: unverifiable" })).toBe("rejected");
    expect(classifyPublisherError({ httpStatus: 400, message: "Company Name contains pipe" })).toBe(
      "validation",
    );
  });
});
