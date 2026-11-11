import { createHash } from "node:crypto";
import type { KnowledgeRecord } from "@workspace/db";
export const sourceRevision = (s: KnowledgeRecord) => createHash("sha256").update(JSON.stringify([
  s.version, s.sha256, s.content, s.active, s.validation, s.access, s.segment, s.warnings,
])).digest("hex");
