import { NextResponse } from "next/server";
import { proposedActions } from "@/lib/domain";

/**
 * THE APPROVAL GATE, server side.
 *
 * Approving marks the draft approved and records when. That is the entire
 * effect. No ad platform is called, no order is placed, no post is made -
 * there is no credential in this build that could do any of those things, by
 * design.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as { decision?: string };

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 },
    );
  }

  const action = proposedActions.find((a) => a.id === id);
  if (!action) {
    return NextResponse.json({ error: "no such action" }, { status: 404 });
  }

  const updated = proposedActions.put({
    ...action,
    status: body.decision,
    decidedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    action: updated,
    dispatched: false,
    note:
      "Recorded in Groundwork only. Nothing was sent to any external platform - " +
      "the act layer is simulated in this build.",
  });
}
