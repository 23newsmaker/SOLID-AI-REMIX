import { pgTable, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { members } from "./members";
import { videoJobs } from "./video";

// An explicit sharing map; existing accounts/assets are private until opted in.
export const studioFolders = pgTable("solid_studio_folders", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  name: text("name").notNull(),
  sharedBy: text("shared_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("solid_studio_folder_member_unique").on(t.memberId)]);
export const insertStudioFolderSchema = createInsertSchema(studioFolders);
export type StudioFolderRecord = typeof studioFolders.$inferSelect;

// Separate from independent compliance decisions; never rewrite review history.
export const studioSelfChecks = pgTable("solid_studio_self_checks", {
  jobId: text("job_id").primaryKey().references(() => videoJobs.id),
  folderId: text("folder_id").notNull().references(() => studioFolders.id),
  sessionHash: text("session_hash").notNull(),
  binding: jsonb("binding").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertStudioSelfCheckSchema = createInsertSchema(studioSelfChecks);
