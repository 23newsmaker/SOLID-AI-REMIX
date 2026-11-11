import { randomUUID } from "node:crypto";
import { db, auditLog } from "@workspace/db";
import type { CreativeTx } from "../creative-service";

function safe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) =>
    !/secret|token|password|cookie|authorization|url|objectpath|finalpath|stagingpath/i.test(k)).map(([k, v]) => [k, safe(v)]));
  return value;
}
export async function audit(userId: string, action: string, objectId: string, before: unknown, after: unknown, tx?: CreativeTx) {
  await (tx ?? db).insert(auditLog).values({
    id: randomUUID(), userId, action, objectId, result: after && typeof after === "object" && "status" in after && typeof after.status === "number" && after.status >= 400 ? "DENIED" : "SUCCESS",
    description: "Perubahan tercatat dengan hak akses server; nilai sensitif tidak dicatat.",
    before: safe(before), after: safe(after),
  });
}
