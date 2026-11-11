import type { MemberRecord } from "@workspace/db";

export class CreativeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const limits = {
  maxConcepts: 10, maxImages: 3, maxImageBytes: 5 * 1024 * 1024,
  maxVideos: 1, maxVideoBytes: 20 * 1024 * 1024, maxTotalBytes: 35 * 1024 * 1024,
  maxAudio: 1, maxAudioBytes: 5 * 1024 * 1024,
};
export const libraryAdmin = (m: Pick<MemberRecord, "role">) => ["SUPER_ADMIN", "ADMIN"].includes(m.role);
export function canReadConcept(m: Pick<MemberRecord, "id" | "role">, c: { ownerId: string; submittedAt: Date | null; status: string }) {
  return c.ownerId === m.id || libraryAdmin(m) ||
    (m.role === "REVIEWER_COMPLIANCE" && !!c.submittedAt && c.status !== "DRAFT");
}
export function requireOwnerEditor(m: Pick<MemberRecord, "id" | "role">, c: { ownerId: string }) {
  if (m.role === "VIEWER" || m.id !== c.ownerId) throw new CreativeError(403, "Hanya pembuat dengan hak tulis dapat mengubah konsep.");
}
export function checkVersion(actual: number, expected: number) {
  if (actual !== expected) throw new CreativeError(409, "Konsep sudah berubah. Masukan Anda tidak ditimpa; buka versi terbaru sebelum menyimpan lagi.");
}
export function checkSegments(segments: string[]) {
  if (!segments.length || new Set(segments).size !== segments.length ||
    (segments.includes("NONE") && segments.length !== 1)) {
    throw new CreativeError(400, "Tidak terkait produk tidak boleh digabung dengan segmen produk; pilihan tidak boleh berulang.");
  }
}
export function checkQuota(rows: { contentType: string; size: number }[], next: { contentType: string; size: number }) {
  const all = [...rows, next];
  if (all.reduce((n, r) => n + r.size, 0) > limits.maxTotalBytes ||
    all.filter(r => r.contentType.startsWith("image/")).length > limits.maxImages ||
    all.filter(r => r.contentType === "video/mp4").length > limits.maxVideos ||
    all.filter(r => r.contentType.startsWith("audio/")).length > limits.maxAudio ||
    next.size > (next.contentType === "video/mp4" ? limits.maxVideoBytes : limits.maxImageBytes)) {
    throw new CreativeError(409, "Kuota bahan terlampaui: 3 gambar × 5 MiB, 1 MP4 × 20 MiB, 1 audio × 5 MiB, total 35 MiB termasuk unggahan tertunda.");
  }
}
export function checkTransition(m: Pick<MemberRecord, "id" | "role">, c: { ownerId: string; status: string }, next: string) {
  if (next === "APPROVED" || next === "REJECTED") {
    if (!["SUPER_ADMIN", "REVIEWER_COMPLIANCE"].includes(m.role) || m.id === c.ownerId) {
      throw new CreativeError(403, "Review wajib dilakukan compliance atau admin utama yang bukan pembuat.");
    }
    if (c.status !== "READY_FOR_REVIEW") throw new CreativeError(409, "Hanya konsep Ready for Review dapat diputuskan.");
  } else {
    requireOwnerEditor(m, c);
    const valid = next === "READY_FOR_REVIEW" ? ["DRAFT", "REJECTED"] : ["READY_FOR_REVIEW", "REJECTED"];
    if (!valid.includes(c.status)) throw new CreativeError(409, "Transisi status tidak diizinkan.");
  }
}
