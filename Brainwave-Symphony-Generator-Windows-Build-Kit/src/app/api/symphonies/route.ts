import { NextRequest, NextResponse } from "next/server";
import { getLocalStore, mutateLocalStore, type LocalSymphony } from "@/lib/local-store";
import type { AmbientTexture, SymphonyStage } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getLocalStore();
    const allSymphonies = [...state.symphonies].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.id - b.id);
    const allStewards = [...state.stewards].sort((a, b) => a.id - b.id);
    const recentLogs = [...state.sessionLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    const latestLedger = [...state.ledgerSnapshots].sort((a, b) => b.frameNumber - a.frameNumber || b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
    return NextResponse.json({ symphonies: allSymphonies, stewards: allStewards, sessionLogs: recentLogs, ledger: latestLedger });
  } catch (error) {
    console.error("GET /api/symphonies error:", error);
    return NextResponse.json({ error: "Failed to load symphonies from local storage" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === "create") {
      const title = (body.title as string)?.trim() || "Untitled Clearing Symphony";
      const subtitle = (body.subtitle as string)?.trim() || "Custom binaural frequency sequence";
      const stewardName = (body.stewardName as string)?.trim() || "Shared Clearing";
      const description = (body.description as string)?.trim() || "Composed in Mind Control Clearing.";
      const ambientTexture = ((body.ambientTexture as AmbientTexture) || "pure_sine");
      const ambientLevel = typeof body.ambientLevel === "number" ? body.ambientLevel : 0.0;
      const stages = (body.stages as SymphonyStage[]) || [];
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`;
      const result = await mutateLocalStore((state) => {
        if (!state.stewards.some((item) => item.name === stewardName)) return { error: "Create or select a steward profile before saving." as const };
        const created: LocalSymphony = {
          id: state.nextIds.symphony++, slug, title, subtitle, author: stewardName, stewardName,
          isPreset: false, description, ambientTexture, ambientLevel, stages, isFavorite: Boolean(body.isFavorite),
          playCount: 0, createdAt: new Date().toISOString(),
        };
        state.symphonies.push(created);
        return { symphony: created };
      });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json(result);
    }

    if (action === "update") {
      const id = Number(body.id);
      if (!id) return NextResponse.json({ error: "Missing symphony id" }, { status: 400 });
      const result = await mutateLocalStore((state) => {
        const item = state.symphonies.find((entry) => entry.id === id);
        if (!item) return { error: "Symphony not found" as const, status: 404 as const };
        if (item.isPreset) return { error: "Core presets are read-only. Save a copy to customize one." as const, status: 409 as const };
        const stewardName = (body.stewardName as string)?.trim();
        if (stewardName && !state.stewards.some((entry) => entry.name === stewardName)) {
          return { error: "Create or select a steward profile before saving." as const, status: 400 as const };
        }
        for (const key of ["title", "subtitle", "description", "ambientTexture", "ambientLevel", "stages"] as const) {
          if (body[key] !== undefined) (item as unknown as Record<string, unknown>)[key] = body[key];
        }
        if (stewardName) { item.author = stewardName; item.stewardName = stewardName; }
        else if (body.author !== undefined) item.author = body.author;
        return { symphony: item };
      });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result);
    }

    if (action === "toggle_favorite") {
      const id = Number(body.id);
      const result = await mutateLocalStore((state) => {
        const item = state.symphonies.find((entry) => entry.id === id);
        if (item) item.isFavorite = Boolean(body.isFavorite);
        return item ? { symphony: item } : {};
      });
      return NextResponse.json(result);
    }

    if (action === "increment_play") {
      const id = Number(body.id);
      const result = await mutateLocalStore((state) => {
        const item = state.symphonies.find((entry) => entry.id === id);
        if (item) item.playCount += 1;
        return item ? { symphony: item } : {};
      });
      return NextResponse.json(result);
    }

    if (action === "delete") {
      const id = Number(body.id);
      await mutateLocalStore((state) => { state.symphonies = state.symphonies.filter((entry) => entry.id !== id); });
      return NextResponse.json({ deletedId: id });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/symphonies error:", error);
    return NextResponse.json({ error: "Failed to process symphony mutation" }, { status: 500 });
  }
}
