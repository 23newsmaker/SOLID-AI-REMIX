import { desc } from "drizzle-orm";
import { db, videoJobs, members, characters, creativeConcepts, auditLog, type MemberRecord, type VideoJobRow } from "@workspace/db";
import { GetOperationsReportQueryParams } from "@workspace/api-zod";
import { CreativeError, libraryAdmin } from "../creative-policy";
import { quotaDay } from "../video/policy";
import { serializeJob } from "../video/service";
import { costRecord, knownSpend, getSettings, settingsView, localRuntime } from "./controls";

export function reportFilter(raw: unknown) {
  const input = GetOperationsReportQueryParams.parse(raw);
  const today = quotaDay(), from = input.from ?? `${today.slice(0, 7)}-01`, to = input.to ?? today;
  const start = Date.parse(`${from}T00:00:00+07:00`), end = Date.parse(`${to}T00:00:00+07:00`) + 86400_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 366 * 86400_000) throw new CreativeError(400, "Rentang tanggal maksimal366hari, awal tidak boleh setelah akhir.");
  return { ...input, from, to, start, end };
}
export function group(id: string, name: string, rows: VideoJobRow[]) {
  const unknownCosts = rows.filter(j => j.actualCostUsd === null).length;
  const pending = rows.filter(j => ["QUEUED", "READY", "PROCESSING", "SUBMITTED", "UNKNOWN"].includes(j.status));
  return { id, name, jobs: rows.length, successful: rows.filter(j => j.status === "COMPLETED").length,
    failed: rows.filter(j => j.status === "FAILED").length, retries: rows.reduce((s, j) => s + Math.max(0, j.attempts - 1), 0),
    actualUsd: unknownCosts ? null : rows.reduce((s, j) => s + j.actualCostUsd!, 0),
    knownSubtotalUsd: rows.reduce((s, j) => s + knownSpend(j), 0), unknownCosts,
    estimatedPendingUsd: pending.some(j => j.estimatedCostUsd === null) ? null : pending.reduce((s, j) => s + j.estimatedCostUsd!, 0),
    approved: rows.filter(j => j.publicationStatus === "APPROVED_FOR_PUBLICATION").length,
    rejected: rows.filter(j => j.publicationStatus === "REJECTED").length,
    waiting: rows.filter(j => j.publicationStatus === "WAITING_FINAL_REVIEW").length };
}
export async function report(raw: unknown, me: MemberRecord, all = false) {
  if (me.status !== "ACTIVE" || !libraryAdmin(me)) throw new CreativeError(403, "Laporan operasional hanya admin.");
  const f = reportFilter(raw);
  const allJobs = await db.select().from(videoJobs).orderBy(desc(videoJobs.createdAt));
  const selected = allJobs.filter(j => j.quotaDay >= f.from && j.quotaDay <= f.to && (!f.userId || j.ownerId === f.userId));
  const real = selected.filter(j => !j.simulation);
  const people = await db.select().from(members);
  const chars = await db.select().from(characters);
  const concepts = (await db.select().from(creativeConcepts)).filter(c => c.createdAt.getTime() >= f.start && c.createdAt.getTime() < f.end && (!f.userId || c.ownerId === f.userId));
  // Only still-valid final approvals count as publishable.
  const serialized = await Promise.all(real.map(j => serializeJob(j, me)));
  const effective = real.map((j, i) => ({ ...j, publicationStatus: serialized[i]!.publicationStatus }));
  const summary = group("all", "Produksi", effective);
  const c = await getSettings(), runtime = await localRuntime();
  const warnings = [
    "USD saja; biaya estimasi bukan aktual. Subtotal diketahui belum mencakup komponen unknown. CPU/storage belum terukur.",
    `Renderer lokal: ${c.localEnabled ? "diaktifkan" : "dinonaktifkan"}; pemeriksaan binary: ${runtime.available ? "tersedia" : "tidak tersedia"}. AI berbayar belum dikonfigurasi.`,
    ...(real.length > 200 && !all ? ["Rincian200terbaru ditampilkan; total dan CSV mencakup semua pekerjaan sesuai filter."] : []),
  ];
  for (const [label, limit, rows] of [
    ["bulanan", c.budgetUsd, allJobs.filter(j => !j.simulation && j.quotaDay.startsWith(quotaDay().slice(0, 7)))],
    ["harian", c.dailyBudgetUsd, allJobs.filter(j => !j.simulation && j.quotaDay === quotaDay())],
  ] as const) {
    if (limit !== null && rows.reduce((s, j) => s + knownSpend(j) + (["QUEUED", "PROCESSING", "SUBMITTED", "UNKNOWN"].includes(j.status) ? j.reservedCostUsd : 0), 0) >= limit * c.warningPercent / 100) warnings.push(`Peringatan anggaran ${label}: ambang${c.warningPercent}% tercapai.`);
  }
  return { from: f.from, to: f.to, summary, users: people.map(p => group(p.id, p.name, effective.filter(j => j.ownerId === p.id))),
    modes: ["HEMAT", "AI"].map(m => group(m, m, effective.filter(j => j.mode === m))),
    providers: [...new Set(effective.map(j => j.provider))].map(p => group(p, p, effective.filter(j => j.provider === p))),
    jobs: all ? serialized : serialized.slice(0, 200), activeMembers: people.filter(p => p.status === "ACTIVE").length,
    pendingMembers: people.filter(p => p.status === "PENDING").length, characters: chars.filter(x => !f.userId || x.userId === f.userId).length,
    concepts: concepts.length, approvedConcepts: concepts.filter(c => c.status === "APPROVED").length,
    rejectedConcepts: concepts.filter(c => c.status === "REJECTED").length, waitingConcepts: concepts.filter(c => ["READY_FOR_REVIEW", "UNDER_REVIEW"].includes(c.status)).length,
    processing: real.filter(j => ["QUEUED", "PROCESSING", "SUBMITTED"].includes(j.status)).length,
    simulations: selected.filter(j => j.simulation).length, settings: settingsView(c), warnings };
}
export const csvCell = (value: unknown) => {
  let s = value === null || value === undefined ? "UNKNOWN" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
};
export async function reportCsv(raw: unknown, me: MemberRecord) {
  const r = await report(raw, me, true);
  const headers = ["JobID", "UserID", "TanggalJakarta", "Mode", "Provider", "Model", "Status", "FinalReview", "Detik", "Resolusi", "Currency", "Estimated", "Actual", "Provider", "Rendering", "TTS", "RetryCost", "Retries", "Reserved", "CostSource", "ActualPerPublishable"];
  return "\uFEFF" + [headers, ...r.jobs.map(j => {
    const c = j.cost!;
    return [j.id, j.ownerId, quotaDay(new Date(j.createdAt)), j.mode, j.provider, c.model, j.status, j.publicationStatus, j.durationSeconds, `${j.width}x${j.height}`,
      c.currency, c.estimatedUsd, c.actualUsd, c.providerUsd, c.renderUsd, c.ttsUsd, c.retryUsd, c.retries, c.reservedUsd, c.source,
      j.publicationStatus === "APPROVED_FOR_PUBLICATION" ? c.actualUsd : null];
  })].map(row => row.map(csvCell).join(",")).join("\r\n");
}
export async function auditRows(me: MemberRecord) {
  if (!libraryAdmin(me) || me.status !== "ACTIVE") throw new CreativeError(403, "Audit tim hanya admin.");
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), before: r.before === null ? null : JSON.stringify(r.before), after: r.after === null ? null : JSON.stringify(r.after) }));
}
