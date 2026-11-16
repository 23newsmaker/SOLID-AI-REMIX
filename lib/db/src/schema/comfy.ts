import { pgTable, text, integer, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { videoJobs } from "./video";

// One row per AI job rendered by ComfyUI; the shared solid_video_jobs row keeps
// quota, cost, review and retention behaviour identical to other modes.
// No cascading FK: retained evidence survives removal of operational data.
export const comfyJobs = pgTable("solid_comfy_jobs", {
  jobId: text("job_id").primaryKey().references(() => videoJobs.id),
  // QUEUED -> UPLOADING -> SUBMITTED (prompt_id stored) -> DOWNLOADING -> DONE | FAILED
  phase: text("phase").notNull().default("QUEUED"),
  promptId: text("prompt_id"),
  workflowKind: text("workflow_kind").notNull(),
  workflowFile: text("workflow_file").notNull(),
  workflowHash: text("workflow_hash"),
  // Exact graph sent to ComfyUI (no secrets, no URLs); null until images are uploaded.
  workflow: jsonb("workflow"),
  seed: integer("seed").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  frameLength: integer("frame_length").notNull(),
  steps: integer("steps").notNull().default(12),
  conceptVersion: integer("concept_version").notNull(),
  // Image materials actually sent (ids/roles only) and attachments that were ignored (e.g. MP4).
  inputs: jsonb("inputs").notNull(),
  errorCode: text("error_code"),
  errorDetail: text("error_detail").array(),
  // Technical ffprobe/decoding checks. ComfyUI itself has no quality gate; content is judged in /video-review.
  technicalChecks: jsonb("technical_checks"),
  pollCount: integer("poll_count").notNull().default(0),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("solid_comfy_phase_idx").on(t.phase)]);

export const providerSettings = pgTable("solid_provider_settings", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  reason: text("reason").notNull().default(""),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ComfyJobRow = typeof comfyJobs.$inferSelect;
