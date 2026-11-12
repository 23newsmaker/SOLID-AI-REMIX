import { and, eq } from "drizzle-orm";
import { db, characters, conceptAttachments, studioFolders, type MemberRecord } from "@workspace/db";
import type { VideoRenderOptions } from "@workspace/api-zod";
import { buildCreative, parseConcept, staleReasons, type CreativeSnapshot } from "../creative-builder";
import { checkVersion, CreativeError, requireOwnerEditor } from "../creative-policy";
import { readConcept, readyMaterials, type CreativeTx } from "../creative-service";
import { studioConfigured } from "../studio-access";

export const costNote = "Provider video/TTS/LLM: tidak dipanggil. Biaya CPU rendering dan penyimpanan belum diukur, bukan gratis atau total USD0. Batas anggaran mengontrol biaya provider yang diketahui; komputasi juga dibatasi 3 job/hari dan satu renderer.";
export function quotaDay(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function subtitleChunks(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return Array.from({ length: Math.ceil(words.length / 9) }, (_, i) => words.slice(i * 9, i * 9 + 9).join(" "));
}
export async function eligibleConcept(id: string, version: number, me: MemberRecord, options: VideoRenderOptions, tx?: CreativeTx) {
  const conn = tx ?? db;
  const row = await readConcept(id, me, tx);
  const [folder] = studioConfigured()
    ? await conn.select({ id: studioFolders.id }).from(studioFolders).where(eq(studioFolders.memberId, me.id)).limit(1)
    : [];
  const actor = folder ? { ...me, role: "CREATOR" as const } : me;
  requireOwnerEditor(actor, row);
  checkVersion(row.version, version);
  if (me.status !== "ACTIVE" || (!folder && row.status !== "APPROVED")) {
    throw new CreativeError(409, "Folder harus aktif; alur pribadi lama tetap memerlukan persetujuan reviewer.");
  }
  const data = parseConcept(row.data);
  if (data.publicMode && (row.snapshot as CreativeSnapshot).policyVersion !== 2) throw new CreativeError(409, "Persetujuan lama perlu diikat ke fakta spesifik atau deklarasi netral, lalu review ulang.");
  const materials = await readyMaterials(id, tx);
  const reasons = await staleReasons(row.snapshot as CreativeSnapshot, conn);
  const built = await buildCreative(data, actor, conn, materials);
  const pending = await conn.select({ id: conceptAttachments.id }).from(conceptAttachments).where(and(
    eq(conceptAttachments.conceptId, id), eq(conceptAttachments.state, "PENDING"),
  )).limit(1);
  if (reasons.length || built.blockers.length || row.blockers.length || pending.length || (materials.length && !data.materialConsent)) {
    throw new CreativeError(409, "Bahan/rujukan berubah atau belum diizinkan. Perbaiki dan simpan ulang: " +
      [...reasons, ...built.blockers].join(" "));
  }
  if (data.format !== "9:16" || data.durationSeconds < 10 || data.durationSeconds > 15) throw new CreativeError(400, "Profil Hemat awal: vertikal9:16, durasi10–15detik. Edit konsep dan review ulang.");
  if (!data.disclaimer?.trim() || data.disclaimer.length > 220 || data.cta.length > 90) throw new CreativeError(400, "Isi disclaimer di konsep (maks220 karakter); CTA maksimal90 karakter, lalu review ulang.");
  const chunks = subtitleChunks(data.subtitle.trim() || data.narration);
  if (!chunks.length || chunks.length > 12 || options.cues.length !== chunks.length || chunks.some(c => c.length > 160)) {
    throw new CreativeError(400, "Subtitle maksimal108 kata, kelompok9kata, maksimal160karakter per kelompok. Jumlah cue harus sama.");
  }
  let previous = 0;
  for (const cue of options.cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previous || cue.end <= cue.start || cue.end > data.durationSeconds) {
      throw new CreativeError(400, "Waktu subtitle harus berurutan, tidak tumpang tindih dan dalam durasi video.");
    }
    previous = cue.end;
  }
  const logo = materials.find(m => m.id === options.logoAttachmentId && m.contentType.startsWith("image/"));
  if (!logo?.finalPath) throw new CreativeError(400, "Pilih logo asli dari gambar bahan yang sudah direview. Tidak membuat ulang logo perusahaan.");
  const [character] = await conn.select().from(characters).where(and(eq(characters.id, data.characterId), eq(characters.userId, me.id)));
  if (!character) throw new CreativeError(409, "Foto karakter tidak tersedia.");
  return { row, data, materials, character, logo, chunks };
}
