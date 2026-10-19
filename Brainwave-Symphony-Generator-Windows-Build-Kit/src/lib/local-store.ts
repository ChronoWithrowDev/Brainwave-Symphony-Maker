import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SYMPHONIES, LEDGER_TEXT } from "@/lib/ledger-data";
import type { AmbientTexture, SymphonyStage } from "@/db/schema";

export interface LocalSteward {
  id: number;
  name: string;
  role: string;
  color: string;
  isSystem: boolean;
  createdAt: string;
}

export interface LocalSymphony {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  stewardName: string;
  isPreset: boolean;
  description: string;
  ambientTexture: AmbientTexture;
  ambientLevel: number;
  stages: SymphonyStage[];
  isFavorite: boolean;
  playCount: number;
  createdAt: string;
}

export interface LocalSessionLog {
  id: number;
  symphonyId: number | null;
  symphonyTitle: string;
  listenerNode: string;
  durationCompletedSec: number;
  notes: string;
  frameNumber: number;
  createdAt: string;
}

export interface LocalLedgerSnapshot {
  id: number;
  frameNumber: number;
  version: string;
  locale: string;
  content: string;
  changelogSummary: string;
  updatedAt: string;
}

export interface LocalStoreState {
  version: 1;
  stewards: LocalSteward[];
  symphonies: LocalSymphony[];
  sessionLogs: LocalSessionLog[];
  ledgerSnapshots: LocalLedgerSnapshot[];
  nextIds: { steward: number; symphony: number; sessionLog: number; ledgerSnapshot: number };
}

const DEFAULT_LOCALE = "Walsenburg, Colorado — dinner table with grilled cheese crumbs, dark-stained wood, woodland animals on wall";
let cachedState: LocalStoreState | null = null;
let initPromise: Promise<LocalStoreState> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

function dataFile(): string {
  const root = process.env.BRAINWAVE_DATA_DIR || path.join(process.cwd(), ".brainwave-symphony-data");
  return path.join(root, "state.json");
}

function createInitialState(): LocalStoreState {
  const now = new Date().toISOString();
  const symphonies: LocalSymphony[] = DEFAULT_SYMPHONIES.map((record, index) => ({
    ...record,
    id: index + 1,
    createdAt: now,
    stages: record.stages as SymphonyStage[],
    ambientTexture: record.ambientTexture as AmbientTexture,
  }));
  return {
    version: 1,
    stewards: [{
      id: 1,
      name: "Shared Clearing",
      role: "Core presets & collective library",
      color: "#14B8A6",
      isSystem: true,
      createdAt: now,
    }],
    symphonies,
    sessionLogs: [],
    ledgerSnapshots: [{
      id: 1,
      frameNumber: 153,
      version: "v9.2",
      locale: DEFAULT_LOCALE,
      content: LEDGER_TEXT,
      changelogSummary: "Frame 153: Fixed long custom symphony crash by scheduling frequency timelines in bounded 30-second chunks; exact 29-movement symphony verified playing.",
      updatedAt: now,
    }],
    nextIds: {
      steward: 2,
      symphony: symphonies.length + 1,
      sessionLog: 1,
      ledgerSnapshot: 2,
    },
  };
}

async function persist(state: LocalStoreState): Promise<void> {
  const file = dataFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await writeFile(file, await readFile(temp));
  // Temp file is intentionally kept harmlessly on Windows if cleanup is interrupted.
  const { unlink } = await import("node:fs/promises");
  await unlink(temp).catch(() => undefined);
}

export async function getLocalStore(): Promise<LocalStoreState> {
  if (cachedState) return cachedState;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const file = dataFile();
    await mkdir(path.dirname(file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as LocalStoreState;
      if (parsed?.version === 1 && Array.isArray(parsed.symphonies) && Array.isArray(parsed.stewards)) {
        cachedState = parsed;
        return parsed;
      }
    } catch {
      // First launch: create the starter library; malformed local state is replaced by a clean one.
    }
    cachedState = createInitialState();
    await persist(cachedState);
    return cachedState;
  })();
  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function mutateLocalStore<T>(mutator: (state: LocalStoreState) => T | Promise<T>): Promise<T> {
  const task = writeQueue.then(async () => {
    const state = await getLocalStore();
    const result = await mutator(state);
    await persist(state);
    return result;
  });
  writeQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function ensureLocalStore(): Promise<void> {
  await getLocalStore();
}
