import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, publicFacts, knowledgeSources, factEvents, type MemberRecord, type KnowledgeRecord } from "@workspace/db";
import { CreatePublicFactBody, RevisePublicFactBody, ReviewPublicFactBody, ReviewComplianceSourceBody } from "@workspace/api-zod";
import { CreativeError, libraryAdmin } from "../creative-policy";
import type { CreativeTx } from "../creative-service";
import { sourceRevision } from "../source-revision";
import { audit } from "./audit";

export const complianceAccess = (me: Pick<MemberRecord, "role">) => libraryAdmin(me) || me.role === "REVIEWER_COMPLIANCE";
export function requireCompliance(me: MemberRecord) {
  if (me.status !== "ACTIVE" || !complianceAccess(me)) throw new CreativeError(403, "Hanya pengelola/compliance aktif.");
}
export const complianceLock = (tx: CreativeTx) => tx.execute(sql`SELECT pg_advisory_xact_lock(7101800)`);
export function approvedSource(s?: KnowledgeRecord) {
  return !!s && s.active && s.validation === "APPROVED" && s.access === "APPROVED_FOR_PUBLIC_CONTENT" && !s.warnings.length;
}
export function sourceView(s: KnowledgeRecord) {
  return { ...s, revision: sourceRevision(s) };
}
export async function sources(me: MemberRecord) {
  requireCompliance(me);
  return (await db.select().from(knowledgeSources)).map(sourceView);
}
export async function reviewSource(id: string, body: unknown, me: MemberRecord) {
  requireCompliance(me);
  if (!["SUPER_ADMIN", "REVIEWER_COMPLIANCE"].includes(me.role)) throw new CreativeError(403, "Keputusan sumber hanya compliance/admin utama.");
  const input = ReviewComplianceSourceBody.parse(body);
  return db.transaction(async tx => {
    await complianceLock(tx);
    const [row] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)).for("update");
    if (!row || sourceRevision(row) !== input.revision) throw new CreativeError(409, "Sumber berubah/tidak tersedia. Muat ulang sebelum keputusan.");
    if (input.validation === "APPROVED" && row.warnings.length && !input.clearWarnings) throw new CreativeError(409, "Konflik/peringatan harus diperiksa dan penyelesaiannya dicatat eksplisit.");
    const [saved] = await tx.update(knowledgeSources).set({
      validation: input.validation, access: input.access, warnings: input.clearWarnings ? [] : row.warnings,
    }).where(eq(knowledgeSources.id, id)).returning();
    await audit(me.id, "SOURCE_REVIEWED", id, { revision: input.revision, validation: row.validation, access: row.access },
      { revision: sourceRevision(saved!), validation: saved!.validation, access: saved!.access, note: input.note, warningsResolved: input.clearWarnings }, tx);
    return sourceView(saved!);
  });
}
export async function factView(f: typeof publicFacts.$inferSelect, tx?: CreativeTx) {
  const [source] = await (tx ?? db).select().from(knowledgeSources).where(eq(knowledgeSources.id, f.sourceId));
  return { ...f, reviewedAt: f.reviewedAt?.toISOString() ?? null,
    usable: f.status === "APPROVED" && approvedSource(source) && sourceRevision(source!) === f.sourceRevision };
}
export async function facts(me: MemberRecord) {
  if (me.status !== "ACTIVE") throw new CreativeError(403, "Akun tidak aktif.");
  const rows = await db.select().from(publicFacts);
  const values = await Promise.all(rows.map(r => factView(r)));
  return complianceAccess(me) ? values : values.filter(f => f.usable);
}
export async function saveFact(id: string | null, body: unknown, me: MemberRecord) {
  requireCompliance(me);
  const input = id ? RevisePublicFactBody.parse(body) : CreatePublicFactBody.parse(body);
  return db.transaction(async tx => {
    await complianceLock(tx);
    const [source] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, input.sourceId));
    if (!source?.active || !source.content.includes(input.quote)) throw new CreativeError(400, "Kutipan harus sama persis dengan isi sumber aktif yang dipilih.");
    let old: typeof publicFacts.$inferSelect | undefined;
    if (id) {
      [old] = await tx.select().from(publicFacts).where(eq(publicFacts.id, id)).for("update");
      if (!old || !("version" in input) || old.version !== input.version) throw new CreativeError(409, "Versi fakta berubah.");
      if (old.creatorId !== me.id && me.role !== "SUPER_ADMIN") throw new CreativeError(403, "Hanya pengusul/admin utama dapat merevisi.");
      await tx.insert(factEvents).values({ id: randomUUID(), factId: id, actorId: me.id, snapshot: old });
    }
    const value = { sourceId: source.id, sourceRevision: sourceRevision(source), segment: source.segment,
      claim: input.claim, quote: input.quote, status: "DRAFT", version: (old?.version ?? 0) + 1,
      creatorId: me.id, reviewerId: null, note: "", reviewedAt: null };
    const [saved] = id ? await tx.update(publicFacts).set(value).where(eq(publicFacts.id, id)).returning()
      : await tx.insert(publicFacts).values({ id: randomUUID(), ...value }).returning();
    await tx.insert(factEvents).values({ id: randomUUID(), factId: saved!.id, actorId: me.id, snapshot: saved! });
    await audit(me.id, id ? "FACT_REVISED" : "FACT_CREATED", saved!.id, old ? { version: old.version, status: old.status } : null, { version: saved!.version, status: "DRAFT" }, tx);
    return factView(saved!, tx);
  });
}
export async function reviewFact(id: string, body: unknown, me: MemberRecord) {
  requireCompliance(me);
  const input = ReviewPublicFactBody.parse(body);
  if (!["SUPER_ADMIN", "REVIEWER_COMPLIANCE"].includes(me.role)) throw new CreativeError(403, "Keputusan fakta hanya compliance/admin utama.");
  return db.transaction(async tx => {
    await complianceLock(tx);
    const [row] = await tx.select().from(publicFacts).where(eq(publicFacts.id, id)).for("update");
    if (!row || row.version !== input.version) throw new CreativeError(409, "Versi fakta berubah.");
    if (input.status !== "REVOKED" && row.creatorId === me.id) throw new CreativeError(403, "Pengusul tidak boleh memutuskan persetujuannya sendiri.");
    if (input.status === "APPROVED") {
      const [source] = await tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, row.sourceId));
      if (!approvedSource(source) || sourceRevision(source!) !== row.sourceRevision || !source!.content.includes(row.quote)) {
        throw new CreativeError(409, "Sumber/kutipan berubah atau belum lolos publik. Revisi dan review ulang.");
      }
    }
    const [saved] = await tx.update(publicFacts).set({ status: input.status, reviewerId: me.id, note: input.note,
      reviewedAt: new Date(), version: row.version + 1 }).where(eq(publicFacts.id, id)).returning();
    await tx.insert(factEvents).values({ id: randomUUID(), factId: id, actorId: me.id, snapshot: saved! });
    await audit(me.id, `FACT_${input.status}`, id, { version: row.version, status: row.status }, { version: saved!.version, status: saved!.status, note: input.note }, tx);
    return factView(saved!, tx);
  });
}
export async function selectedFacts(ids: string[], tx?: Pick<typeof db, "select">) {
  if (ids.length !== new Set(ids).size) throw new CreativeError(400, "Fakta tidak boleh berulang.");
  if (!ids.length) return [];
  return (tx ?? db).select().from(publicFacts).where(inArray(publicFacts.id, ids));
}
