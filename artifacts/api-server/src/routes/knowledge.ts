import { Router } from "express";
import { and, eq, ilike, or, asc } from "drizzle-orm";
import { db, knowledgeSources, type KnowledgeRecord } from "@workspace/db";
import { ListKnowledgeQueryParams, ListKnowledgeResponse, GetKnowledgeSourceParams, GetKnowledgeSourceResponse } from "@workspace/api-zod";
import { requireMember, requireActive, hasRestrictedAccess } from "../middlewares/member";
import { audit } from "../lib/audit";

export const knowledgeRouter = Router();
knowledgeRouter.use("/knowledge", requireMember, requireActive);
function publicAllowed(s: KnowledgeRecord) {
  return s.validation === "APPROVED" && s.access === "APPROVED_FOR_PUBLIC_CONTENT";
}
function serialize(s: KnowledgeRecord) {
  return {
    id: s.id, title: s.title, sourceId: s.sourceId, segment: s.segment,
    category: s.category, validation: s.validation, access: s.access,
    version: s.version, fileName: s.fileName, warnings: s.warnings,
  };
}
knowledgeRouter.get("/knowledge", async (req, res) => {
  const input = ListKnowledgeQueryParams.parse(req.query);
  const filters = [eq(knowledgeSources.active, true)];
  if (!hasRestrictedAccess(req)) {
    filters.push(or(eq(knowledgeSources.access, "INTERNAL_GENERAL"), eq(knowledgeSources.access, "APPROVED_FOR_PUBLIC_CONTENT"))!);
  }
  if (input.mode !== "INTERNAL") {
    filters.push(eq(knowledgeSources.validation, "APPROVED"), eq(knowledgeSources.access, "APPROVED_FOR_PUBLIC_CONTENT"));
  }
  if (input.segment && input.segment !== "ALL") filters.push(eq(knowledgeSources.segment, input.segment));
  if (input.q?.trim()) {
    const escaped = input.q.trim().replace(/[\\%_]/g, "\\$&");
    filters.push(or(ilike(knowledgeSources.title, `%${escaped}%`), ilike(knowledgeSources.content, `%${escaped}%`))!);
  }
  const rows = await db.select().from(knowledgeSources).where(and(...filters)).orderBy(asc(knowledgeSources.title)).limit(150);
  res.json(ListKnowledgeResponse.parse({
    items: rows.map(serialize), total: rows.length, publicApproved: rows.filter(publicAllowed).length,
    notice: input.mode === "INTERNAL"
      ? "Referensi internal, bukan izin publikasi. Angka produk dan konflik wajib ditinjau admin. Data Mikro tidak diisi dari Mini."
      : "Hanya sumber dengan validasi APPROVED dan izin publik aktif yang ditampilkan. Label PUBLIC lama bukan persetujuan.",
  }));
});
knowledgeRouter.get("/knowledge/:id", async (req, res) => {
  const { id } = GetKnowledgeSourceParams.parse(req.params);
  const [source] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.active, true)));
  if (!source) { res.status(404).json({ error: "Sumber tidak ditemukan." }); return; }
  const general = source.access === "INTERNAL_GENERAL" || source.access === "APPROVED_FOR_PUBLIC_CONTENT";
  if (!general && !hasRestrictedAccess(req)) {
    res.status(403).json({ error: "Dokumen terbatas untuk admin dan reviewer compliance." }); return;
  }
  await audit(req.member!.id, source.access === "INTERNAL_RESTRICTED" ? "RESTRICTED_SOURCE_READ" : "SOURCE_READ", `Membaca sumber ${source.sourceId}.`);
  res.json(GetKnowledgeSourceResponse.parse({ source: serialize(source), content: source.content }));
});
