import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const auditLog = pgTable("solid_audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  description: text("description").notNull(),
  objectId: text("object_id"),
  result: text("result").notNull().default("RECORDED"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertAuditSchema = createInsertSchema(auditLog);
