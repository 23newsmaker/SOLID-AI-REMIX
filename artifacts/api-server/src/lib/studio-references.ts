import { and, eq } from "drizzle-orm";
import { db, knowledgeSources, studioFolders, type MemberRecord } from "@workspace/db";
import type { CreativeConceptInput } from "@workspace/api-zod";
import { approvedSource } from "./operations/facts";
import { sourceRevision } from "./source-revision";
import { CreativeError } from "./creative-policy";

export const STUDIO_REFERENCE_POLICY = "STUDIO_REFERENCE_ONLY_V1" as const;
type Conn = Pick<typeof db, "select">;

// Called only with a folder supplied by authenticated middleware, or persisted
// server-owned job options. A request body flag never grants studio context.
export async function referenceFolder(member: MemberRecord, folderId: string, conn: Conn = db) {
  const [folder] = await conn.select().from(studioFolders).where(and(
    eq(studioFolders.id, folderId), eq(studioFolders.memberId, member.id),
  ));
  if (!folder || member.status !== "ACTIVE") throw new CreativeError(403, "Folder studio tidak tersedia.");
  return folder;
}

export async function studioReferences(input: CreativeConceptInput, conn: Conn = db) {
  // Metadata-only topic matching; never include whole documents or unavailable
  // fact claims/quotes supplied by a caller.
  const rows = await conn.select().from(knowledgeSources).where(and(
    eq(knowledgeSources.active, true), eq(knowledgeSources.validation, "APPROVED"),
    eq(knowledgeSources.access, "APPROVED_FOR_PUBLIC_CONTENT"),
  ));
  return rows.filter(s => approvedSource(s) &&
    (s.segment === "COMPANY" || input.segments.includes(s.segment as typeof input.segments[number])))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId)).slice(0, 3)
    .map(s => ({ id: s.id, sourceId: s.sourceId, title: s.title, segment: s.segment,
      version: s.version, revision: sourceRevision(s) }));
}
