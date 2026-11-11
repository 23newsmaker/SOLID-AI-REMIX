import { randomUUID } from "node:crypto";
import { db, auditLog } from "@workspace/db";

export async function audit(userId: string, action: string, description: string) {
  await db.insert(auditLog).values({ id: randomUUID(), userId, action, description });
}
