export type LoadStatus = "pending" | "error" | "success";

/**
 * Whether a seat should hold its pages back. A professional's seat waits while any of its loads (the seat and its Home data) is
 * pending, so the Happyflow screens that start from the person's name, and the Home, are built once with real values rather than
 * frozen with, or flashing, the sample ones. A failed load shows the pages anyway, with the sample view for what failed.
 */
export function waitingForSeat(isPro: boolean, ...statuses: LoadStatus[]): boolean {
  return isPro && statuses.includes("pending");
}
