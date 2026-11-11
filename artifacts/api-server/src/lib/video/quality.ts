import { stat } from "node:fs/promises";
import type { VideoDiagnostics, VideoQualityCheck } from "@workspace/api-zod";

export const RENDERER_VERSION = "hemat-2";
export const emptyDiagnostics = (): VideoDiagnostics => ({
  rendererVersion: RENDERER_VERSION, queueMs: null, materialMs: null, renderMs: null,
  validationMs: null, storageMs: null, totalMs: null, bytes: null, quality: [],
});
type Command = (command: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal) => Promise<string>;
export async function inspectVideo(path: string, duration: number, command: Command, signal?: AbortSignal) {
  const meta = JSON.parse(await command("ffprobe", ["-v", "error", "-show_entries",
    "format=duration:stream=codec_name,codec_type,width,height,duration", "-of", "json", path], signal));
  const checks: VideoQualityCheck[] = [];
  const check = (id: string, ok: boolean, detail: string) => checks.push({ id, status: ok ? "PASS" : "FAIL", detail });
  const video = meta.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  const audio = meta.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");
  const bytes = (await stat(path)).size;
  check("VIDEO_PROFILE", video?.codec_name === "h264" && video.width === 720 && video.height === 1280,
    "MP4 H.264, 720×1280, vertikal 9:16.");
  check("DURATION", Number.isFinite(Number(meta.format?.duration)) && Math.abs(Number(meta.format.duration) - duration) <= 0.2,
    `Target ${duration} detik; aktual ${Number(meta.format?.duration).toFixed(3)} detik.`);
  check("AUDIO_TRACK", audio?.codec_name === "aac" && Math.abs(Number(audio.duration) - duration) <= 0.2,
    "Track AAC mengikuti durasi; sinkronisasi ucapan tetap perlu didengar manusia.");
  check("FILE_SIZE", bytes > 0 && bytes <= 20 * 1024 * 1024, `${bytes} byte; batas 20 MiB.`);
  try {
    // Fully decode both streams, not just a successful container probe.
    await command("ffmpeg", ["-v", "error", "-xerror", "-threads", "1", "-protocol_whitelist", "file,pipe",
      "-i", path, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], signal);
    check("DECODE", true, "Seluruh frame video dan track audio berhasil didekode.");
  } catch { check("DECODE", false, "Decode gagal/dibatalkan; file tidak akan diserahkan sebagai hasil selesai."); }
  checks.push({ id: "CONTENT", status: "MANUAL_REVIEW_REQUIRED",
    detail: "Wajah, gerakan, logo resmi, angka, subtitle terhadap suara, disclaimer dan kesesuaian konsep wajib review manusia Tahap D. PASS teknis bukan izin publikasi." });
  return { checks, bytes };
}
