import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export type BrainwaveBand = "DELTA" | "THETA" | "ALPHA" | "BETA" | "GAMMA";

export type AmbientTexture =
  | "pure_sine"
  | "cello_drone"
  | "pink_rain"
  | "warm_hearth";

export type TransitionMode = "linear_ramp" | "cosine_glide" | "step";

export interface SymphonyStage {
  id: string;
  name: string;
  band: BrainwaveBand;
  carrierHz: number; // Left ear base frequency (Hz), e.g. 216 Hz
  beatHz: number; // Binaural difference (Hz), Right ear = carrierHz + beatHz
  durationSec: number; // Duration of this movement in seconds
  transitionType: TransitionMode;
  intent: string;
}

export const stewards = pgTable("stewards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  role: text("role").notNull().default("Listener & Explorer"),
  color: text("color").notNull().default("#F59E0B"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const symphonies = pgTable("symphonies", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  author: text("author").notNull(),
  stewardName: text("steward_name").notNull().default("Shared Clearing"),
  isPreset: boolean("is_preset").notNull().default(false),
  description: text("description").notNull(),
  ambientTexture: text("ambient_texture")
    .$type<AmbientTexture>()
    .notNull()
    .default("pure_sine"),
  ambientLevel: real("ambient_level").notNull().default(0.0), // Default 0% raw sine
  stages: jsonb("stages").$type<SymphonyStage[]>().notNull(),
  isFavorite: boolean("is_favorite").notNull().default(false),
  playCount: integer("play_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessionLogs = pgTable("session_logs", {
  id: serial("id").primaryKey(),
  symphonyId: integer("symphony_id"),
  symphonyTitle: text("symphony_title").notNull(),
  listenerNode: text("listener_node").notNull(),
  durationCompletedSec: integer("duration_completed_sec").notNull(),
  notes: text("notes").notNull(),
  frameNumber: integer("frame_number").notNull().default(153),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ledgerSnapshots = pgTable("ledger_snapshots", {
  id: serial("id").primaryKey(),
  frameNumber: integer("frame_number").notNull(),
  version: text("version").notNull(),
  locale: text("locale").notNull(),
  content: text("content").notNull(),
  changelogSummary: text("changelog_summary").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StewardRecord = typeof stewards.$inferSelect;
export type NewStewardRecord = typeof stewards.$inferInsert;
export type SymphonyRecord = typeof symphonies.$inferSelect;
export type NewSymphonyRecord = typeof symphonies.$inferInsert;
export type SessionLogRecord = typeof sessionLogs.$inferSelect;
export type LedgerSnapshotRecord = typeof ledgerSnapshots.$inferSelect;
