import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CreativeError } from "./creative-policy";

export const VOICE_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MIN_SECONDS = 5;
export const VOICE_MAX_SECONDS = 60;
const containers: Record<string, string[]> = {
  "audio/webm": ["matroska", "webm"], "audio/ogg": ["ogg"],
  "audio/mp4": ["mov", "mp4", "m4a"], "audio/x-m4a": ["mov", "mp4", "m4a"],
  "audio/mpeg": ["mp3"], "audio/wav": ["wav"], "audio/x-wav": ["wav"], "audio/aac": ["aac"],
};

function command(tool: "ffprobe" | "ffmpeg", args: string[], maxOutput: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(tool, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0, exceeded = false;
    const timer = setTimeout(() => { exceeded = true; proc.kill("SIGKILL"); }, 20_000);
    proc.stdout.on("data", (part: Buffer) => {
      size += part.length;
      if (size > maxOutput) { exceeded = true; proc.kill("SIGKILL"); }
      else chunks.push(part);
    });
    proc.stderr.resume(); // Never log voice contents, paths or metadata.
    proc.on("error", () => {
      clearTimeout(timer);
      reject(new CreativeError(503, "Pemeriksa audio lokal tidak tersedia; sampel belum disimpan."));
    });
    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || exceeded) reject(new CreativeError(400, "Audio rusak, terlalu panjang, atau pemeriksaannya melewati batas. Coba rekam ulang."));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/** Decode locally, with network protocols disabled. No provider/transcription. */
export async function normalizeVoiceAudio(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > VOICE_MAX_BYTES || !containers[mime]) {
    throw new CreativeError(400, "Gunakan audio yang didukung, maksimal 10 MiB.");
  }
  const dir = await mkdtemp(join(tmpdir(), "solid-voice-"));
  try {
    const input = join(dir, "sample");
    await writeFile(input, bytes, { mode: 0o600 });
    let probe: { format?: { format_name?: string }; streams?: { codec_type?: string }[] };
    try {
      probe = JSON.parse((await command("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-i", input,
        "-show_entries", "format=format_name:stream=codec_type", "-of", "json"], 64_000)).toString());
    } catch (err) {
      if (err instanceof CreativeError) throw err;
      throw new CreativeError(400, "Isi audio tidak dikenali.");
    }
    const formats = (probe.format?.format_name ?? "").split(",");
    if (!containers[mime]!.some(f => formats.includes(f)) ||
      probe.streams?.length !== 1 || probe.streams[0]?.codec_type !== "audio") {
      throw new CreativeError(400, "Jenis file tidak sesuai atau berisi video/stream tambahan. Pilih rekaman audio saja.");
    }
    // Decode one extra second rather than trusting forgeable/missing duration metadata.
    // Raw PCM gives an exact duration even for mobile WebM without container duration.
    const pcm = await command("ffmpeg", ["-v", "error", "-xerror", "-threads", "1",
      "-protocol_whitelist", "file,pipe", "-i", input, "-map", "0:a:0", "-vn", "-t", "61",
      "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"], 62 * 32000);
    const durationMs = pcm.length / 32;
    if (durationMs < VOICE_MIN_SECONDS * 1000 || durationMs > VOICE_MAX_SECONDS * 1000) {
      throw new CreativeError(400, "Durasi sampel harus 5–60 detik. Batas ini untuk penyimpanan, bukan jaminan cukup untuk semua provider.");
    }
    let energy = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
    if (Math.sqrt(energy / (pcm.length / 2)) < 0.0003) {
      throw new CreativeError(400, "Rekaman hening atau terlalu pelan. Rekam suara yang terdengar jelas.");
    }
    // PCM WAV with no original metadata, normalized to mono 16 kHz.
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
    return { bytes: Buffer.concat([header, pcm]), durationMs: Math.round(durationMs) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
