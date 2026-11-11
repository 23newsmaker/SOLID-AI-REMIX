import { eq, sql } from "drizzle-orm";
import { db, videoSettings, videoJobs, type MemberRecord, type VideoJobRow } from "@workspace/db";
import { UpdateOperationsSettingsBody, UpdateProviderControlsBody } from "@workspace/api-zod";
import { libraryAdmin, CreativeError } from "../creative-policy";
import type { CreativeTx } from "../creative-service";
import { mediaCommand } from "../video/renderer";
import { costNote, quotaDay } from "../video/policy";
import { audit } from "./audit";

export async function getSettings(tx?: CreativeTx) {
  const conn = tx ?? db;
  await conn.insert(videoSettings).values({ id: "main" }).onConflictDoNothing();
  return (await conn.select().from(videoSettings).where(eq(videoSettings.id, "main")))[0]!;
}
export function settingsView(c: typeof videoSettings.$inferSelect) {
  return { ...c, retentionApproved: c.retentionDays !== null && c.retentionApprovedVersion === c.retentionVersion, costNote };
}
export function costRecord(j: VideoJobRow) {
  const d = j.costDetails as { renderUsd?: number | null; ttsUsd?: number | null; retryUsd?: number | null } | null;
  return { currency: j.currency, model: j.model, source: j.costSource ?? "LEGACY: sumber biaya tidak tercatat",
    estimatedUsd: j.estimatedCostUsd, actualUsd: j.actualCostUsd, providerUsd: j.providerCostUsd,
    renderUsd: d?.renderUsd ?? null, ttsUsd: d?.ttsUsd ?? null, retryUsd: d?.retryUsd ?? null,
    reservedUsd: j.reservedCostUsd, retries: Math.max(0, j.attempts - 1), legacy: !j.costSource };
}
export function knownSpend(j: VideoJobRow) {
  if (j.actualCostUsd !== null) return j.actualCostUsd;
  const c = costRecord(j);
  return (c.providerUsd ?? 0) + (c.renderUsd ?? 0) + (c.ttsUsd ?? 0) + (c.retryUsd ?? 0);
}
const open = (j: VideoJobRow) => ["QUEUED", "READY", "PROCESSING", "SUBMITTED", "UNKNOWN"].includes(j.status);
export function enforceBudgets(c: typeof videoSettings.$inferSelect, rows: VideoJobRow[], ownerId: string, boundUsd: number | null, paid: boolean, day = quotaDay()) {
  if (c.paused || !c.localEnabled) throw new CreativeError(409, "Produksi dijeda/renderer dinonaktifkan pengelola.");
  if (paid && (boundUsd === null || !Number.isFinite(boundUsd) || boundUsd < 0)) throw new CreativeError(409, "Biaya berbayar tidak mempunyai batas andal; pekerjaan ditolak.");
  const real = rows.filter(j => !j.simulation && j.currency === "USD");
  const month = day.slice(0, 7);
  const scopes = [
    { limit: c.budgetUsd, label: "bulanan", jobs: real.filter(j => j.quotaDay.startsWith(month)) },
    { limit: c.dailyBudgetUsd, label: "harian", jobs: real.filter(j => j.quotaDay === day) },
    { limit: c.userBudgetUsd, label: "anggota/bulan", jobs: real.filter(j => j.ownerId === ownerId && j.quotaDay.startsWith(month)) },
  ];
  for (const s of scopes) {
    const exposure = s.jobs.reduce((n, j) => n + knownSpend(j) + (open(j) ? j.reservedCostUsd : 0), 0);
    if (s.limit !== null && (exposure >= s.limit || exposure + (boundUsd ?? 0) > s.limit)) {
      throw new CreativeError(409, `Batas anggaran ${s.label} tercapai/akan terlampaui. Riwayat tidak dihapus; pekerjaan berjalan tidak dibatalkan otomatis.`);
    }
  }
}
export async function saveSettings(body: unknown, me: MemberRecord) {
  if (me.status !== "ACTIVE" || !libraryAdmin(me)) throw new CreativeError(403, "Hanya admin aktif.");
  const input = UpdateOperationsSettingsBody.parse(body);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`);
    const old = await getSettings(tx);
    const changedRetention = old.retentionDays !== input.retentionDays;
    const [saved] = await tx.update(videoSettings).set({ ...input,
      ...(changedRetention ? { retentionVersion: old.retentionVersion + 1, retentionApprovedVersion: null,
        retentionApprovedBy: null, retentionApprovedAt: null } : {}),
    }).where(eq(videoSettings.id, "main")).returning();
    if (changedRetention) await tx.update(videoJobs).set({ retentionNoticeAt: null, retentionNoticeVersion: null }).where(eq(videoJobs.deleted, false));
    await audit(me.id, "OPERATION_SETTINGS_CHANGED", "main", settingsView(old), settingsView(saved!), tx);
    return settingsView(saved!);
  });
}
let checked: { at: number; available: boolean; model: string } | undefined;
export async function localRuntime() {
  if (checked && Date.now() - checked.at < 60_000) return checked;
  try {
    const a = await mediaCommand("ffmpeg", ["-version"]);
    await mediaCommand("ffprobe", ["-version"]);
    checked = { at: Date.now(), available: true, model: a.split("\n")[0]!.slice(0, 100) };
  } catch { checked = { at: Date.now(), available: false, model: "ffmpeg-local" }; }
  return checked;
}
export async function providerInfo() {
  const c = await getSettings(), runtime = await localRuntime();
  return [{ id: "local-compositor", name: "Renderer Hemat lokal", model: runtime.model,
    enabled: c.localEnabled, simulation: false, connection: runtime.available ? "LOCAL_AVAILABLE" : "LOCAL_UNAVAILABLE",
    capabilities: "MP4 720×1280,10–15detik; pan/zoom, compositing logo/subtitle/rekaman; bukan AI/lip-sync",
    price: "API provider/TTS0; CPU/storage belum diukur", priceSource: "Renderer lokal tanpa panggilan penyedia AI",
    checkedAt: new Date(runtime.at).toISOString(), reason: c.providerReason },
  { id: "unapproved-ai", name: "AI belum disetujui", model: "Belum dipilih", enabled: false, simulation: true,
    connection: "NOT_CONFIGURED", capabilities: "Mock bukan generasi AI", price: "Tidak diketahui",
    priceSource: "Belum ada konfigurasi/harga produksi disetujui", checkedAt: null, reason: "Persetujuan pemilik diperlukan; tidak ada aktivasi melalui halaman ini." }];
}
export async function saveProvider(body: unknown, me: MemberRecord) {
  if (me.status !== "ACTIVE" || me.role !== "SUPER_ADMIN") throw new CreativeError(403, "Konfigurasi provider hanya admin utama.");
  const input = UpdateProviderControlsBody.parse(body);
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`);
    const old = await getSettings(tx);
    await tx.update(videoSettings).set({ localEnabled: input.localEnabled, providerReason: input.reason }).where(eq(videoSettings.id, "main"));
    await audit(me.id, "PROVIDER_LOCAL_SWITCH", "local-compositor", { enabled: old.localEnabled }, { enabled: input.localEnabled, reason: input.reason }, tx);
  });
  return providerInfo();
}
