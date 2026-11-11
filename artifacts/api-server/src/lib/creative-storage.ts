import { spawn } from "node:child_process";
import sharp from "sharp";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, conceptAttachments } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";
import { CreativeError, limits } from "./creative-policy";
import { logger } from "./logger";

export const creativeStorage = new ObjectStorageService();
export function creativeFile(path: string) {
  if (!/^\/objects\/(uploads|concepts)\/[a-zA-Z0-9._-]+$/.test(path)) throw new Error("Invalid creative object path");
  const full = `${creativeStorage.getPrivateObjectDir()}/${path.slice("/objects/".length)}`;
  const [bucket, ...parts] = full.replace(/^\/+/, "").split("/");
  return objectStorageClient.bucket(bucket!).file(parts.join("/"));
}
export async function boundedMaterial(path: string, expected: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of creativeFile(path).createReadStream()) {
    total += chunk.length;
    if (total > expected || total > limits.maxVideoBytes) throw new CreativeError(400, "Ukuran isi bahan melebihi reservasi.");
    chunks.push(Buffer.from(chunk));
  }
  if (total !== expected) throw new CreativeError(400, "Ukuran isi bahan berbeda dari reservasi.");
  return Buffer.concat(chunks);
}
async function probeMp4(bytes: Buffer) {
  // ffprobe parses containers/codecs locally, never OCR/transcription or media generation.
  // No file paths or network protocols are accepted from the user.
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffprobe", ["-v", "error", "-protocol_whitelist", "pipe", "-i", "pipe:0",
      "-show_entries", "format=format_name:stream=codec_type,codec_name", "-of", "json"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new CreativeError(400, "Pemeriksaan MP4 melewati batas waktu.")); }, 10_000);
    proc.on("error", () => { clearTimeout(timer); reject(new CreativeError(503, "Pemeriksa MP4 lokal tidak tersedia; unggahan video ditolak, bukan dianggap valid.")); });
    proc.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.length > 64_000) proc.kill("SIGKILL");
    });
    proc.stderr.resume(); // Do not log media metadata or user content.
    proc.stdin.on("error", () => {});
    proc.on("close", code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code !== 0 || !String(result.format?.format_name).split(",").includes("mp4") ||
          !result.streams?.some((s: { codec_type: string; codec_name: string }) => s.codec_type === "video" && s.codec_name)) throw new Error();
        resolve();
      } catch { reject(new CreativeError(400, "Isi MP4 tidak valid atau tidak memiliki stream video yang dikenali.")); }
    });
    proc.stdin.end(bytes);
  });
}
export async function validateMaterial(bytes: Buffer, mime: string) {
  if (mime.startsWith("audio/")) {
    if (bytes.length > limits.maxAudioBytes) throw new CreativeError(400, "Rekaman maksimal 5 MiB.");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffprobe", ["-v", "error", "-protocol_whitelist", "pipe", "-i", "pipe:0",
        "-show_entries", "format=format_name:stream=codec_type,codec_name", "-of", "json"], { stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new CreativeError(400, "Pemeriksaan suara melewati batas waktu.")); }, 10_000);
      proc.on("error", () => { clearTimeout(timer); reject(new CreativeError(503, "Pemeriksa suara tidak tersedia.")); });
      proc.stdout.on("data", c => { output += c.toString(); if (output.length > 64_000) proc.kill("SIGKILL"); });
      proc.stderr.resume();
      proc.stdin.on("error", () => {});
      proc.on("close", code => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(output);
          const format = mime === "audio/wav" ? "wav" : mime === "audio/mpeg" ? "mp3" : "";
          if (!format || code !== 0 || !String(data.format?.format_name).split(",").includes(format) ||
            !data.streams?.some((s: { codec_type: string }) => s.codec_type === "audio") ||
            data.streams.some((s: { codec_type: string }) => s.codec_type === "video")) throw new Error();
          resolve();
        } catch { reject(new CreativeError(400, "Isi rekaman harus MP3/WAV valid tanpa video.")); }
      });
      proc.stdin.end(bytes);
    });
    return bytes;
  }
  if (mime === "video/mp4") {
    if (bytes.length < 24 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new CreativeError(400, "Isi file bukan MP4.");
    await probeMp4(bytes);
    return bytes;
  }
  try {
    const image = sharp(bytes, { limitInputPixels: 36_000_000, animated: false });
    const meta = await image.metadata();
    const format = ({ "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[mime];
    if (!format || meta.format !== format || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error();
    // Full decode, metadata stripped; keep original validated type, not just a signature.
    const clean = await image.rotate().toFormat(format as "jpeg" | "png" | "webp").toBuffer();
    if (clean.length > limits.maxImageBytes) throw new Error();
    return clean;
  } catch { throw new CreativeError(400, "Isi gambar tidak valid, animasi, atau melebihi batas piksel/ukuran."); }
}
let cleaning = false;
let orphanPageToken: string | undefined;
async function sweepUntrackedFinals() {
  // Covers an abrupt process exit between object creation and DB commit, which
  // cannot be handled by a catch/finally block. Only this feature's namespace.
  const full = `${creativeStorage.getPrivateObjectDir()}/concepts/`.replace(/^\/+/, "");
  const [bucketName, ...parts] = full.split("/");
  const prefix = parts.join("/");
  const [files, next] = await objectStorageClient.bucket(bucketName!).getFiles({
    prefix, maxResults: 100, autoPaginate: false, ...(orphanPageToken ? { pageToken: orphanPageToken } : {}),
  });
  orphanPageToken = next?.pageToken;
  for (const file of files) {
    const created = Date.parse(file.metadata.timeCreated ?? "");
    if (!Number.isFinite(created) || created > Date.now() - 60 * 60_000) continue;
    const path = `/objects/concepts/${file.name.slice(prefix.length)}`;
    const [ref] = await db.select({ id: conceptAttachments.id }).from(conceptAttachments)
      .where(eq(conceptAttachments.finalPath, path)).limit(1);
    if (!ref) await file.delete({ ignoreNotFound: true });
  }
}
export async function cleanupCreativeObjects() {
  if (cleaning) return;
  cleaning = true;
  try {
    // Delay beyond the PUT expiry. Tombstones prevent a late signed PUT from
    // recreating an object after cleanup and escaping accounting.
    const rows = await db.select().from(conceptAttachments).where(lt(conceptAttachments.expiresAt, new Date(Date.now() - 60_000))).limit(100);
    for (const row of rows) {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.ownerId}, 71015))`);
        const [current] = await tx.select().from(conceptAttachments).where(eq(conceptAttachments.id, row.id)).for("update");
        if (!current || current.expiresAt.getTime() >= Date.now() - 60_000) return;
        if (current.stagingPath) await creativeFile(current.stagingPath).delete({ ignoreNotFound: true });
        if (current.state === "READY") {
          // Remove from cleanup queue while retaining final attachment metadata.
          await tx.update(conceptAttachments).set({ stagingPath: "", expiresAt: new Date("9999-01-01T00:00:00Z") })
            .where(and(eq(conceptAttachments.id, current.id), eq(conceptAttachments.state, "READY")));
        } else {
          if (current.finalPath) await creativeFile(current.finalPath).delete({ ignoreNotFound: true });
          await tx.delete(conceptAttachments).where(eq(conceptAttachments.id, current.id));
        }
      });
    }
    await sweepUntrackedFinals();
  } finally { cleaning = false; }
}
export function startCreativeCleanup() {
  const run = () => cleanupCreativeObjects().catch(() => logger.warn("Creative attachment cleanup will retry; no user content logged"));
  void run();
  const interval = setInterval(run, 5 * 60_000);
  interval.unref();
}
