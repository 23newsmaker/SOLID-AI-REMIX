import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const memberRole = pgEnum("solid_member_role", ["SUPER_ADMIN", "ADMIN", "CREATOR", "REVIEWER_COMPLIANCE", "VIEWER"]);
export const memberStatus = pgEnum("solid_member_status", ["PENDING", "ACTIVE", "SUSPENDED"]);
export const members = pgTable("solid_members", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: memberRole("role").notNull().default("VIEWER"),
  status: memberStatus("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertMemberSchema = createInsertSchema(members).omit({ createdAt: true });
export type MemberRecord = typeof members.$inferSelect;

// One-time grant, seeded from an owner-supplied email; never "first signup wins".
export const adminGrants = pgTable("solid_admin_grants", {
  email: text("email").primaryKey(),
  consumedBy: text("consumed_by"),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});
