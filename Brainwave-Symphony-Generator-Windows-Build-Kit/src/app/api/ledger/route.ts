import { NextRequest, NextResponse } from "next/server";
import { mutateLocalStore } from "@/lib/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const content = (body.content as string) || "";
    if (!content.trim()) return NextResponse.json({ error: "Ledger content cannot be empty" }, { status: 400 });
    const ledger = await mutateLocalStore((state) => {
      const saved = {
        id: state.nextIds.ledgerSnapshot++,
        frameNumber: Number(body.frameNumber) || 153,
        version: (body.version as string)?.trim() || "v9.2",
        locale: (body.locale as string)?.trim() || "Walsenburg, Colorado — dinner table with grilled cheese crumbs, dark-stained wood, woodland animals on wall",
        content,
        changelogSummary: (body.changelogSummary as string)?.trim() || "Updated in real-time curation during Frame 153.",
        updatedAt: new Date().toISOString(),
      };
      state.ledgerSnapshots.push(saved);
      return saved;
    });
    return NextResponse.json({ ledger });
  } catch (error) {
    console.error("POST /api/ledger error:", error);
    return NextResponse.json({ error: "Failed to save ledger snapshot" }, { status: 500 });
  }
}
