import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { VideoRenderOptions } from "@workspace/api-zod";

export type RenderInput = {
  duration: number; character: Buffer; logo: Buffer; options: VideoRenderOptions;
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
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
function lines(text: string, width: number) {
  const result: string[] = [];
  for (const token of text.trim().split(/\s+/)) {
    // Hard-wrap unusually long tokens without changing their characters.
    for (let p = 0; p < token.length; p += width) {
      const word = token.slice(p, p + width);
      if (!result.length || result[result.length - 1]!.length + word.length + 1 > width) result.push(word);
      else result[result.length - 1] += " " + word;
    }
  }
  return result;
}
function svgText(text: string, y: number, fontSize: number, width: number, color = "#fff") {
  return lines(text, width).map((line, i) => `<text x="360" y="${y + i * (fontSize + 7)}" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="${fontSize}" fill="${color}">${xml(line)}</text>`).join("");
}
export async function renderHemat(input: RenderInput, consume: (path: string) => Promise<void>, signal?: AbortSignal) {
  const dir = await mkdtemp(join(tmpdir(), "solid-video-"));
  const common = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1"];
  try {
    const scenes = [{ bytes: input.character, video: false }, ...input.scenes];
    const frames = Math.floor(input.duration * 24 / scenes.length);
    const duration = frames / 24;
    for (const [i, scene] of scenes.entries()) {
      const src = join(dir, `source${i}.${scene.video ? "mp4" : "png"}`);
      if (scene.video) await writeFile(src, scene.bytes);
      else await sharp(scene.bytes).rotate().resize(720, 1280, { fit: "contain", background: "#201728" }).png().toFile(src);
      let vf = "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=0x201728,setsar=1,fps=24";
      if (i === 0) {
        const z = input.options.motion === "ZOOM_OUT" ? `1.06-0.06*on/${frames}` : input.options.motion === "ZOOM_IN" ? `1+0.06*on/${frames}` : "1.06";
        const x = input.options.motion === "PAN_LEFT" ? `(iw-iw/zoom)*(1-on/${frames})` :
          input.options.motion === "PAN_RIGHT" ? `(iw-iw/zoom)*on/${frames}` : "(iw-iw/zoom)/2";
        vf = `zoompan=z='${z}':x='${x}':y='(ih-ih/zoom)/2':d=${frames}:s=720x1280:fps=24`;
      }
      if (scene.video) vf += `,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS`;
      vf += `,fade=t=in:st=0:d=0.18,fade=t=out:st=${duration - 0.18}:d=0.18`;
      await mediaCommand("ffmpeg", [...common, "-protocol_whitelist", "file,pipe",
        ...(scene.video ? [] : ["-loop", "1"]), "-i", src,
        "-vf", vf, "-t", String(duration), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p", join(dir, `scene${i}.mp4`)], signal);
    }
    await writeFile(join(dir, "concat.txt"), scenes.map((_, i) => `file 'scene${i}.mp4'`).join("\n"));
    await mediaCommand("ffmpeg", [...common, "-f", "concat", "-safe", "1", "-i", join(dir, "concat.txt"), "-c", "copy", join(dir, "base.mp4")], signal);
    const graphic = `<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect x="32" y="688" width="656" height="392" rx="22" fill="#201728" fill-opacity=".88"/>${svgText(input.cta, 911, 25, 38, "#ffd46c")}${svgText(input.disclaimer, 995, 17, 62)}</svg>`;
    const logo = await sharp(input.logo).rotate().resize(150, 100, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
    const logoInfo = await sharp(logo).metadata();
    await sharp(Buffer.from(graphic)).composite([{ input: logo, top: 140, left: input.options.logoPosition === "TOP_LEFT" ? 50 : 670 - logoInfo.width! }]).png().toFile(join(dir, "graphic.png"));
    const args = [...common, "-protocol_whitelist", "file,pipe", "-i", join(dir, "base.mp4"), "-loop", "1", "-i", join(dir, "graphic.png")];
    let filter = "[0:v][1:v]overlay=0:0[g0];";
    for (const [i, text] of input.chunks.entries()) {
      const p = join(dir, `cue${i}.png`);
      await sharp(Buffer.from(`<svg width="720" height="200" xmlns="http://www.w3.org/2000/svg">${svgText(text, 40, 27, 40)}</svg>`)).png().toFile(p);
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
    const meta = JSON.parse(await mediaCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", output], signal));
    if (!meta.streams.some((s: { codec_name: string; width: number; height: number }) => s.codec_name === "h264" && s.width === 720 && s.height === 1280) ||
      Number(meta.format.duration) < 9.8 || Number(meta.format.duration) > 15.2 || (await stat(output)).size > 20 * 1024 * 1024) {
      throw new Error("Hasil renderer tidak sesuai profil MP4.");
    }
    await consume(output);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
