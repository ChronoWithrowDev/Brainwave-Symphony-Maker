import { NextRequest, NextResponse } from "next/server";
import { mutateLocalStore } from "@/lib/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entry = await mutateLocalStore((state) => {
      const createdAt = new Date().toISOString();
      const item = {
        id: state.nextIds.sessionLog++,
        symphonyId: body.symphonyId ? Number(body.symphonyId) : null,
        symphonyTitle: (body.symphonyTitle as string)?.trim() || "Custom Brainwave Session",
        listenerNode: (body.listenerNode as string)?.trim() || "Shared Clearing",
        durationCompletedSec: Math.max(1, Number(body.durationCompletedSec) || 60),
        notes: (body.notes as string)?.trim() || "Completed binaural phase transition in the clearing.",
        frameNumber: Number(body.frameNumber) || 153,
        createdAt,
      };
      state.sessionLogs.push(item);
      const recent = [...state.sessionLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
      return { sessionLogs: recent };
    });
    return NextResponse.json(entry);
  } catch (error) {
    console.error("POST /api/sessions error:", error);
    return NextResponse.json({ error: "Failed to save session log" }, { status: 500 });
  }
}
