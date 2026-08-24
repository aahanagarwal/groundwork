/**
 * Driver vocabulary — the one thing both the server and the browser need.
 *
 * Kept in its own module with no imports so client components can use it.
 * lib/scenarios.ts reads from disk, and importing it from a "use client"
 * component drags node:fs into the browser bundle, which Turbopack refuses.
 */

export type EventKind =
  | "road_closure"
  | "rain"
  | "heat"
  | "event"
  | "holiday"
  | "competitor_open"
  | "fuel_price"
  | "news";

export const EVENT_KIND_META: Record<
  EventKind,
  { label: string; short: string }
> = {
  road_closure: { label: "Road closure", short: "the closure" },
  rain: { label: "Rain", short: "rain" },
  heat: { label: "Heat", short: "the heat" },
  event: { label: "Local event", short: "the event" },
  holiday: { label: "Holiday", short: "the holiday" },
  competitor_open: { label: "New competitor", short: "the new competitor" },
  fuel_price: { label: "Fuel price", short: "fuel prices" },
  news: { label: "Local news", short: "local news" },
};
