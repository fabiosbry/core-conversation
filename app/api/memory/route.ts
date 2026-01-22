import { NextRequest, NextResponse } from "next/server";
import { appendTranscriptEntry, getMemory, updateMemory } from "@/lib/memory";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing sessionId" },
      { status: 400 }
    );
  }

  try {
    const memory = await getMemory(sessionId);
    return NextResponse.json({ memory });
  } catch (error) {
    console.error("Memory fetch error:", error);
    return NextResponse.json(
      { error: "Failed to load memory" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, entry } = await request.json();
    if (!sessionId || !entry?.role || !entry?.content) {
      return NextResponse.json(
        { error: "Missing sessionId or transcript entry" },
        { status: 400 }
      );
    }

    const memory = await updateMemory(sessionId, (current) => {
      appendTranscriptEntry(current, {
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp ?? new Date().toISOString(),
      });
      return current;
    });

    return NextResponse.json({ memory });
  } catch (error) {
    console.error("Memory update error:", error);
    return NextResponse.json(
      { error: "Failed to update memory" },
      { status: 500 }
    );
  }
}
