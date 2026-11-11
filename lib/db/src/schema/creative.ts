import { pgTable, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { members } from "./members";

export const creativeCategories = pgTable("solid_creative_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});
export const creativeTemplates = pgTable("solid_creative_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  categoryId: text("category_id").notNull().references(() => creativeCategories.id),
  segments: text("segments").array().notNull(),
  style: text("style").notNull(),
  description: text("description").notNull(),
  scenes: text("scenes").notNull(),
  characterMotion: text("character_motion").notNull(),
  cameraMotion: text("camera_motion").notNull(),
  visual: text("visual").notNull(),
  narration: text("narration").notNull(),
  cta: text("cta").notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});
export const creativeConcepts = pgTable("solid_creative_concepts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => members.id),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  data: jsonb("data").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  prompt: text("prompt").notNull(),
  warnings: text("warnings").array().notNull(),
  blockers: text("blockers").array().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("solid_concept_owner_idx").on(t.ownerId)]);

// A row reserves quota before a signed PUT is issued. A final attachment never
// shares the writable staging key. Cleanup retains tombstones until PUT expires.
export const conceptAttachments = pgTable("solid_concept_attachments", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id").references(() => creativeConcepts.id),
  ownerId: text("owner_id").notNull().references(() => members.id),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  stagingPath: text("staging_path").notNull(),
  finalPath: text("final_path"),
  state: text("state").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("solid_attachment_concept_idx").on(t.conceptId)]);
export const creativeReviews = pgTable("solid_creative_reviews", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id").notNull().references(() => creativeConcepts.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => members.id),
  action: text("action").notNull(),
  note: text("note").notNull(),
  version: integer("version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
