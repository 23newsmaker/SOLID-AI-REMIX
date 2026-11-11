import { pgTable, text, integer, boolean, timestamp, jsonb, doublePrecision, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { members } from "./members";
import { creativeConcepts } from "./creative";

export const videoJobs = pgTable("solid_video_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => members.id),
  conceptId: text("concept_id").references(() => creativeConcepts.id, { onDelete: "set null" }),
  conceptVersion: integer("concept_version").notNull(),
  characterId: text("character_id").notNull(),
  requestKey: text("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  title: text("title").notNull(),
  mode: text("mode").notNull().default("HEMAT"),
  provider: text("provider").notNull().default("local-compositor"),
  providerJobId: text("provider_job_id"),
  status: text("status").notNull().default("QUEUED"),
  quotaDay: text("quota_day").notNull(),
  simulation: boolean("simulation").notNull().default(false),
  options: jsonb("options").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  width: integer("width").notNull().default(720),
  height: integer("height").notNull().default(1280),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  resultPath: text("result_path"),
  rawResultPath: text("raw_result_path"),
  deleted: boolean("deleted").notNull().default(false),
  estimatedCostUsd: doublePrecision("estimated_cost_usd"),
  actualCostUsd: doublePrecision("actual_cost_usd"),
  providerCostUsd: doublePrecision("provider_cost_usd").default(0),
  renderMilliseconds: integer("render_milliseconds"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("solid_video_request_unique").on(t.ownerId, t.requestKey)]);
export const videoSettings = pgTable("solid_video_settings", {
  id: text("id").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  budgetUsd: doublePrecision("budget_usd"),
});
export const insertVideoJobSchema = createInsertSchema(videoJobs);
export type VideoJobRow = typeof videoJobs.$inferSelect;
