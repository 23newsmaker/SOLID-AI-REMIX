import { and, eq } from "drizzle-orm";
import { db, characters, conceptAttachments, studioFolders, type MemberRecord } from "@workspace/db";
import type { VideoRenderOptions } from "@workspace/api-zod";
import { buildCreative, parseConcept, staleReasons, type CreativeSnapshot } from "../creative-builder";
import { checkVersion, CreativeError, requireOwnerEditor } from "../creative-policy";
import { readConcept, readyMaterials, type CreativeTx } from "../creative-service";
import { studioConfigured } from "../studio-access";
import { videoPostText } from "./post-text";
import { resolveLogo } from "./branding";
import { referenceFolder, STUDIO_REFERENCE_POLICY } from "../studio-references";

export const costNote = "Provider video/TTS/LLM: tidak dipanggil. Biaya CPU rendering dan penyimpanan belum diukur, bukan gratis atau total USD0. Batas anggaran mengontrol biaya provider yang diketahui; komputasi juga dibatasi 3 job/hari dan satu renderer.";
export function quotaDay(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function subtitleChunks(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return Array.from({ length: Math.ceil(words.length / 9) }, (_, i) => words.slice(i * 9, i * 9 + 9).join(" "));
}
export async function eligibleConcept(id: string, version: number, me: MemberRecord, options: VideoRenderOptions, tx?: CreativeTx, referenceFolderId?: string) {
  const conn = tx ?? db;
  if (referenceFolderId) await referenceFolder(me, referenceFolderId, conn);
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
  if (!referenceFolderId && data.publicMode && (row.snapshot as CreativeSnapshot).policyVersion !== 2) throw new CreativeError(409, "Persetujuan lama perlu diikat ke fakta spesifik atau deklarasi netral, lalu review ulang.");
  const materials = await readyMaterials(id, tx);
  const reasons = await staleReasons(row.snapshot as CreativeSnapshot, conn, !referenceFolderId);
  const built = await buildCreative(data, actor, conn, materials, referenceFolderId);
  const pending = await conn.select({ id: conceptAttachments.id }).from(conceptAttachments).where(and(
    eq(conceptAttachments.conceptId, id), eq(conceptAttachments.state, "PENDING"),
  )).limit(1);
  if (reasons.length || built.blockers.length || (!referenceFolderId && row.blockers.length) || pending.length || (materials.length && !data.materialConsent)) {
    throw new CreativeError(409, "Bahan/rujukan berubah atau belum diizinkan. Perbaiki dan simpan ulang: " +
      [...reasons, ...built.blockers].join(" "));
  }
  if (data.format !== "9:16" || data.durationSeconds < 10 || data.durationSeconds > 15) throw new CreativeError(400, "Profil Hemat awal: vertikal9:16, durasi10–15detik. Edit konsep dan review ulang.");
  const postText = videoPostText(data, options.postTextMode, !!folder);
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
  const logo = resolveLogo(options, !!folder, materials);
  if (materials.some(m => m.ownerId !== me.id)) throw new CreativeError(403, "Bahan bukan milik folder ini.");
  const [character] = await conn.select().from(characters).where(and(eq(characters.id, data.characterId), eq(characters.userId, me.id)));
  if (!character) throw new CreativeError(409, "Foto karakter tidak tersedia.");
  return { row, data: { ...data, ...postText }, materials, character, logo, chunks };
}

// Only pass stored job options here, never raw request options.
export function jobReferenceFolder(options: VideoRenderOptions) {
  if (!options.referencePolicy && !options.studioFolderId) return undefined;
  if (options.referencePolicy !== STUDIO_REFERENCE_POLICY || !options.studioFolderId) {
    throw new CreativeError(409, "Kebijakan referensi pekerjaan tidak lengkap.");
  }
  return options.studioFolderId;
}
