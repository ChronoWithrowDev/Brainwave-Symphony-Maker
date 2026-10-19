import { ensureLocalStore } from "@/lib/local-store";

export async function ensureSeeded(): Promise<void> {
  await ensureLocalStore();
}
