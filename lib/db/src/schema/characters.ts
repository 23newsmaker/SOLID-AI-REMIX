import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { members } from "./members";

export const characters = pgTable("solid_characters", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => members.id),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull(),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertCharacterSchema = createInsertSchema(characters);
export const characterUploads = pgTable("solid_character_uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => members.id),
  objectPath: text("object_path").notNull(),
  expectedSize: integer("expected_size").notNull(),
  contentType: text("content_type").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
