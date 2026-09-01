import { NextResponse } from "next/server";
import { parseBusinessParagraph } from "@/lib/agent/scenario-builder";

/**
 * Step 1 of "Create a new use case": read the owner's paragraph, extract what
 * can honestly be extracted, and hand back a draft plus the list of fields
 * that still need a human. Never fabricates a value for a missing field -
 * see lib/agent/scenario-builder.ts for why.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    paragraph?: string;
    existingBusinessLabel?: string;
    existingAddress?: string;
  };

  const paragraph = body.paragraph?.trim() ?? "";
  if (paragraph.length < 10) {
    return NextResponse.json(
      { error: "Write a sentence or two about the business first." },
      { status: 400 },
    );
  }
  if (paragraph.length > 4000) {
    return NextResponse.json(
      { error: "That's a lot - keep it under 4000 characters." },
      { status: 400 },
    );
  }

  const result = await parseBusinessParagraph(paragraph, {
    existingBusinessLabel: body.existingBusinessLabel?.trim() || undefined,
    existingAddress: body.existingAddress?.trim() || undefined,
  });

  return NextResponse.json(result);
}
