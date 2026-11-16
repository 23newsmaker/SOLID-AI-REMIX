// Pure helpers with no database dependency, so they can be unit-tested without DATABASE_URL.
import { MAX_REF_IMAGES, MAX_SEED, type WorkflowKind } from "./workflow";

export class PlanError extends Error {}
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export type AiInputs = { character: true; attachmentIds: string[]; ignored: { name: string; reason: string }[] };

/** Which attachments feed the workflow and which are ignored (MP4/audio are never sent to ComfyUI). */
export function planInputs(kind: WorkflowKind, materials: { id: string; name: string; contentType: string }[]) {
  const images = materials.filter(m => IMAGE_TYPES.includes(m.contentType));
  const ignored = materials.filter(m => !IMAGE_TYPES.includes(m.contentType))
    .map(m => ({ name: m.name, reason: m.contentType === "video/mp4" ? "MP4 tidak dipakai: workflow ComfyUI tidak memiliki input video" : "Audio tidak dipakai: suara dibuat model dari narasi" }));
  let use: typeof images;
  if (kind === "I2V") use = [];
  else if (kind === "FIRST_LAST") {
    if (!images.length) throw new PlanError("Workflow frame pertama+terakhir membutuhkan satu lampiran gambar sebagai frame terakhir.");
    use = images.slice(0, 1);
  } else {
    if (!images.length) throw new PlanError("Workflow referensi membutuhkan minimal satu lampiran gambar.");
    use = images.slice(0, MAX_REF_IMAGES - 1);
  }
  if (kind === "I2V" && images.length) ignored.push(...images.map(m => ({ name: m.name, reason: "Gambar lampiran tidak dipakai pada workflow I2V; pilih workflow referensi untuk memakainya" })));
  return { use, ignored };
}

/** Same request body => same seed; a new requestKey gives a new seed. */
export const seedFor = (requestHash: string) => parseInt(requestHash.slice(0, 8), 16) % MAX_SEED;

/** Technical facts from ffprobe JSON that must hold for a usable review file. */
export function technicalChecks(probe: any, bytes: number, targetSeconds: number) {
  const streams: any[] = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find(s => s.codec_type === "video"), audio = streams.find(s => s.codec_type === "audio");
  const duration = Number(probe?.format?.duration);
  return [
    { id: "VIDEO_TRACK", ok: !!video && video.codec_name === "h264", detail: video ? `${video.codec_name} ${video.width}x${video.height}` : "Tidak ada track video." },
    { id: "AUDIO_TRACK", ok: !!audio, detail: audio ? `${audio.codec_name}` : "Tidak ada track audio; model seharusnya membuat suara." },
    { id: "DURATION", ok: Number.isFinite(duration) && Math.abs(duration - targetSeconds) <= 2.5, detail: `Target ±${targetSeconds} detik; aktual ${Number.isFinite(duration) ? duration.toFixed(2) : "?"} detik.` },
    { id: "FILE_SIZE", ok: bytes > 0 && bytes <= 20 * 1024 * 1024, detail: `${bytes} byte; batas 20 MiB.` },
  ];
}
