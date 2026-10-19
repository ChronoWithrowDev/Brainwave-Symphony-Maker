import { NextRequest, NextResponse } from "next/server";
import { getLocalStore, mutateLocalStore, type LocalSteward } from "@/lib/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getLocalStore();
    return NextResponse.json({ stewards: [...state.stewards].sort((a, b) => a.id - b.id) });
  } catch (error) {
    console.error("GET /api/stewards error:", error);
    return NextResponse.json({ error: "Failed to load stewards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;
    if (action === "create" || !action) {
      const name = (body.name as string)?.trim();
      const role = (body.role as string)?.trim() || "Listener & Explorer";
      const color = (body.color as string)?.trim() || "#F59E0B";
      if (!name) return NextResponse.json({ error: "Steward name is required" }, { status: 400 });
      if (name.toLowerCase() === "shared clearing") {
        return NextResponse.json({ error: "Shared Clearing is a reserved system profile." }, { status: 400 });
      }
      const result = await mutateLocalStore((state) => {
        if (state.stewards.some((item) => item.name === name)) return { error: "A profile with that name already exists." as const };
        const created: LocalSteward = {
          id: state.nextIds.steward++, name, role, color, isSystem: false, createdAt: new Date().toISOString(),
        };
        state.stewards.push(created);
        return { steward: created };
      });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/stewards error:", error);
    return NextResponse.json({ error: "Failed to create steward" }, { status: 500 });
  }
}
