export type OverviewSearch = { from?: string; day?: 7 | 24; events?: 1 };

/** Search params of the seat index: `day` is 7 or 24, `events` is 1, `from` is a string; anything else is dropped. */
export function validateOverviewSearch(search: Record<string, unknown>): OverviewSearch {
  const day = Number(search.day);
  return {
    from: typeof search.from === "string" ? search.from : undefined,
    day: day === 7 || day === 24 ? day : undefined,
    events: search.events === 1 || search.events === "1" ? 1 : undefined,
  };
}
