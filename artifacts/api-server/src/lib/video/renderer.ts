import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { VideoDiagnostics, VideoRenderOptions } from "@workspace/api-zod";
import { emptyDiagnostics, inspectVideo } from "./quality";
import { prepareText } from "./layout";

export type RenderInput = {
  duration: number; character: Buffer; logo?: Buffer; options: VideoRenderOptions;
  scenes: { bytes: Buffer; video: boolean }[]; audio?: Buffer;
  chunks: string[]; cta: string; disclaimer: string;
};
export async function mediaCommand(command: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let output = "", errors = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), 180_000);
    proc.stdout.on("data", c => { output += c.toString(); if (output.length > 256_000) proc.kill("SIGKILL"); });
    proc.stderr.on("data", c => { errors = (errors + c.toString()).slice(-4000); });
    proc.on("error", () => { clearTimeout(timer); reject(new Error("Renderer lokal tidak tersedia atau dibatalkan.")); });
    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        // Avoid logging media paths or any user-provided contents.
        reject(new Error(errors.includes("Unknown encoder") ? "Encoder MP4 tidak tersedia." : "Render media gagal atau melewati batas waktu."));
      } else resolve(output);
    });
  });
}
export async function renderHemat(input: RenderInput, consume: (path: string, diagnostics: VideoDiagnostics) => Promise<void>, signal?: AbortSignal) {
  const dir = await mkdtemp(join(tmpdir(), "solid-video-"));
  const started = Date.now();
  const diagnostics = emptyDiagnostics();
  const common = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1"];
  try {
    if (input.options.brandingMode !== "NONE" && !input.logo) throw new Error("Logo diperlukan untuk pekerjaan dengan profil lama.");
    const text = await prepareText(input.chunks, input.cta, input.disclaimer);
    const scenes = [{ bytes: input.character, video: false }, ...input.scenes];
    const frames = Math.floor(input.duration * 24 / scenes.length);
    const duration = frames / 24;
    let singleFilter = "";
    for (const [i, scene] of scenes.entries()) {
      const src = join(dir, `source${i}.${scene.video ? "mp4" : "png"}`);
      if (scene.video) await writeFile(src, scene.bytes);
      else await sharp(scene.bytes).rotate().resize(i === 0 ? 1440 : 720, i === 0 ? 2560 : 1280, { fit: "contain", background: "#201728" }).png().toFile(src);
      let vf = "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x201728,setsar=1,fps=24";
      if (i === 0) {
        const z = input.options.motion === "ZOOM_OUT" ? `1.06-0.06*on/${frames}` : input.options.motion === "ZOOM_IN" ? `1+0.06*on/${frames}` : "1.06";
        const x = input.options.motion === "PAN_LEFT" ? `(iw-iw/zoom)*(1-on/${frames})` :
          input.options.motion === "PAN_RIGHT" ? `(iw-iw/zoom)*on/${frames}` : "(iw-iw/zoom)/2";
        vf = `zoompan=z='${z}':x='${x}':y='(ih-ih/zoom)/2':d=${frames}:s=720x1280:fps=24`;
      }
      if (scene.video) vf += `,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS`;
      vf += `,fade=t=in:st=0:d=0.18,fade=t=out:st=${duration - 0.18}:d=0.18`;
      // A single still needs no intermediate video encode or concat.
      if (scenes.length === 1) { singleFilter = vf; continue; }
      await mediaCommand("ffmpeg", [...common, "-protocol_whitelist", "file,pipe",
        ...(scene.video ? [] : ["-loop", "1"]), "-i", src,
        "-vf", vf, "-t", String(duration), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p", join(dir, `scene${i}.mp4`)], signal);
    }
    if (scenes.length > 1) {
      await writeFile(join(dir, "concat.txt"), scenes.map((_, i) => `file 'scene${i}.mp4'`).join("\n"));
      await mediaCommand("ffmpeg", [...common, "-f", "concat", "-safe", "1", "-i", join(dir, "concat.txt"), "-c", "copy", join(dir, "base.mp4")], signal);
    }
    // Separate subtitle / CTA / disclaimer blocks; reserve bottom and right
    // for social UI. Platform UI varies, so final human review remains required.
    const graphic = `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect x="48" y="688" width="568" height="392" rx="22" fill="#201728" fill-opacity=".88"/></svg>`;
    const logo = input.options.brandingMode !== "NONE" && input.logo
      ? await sharp(input.logo).rotate().resize(150, 100, { fit: "inside", withoutEnlargement: false }).png().toBuffer()
      : undefined;
    const logoInfo = logo ? await sharp(logo).metadata() : undefined;
    await sharp(Buffer.from(graphic)).composite([
      ...(logo ? [{ input: logo, top: 140, left: input.options.logoPosition === "TOP_LEFT" ? 50 : 616 - logoInfo!.width! }] : []),
      ...(text.cta ? [{ input: text.cta.input, top: 902, left: text.cta.left }] : []),
      ...(text.disclaimer ? [{ input: text.disclaimer.input, top: 991, left: text.disclaimer.left }] : []),
    ]).png().toFile(join(dir, "graphic.png"));
    const args = [...common, "-protocol_whitelist", "file,pipe", ...(singleFilter ? ["-loop", "1"] : []),
      "-i", join(dir, singleFilter ? "source0.png" : "base.mp4"), "-loop", "1", "-i", join(dir, "graphic.png")];
    let filter = singleFilter ? `[0:v]${singleFilter}[scene];[scene][1:v]overlay=0:0[g0];` : "[0:v][1:v]overlay=0:0[g0];";
    for (const [i, cueGraphic] of text.cues.entries()) {
      const p = join(dir, `cue${i}.png`);
      await sharp({ create: { width: 720, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(cueGraphic ? [{ input: cueGraphic.input, top: 6, left: cueGraphic.left }] : []).png().toFile(p);
      args.push("-loop", "1", "-i", p);
      const cue = input.options.cues[i]!;
      filter += `[g${i}][${i + 2}:v]overlay=0:710:enable='gte(t,${cue.start})*lt(t,${cue.end})'[g${i + 1}];`;
    }
    const audioIndex = input.chunks.length + 2;
    if (input.audio) {
      const audioPath = join(dir, "audio");
      await writeFile(audioPath, input.audio);
      args.push("-protocol_whitelist", "file,pipe", "-i", audioPath);
    } else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
    filter += `[${audioIndex}:a]aresample=44100,apad,atrim=0:${input.duration}[a]`;
    const output = join(dir, "final.mp4");
    args.push("-filter_complex", filter, "-map", `[g${input.chunks.length}]`, "-map", "[a]",
      "-t", String(input.duration), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output);
    await mediaCommand("ffmpeg", args, signal);
    diagnostics.renderMs = Date.now() - started;
    const validationStarted = Date.now();
    const qc = await inspectVideo(output, input.duration, mediaCommand, signal);
    diagnostics.validationMs = Date.now() - validationStarted;
    diagnostics.bytes = qc.bytes;
    diagnostics.quality = qc.checks;
    diagnostics.quality.push({ id: "NARRATION", status: input.audio ? "MANUAL_REVIEW_REQUIRED" : "WARNING",
      detail: input.audio ? "Rekaman pengguna dipad/dipotong sesuai durasi. Isi suara dan sinkronisasi cue harus diperiksa manusia." : "Tanpa rekaman pengguna: track audio hening, bukan narasi TTS." });
    if (input.options.cues.some((c, i) => input.chunks[i]!.length / (c.end - c.start) > 20)) diagnostics.quality.push({
      id: "SUBTITLE_PACING", status: "WARNING", detail: "Ada cue lebih dari 20 karakter/detik. Pertimbangkan memperpanjang cue atau ringkas naskah dan review ulang." });
    if (qc.checks.some(c => c.status === "FAIL")) {
      throw new VideoQualityError(diagnostics);
    }
    await consume(output, diagnostics);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export class VideoQualityError extends Error {
  constructor(public readonly diagnostics: VideoDiagnostics) { super("Pemeriksaan teknis video gagal; hasil tidak dinyatakan selesai."); }
}
