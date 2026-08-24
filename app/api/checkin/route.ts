import { NextResponse } from "next/server";
import { checkins, type CheckinRecord } from "@/lib/domain";

/**
 * The owner's own account of a day.
 *
 * Stored and shown back against the unexplained share; deliberately NOT fed
 * into the attribution regression. A note saying "we were short-staffed" is
 * testimony, not a measurement, and turning it into a coefficient would
 * manufacture precision nobody earned.
 */

const ALLOWED_TAGS = [
  "short_staffed",
  "equipment_down",
  "late_open",
  "menu_change",
  "roadworks_outside",
  "private_event",
  "busy_nearby_event",
  "nothing_unusual",
] as const;

const ALLOWED_PULSE = ["busy", "normal", "slow", "dead"] as const;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    siteId?: string;
    date?: string;
    pulse?: string;
    tags?: string[];
    note?: string;
  };

  if (!body.siteId || !body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json(
      { error: "siteId and an ISO date (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  const pulse = ALLOWED_PULSE.includes(
    body.pulse as (typeof ALLOWED_PULSE)[number],
  )
    ? (body.pulse as CheckinRecord["pulse"])
    : null;

  const tags = (body.tags ?? []).filter((t) =>
    ALLOWED_TAGS.includes(t as (typeof ALLOWED_TAGS)[number]),
  );

  const note = (body.note ?? "").slice(0, 1000);

  if (!pulse && tags.length === 0 && note.trim().length === 0) {
    return NextResponse.json(
      { error: "nothing to record — set a pulse, a tag, or a note" },
      { status: 400 },
    );
  }

  // One record per site per day; a second submission replaces the first.
  const record: CheckinRecord = {
    id: `${body.siteId}-${body.date}`,
    siteId: body.siteId,
    date: body.date,
    pulse,
    tags,
    note,
    createdAt: new Date().toISOString(),
  };

  checkins.put(record);

  return NextResponse.json({
    checkin: record,
    note:
      "Recorded against this date and shown alongside the unexplained share. " +
      "It is not fed into the attribution model — testimony is not a measurement.",
  });
}

export async function GET(request: Request) {
  const siteId = new URL(request.url).searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }
  return NextResponse.json({
    checkins: checkins
      .filter((c) => c.siteId === siteId)
      .sort((a, b) => b.date.localeCompare(a.date)),
  });
}
