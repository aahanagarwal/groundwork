/**
 * The fixed list of things an owner can flag about a day.
 *
 * Fixed rather than free-form so they stay countable - "how often were you
 * short-staffed last quarter" is a question worth being able to answer later.
 * The free-text note sits alongside for everything this list doesn't cover.
 *
 * Shared by the check-in form and the server page, so an id never reaches the
 * screen where a label belongs.
 */
export const CHECKIN_TAGS: Array<{ id: string; label: string }> = [
  { id: "short_staffed", label: "Short-staffed" },
  { id: "equipment_down", label: "Equipment down" },
  { id: "late_open", label: "Opened late" },
  { id: "menu_change", label: "Menu or price change" },
  { id: "roadworks_outside", label: "Works right outside" },
  { id: "private_event", label: "Private event / closed" },
  { id: "busy_nearby_event", label: "Something on nearby" },
  { id: "nothing_unusual", label: "Nothing unusual" },
];

export function checkinTagLabel(id: string): string {
  return CHECKIN_TAGS.find((t) => t.id === id)?.label ?? id;
}
