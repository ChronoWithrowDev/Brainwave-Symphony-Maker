import { ensureLocalStore } from "@/lib/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureLocalStore();
    return Response.json({ ok: true, storage: "local" });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
