import { pgTable, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

// No cascading foreign keys: retained evidence survives removal of operational data.
export const publicFacts = pgTable("solid_public_facts", {
  id: text("id").primaryKey(), sourceId: text("source_id").notNull(),
  sourceRevision: text("source_revision").notNull(),
  claim: text("claim").notNull(), quote: text("quote").notNull(), segment: text("segment").notNull(),
  version: integer("version").notNull().default(1), status: text("status").notNull().default("DRAFT"),
  creatorId: text("creator_id").notNull(), reviewerId: text("reviewer_id"),
  note: text("note").notNull().default(""), reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const factEvents = pgTable("solid_fact_events", {
  id: text("id").primaryKey(), factId: text("fact_id").notNull(), actorId: text("actor_id").notNull(),
  snapshot: jsonb("snapshot").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const conceptVersions = pgTable("solid_concept_versions", {
  id: text("id").primaryKey(), conceptId: text("concept_id").notNull(), ownerId: text("owner_id").notNull(),
  version: integer("version").notNull(), snapshot: jsonb("snapshot").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("solid_concept_version_unique").on(t.conceptId, t.version)]);
export const finalReviews = pgTable("solid_final_reviews", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull(), actorId: text("actor_id").notNull(),
  action: text("action").notNull(), note: text("note").notNull(), checklist: jsonb("checklist").notNull(),
  binding: jsonb("binding").notNull(), version: integer("version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const sessionAudits = pgTable("solid_session_audits", {
  key: text("key").primaryKey(), userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
