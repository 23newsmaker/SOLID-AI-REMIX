import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const knowledgeSources = pgTable("solid_knowledge_sources", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  title: text("title").notNull(),
  segment: text("segment").notNull(),
  category: text("category").notNull(),
  validation: text("validation").notNull().default("NEEDS_REVIEW"),
  access: text("access").notNull().default("INTERNAL_GENERAL"),
  version: text("version").notNull(),
  fileName: text("file_name").notNull(),
  objectPath: text("object_path").notNull(),
  content: text("content").notNull(),
  sha256: text("sha256").notNull(),
  warnings: text("warnings").array().notNull(),
  active: boolean("active").notNull().default(true),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertKnowledgeSourceSchema = createInsertSchema(knowledgeSources);
export type KnowledgeRecord = typeof knowledgeSources.$inferSelect;
