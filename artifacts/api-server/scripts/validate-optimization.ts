import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { renderHemat, mediaCommand } from "../src/lib/video/renderer";
import { inspectVideo, emptyDiagnostics } from "../src/lib/video/quality";
import { optimizationMetrics } from "../src/lib/video/metrics";
import { prepareText, TextLayoutError } from "../src/lib/video/layout";
import type { VideoJobRow } from "@workspace/db";

const label = process.argv[2] ?? "after";
assert(["before", "after"].includes(label));
const dir = resolve("../../generated-artifacts/phase-e");
await mkdir(dir, { recursive: true });
const image = await sharp(Buffer.from(`<svg width="720" height="1280"><rect width="720" height="1280" fill="#201728"/><circle cx="360" cy="340" r="140" fill="#e5c16b"/><text x="360" y="565" font-size="38" text-anchor="middle" fill="white">DEMO SINTETIS 12345</text></svg>`)).png().toBuffer();
const logo = await sharp(Buffer.from('<svg width="250" height="100"><rect width="250" height="100" fill="#503660"/><text x="125" y="64" font-size="35" fill="white" text-anchor="middle">DEMO 123</text></svg>')).png().toBuffer();
await mediaCommand("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", `${dir}/tone.wav`]);
const audio = await readFile(`${dir}/tone.wav`);
const timings: object[] = [];
for (const motion of ["ZOOM_IN", "PAN_LEFT"] as const) {
  const start = performance.now();
  let inspection: Awaited<ReturnType<typeof inspectVideo>> | undefined;
  await renderHemat({
    duration: 10, character: image, logo, audio, scenes: [],
    chunks: ["Video demonstrasi internal. Ini bukan materi promosi perusahaan.", "Logo angka dan disclaimer perlu diperiksa manusia."],
    cta: "DEMO TEKNIS — BUKAN PROMOSI",
    disclaimer: "DEMO SINTETIS. Angka 12345 hanya data uji. Bukan informasi produk perusahaan.",
    options: { motion, logoPosition: "TOP_RIGHT", logoAttachmentId: "synthetic", cues: [{ start: 0, end: 5 }, { start: 5, end: 10 }] },
  }, async path => {
    await copyFile(path, `${dir}/${label}-${motion}.mp4`);
    inspection = await inspectVideo(path, 10, mediaCommand);
    assert(!inspection.checks.some(q => q.status === "FAIL"));
    await mediaCommand("ffmpeg", ["-v", "error", "-y", "-ss", "2", "-i", path, "-frames:v", "1", `${dir}/${label}-${motion}.png`]);
  });
  timings.push({ motion, elapsedMs: Math.round(performance.now() - start), bytes: inspection!.bytes, checks: inspection!.checks });
}
// Pure aggregation checks: unknowns, zero denominator, stale-effective approvals,
// failures charged, measured-only sampling, and simulation exclusion.
const row = (extra: Partial<VideoJobRow>): VideoJobRow => ({
  simulation: false, status: "COMPLETED", publicationStatus: "APPROVED_FOR_PUBLICATION", attempts: 1, actualCostUsd: 1,
  diagnostics: { ...emptyDiagnostics(), totalMs: 1000, queueMs: 100, renderMs: 500, bytes: 100,
    quality: [{ id: "DECODE", status: "PASS", detail: "synthetic" }] }, ...extra,
} as VideoJobRow);
assert.equal(optimizationMetrics([]).actualPerPublishableUsd, null);
assert.equal(optimizationMetrics([]).failurePercent, null);
assert.equal(optimizationMetrics([row({ actualCostUsd: null })]).actualPerPublishableUsd, null);
assert.equal(optimizationMetrics([row({}), row({ status: "FAILED", publicationStatus: "GENERATED", attempts: 2, actualCostUsd: 2 })]).actualPerPublishableUsd, 3);
assert.equal(optimizationMetrics([row({}), row({ simulation: true, actualCostUsd: 100 })]).actualPerPublishableUsd, 1);
assert.equal(optimizationMetrics([row({ publicationStatus: "REVISION_REQUIRED" })]).approvalPercent, 0);
assert.equal(optimizationMetrics([row({ diagnostics: null })]).averageTotalMs, null);
assert.equal(optimizationMetrics([row({}), row({ diagnostics: null })]).averageTotalMs, 1000);
assert.equal(optimizationMetrics([row({ status: "FAILED", publicationStatus: "GENERATED", attempts: 2 })]).retryPercent, 100);
const layout = await prepareText(["Naskah uji"], "CTA 123 & <456>", "Disclaimer W".repeat(3));
assert(layout.cta && layout.cta.width <= 528 && layout.disclaimer && layout.disclaimer.height <= 80);
await assert.rejects(() => prepareText(["W".repeat(600)], "CTA", "Disclaimer"), TextLayoutError);
const wide = await prepareText(["Uji 1234567890"], "W".repeat(90), "W".repeat(220)).catch(err => {
  assert(err instanceof TextLayoutError); return null;
});
assert(wide === null || (wide.disclaimer!.width <= 528 && wide.cta!.width <= 528));
const wrongMeta = await inspectVideo(`${dir}/${label}-ZOOM_IN.mp4`, 10, async (_command, args) =>
  args.includes("-show_entries") ? JSON.stringify({ streams: [{ codec_type: "video", codec_name: "vp9", width: 100, height: 100 }], format: { duration: "2" } }) : "");
assert(wrongMeta.checks.some(q => q.id === "VIDEO_PROFILE" && q.status === "FAIL"));
assert(wrongMeta.checks.some(q => q.id === "AUDIO_TRACK" && q.status === "FAIL"));
assert(wrongMeta.checks.some(q => q.id === "DURATION" && q.status === "FAIL"));
const decodeFailure = await inspectVideo(`${dir}/${label}-ZOOM_IN.mp4`, 10, async (command, args, signal) => {
  if (command === "ffmpeg") throw new Error("Synthetic decoder failure");
  return mediaCommand(command, args, signal);
});
assert(decodeFailure.checks.some(q => q.id === "DECODE" && q.status === "FAIL"));
if (label === "after") {
  const supportVideo = await readFile(`${dir}/after-PAN_LEFT.mp4`);
  await renderHemat({ duration: 15, character: image, logo, scenes: [{ bytes: image, video: false }, { bytes: supportVideo, video: true }],
    chunks: ["Uji bahan gambar dan video, tanpa narasi."], cta: "DEMO 123", disclaimer: "Bukan konten perusahaan.",
    options: { motion: "ZOOM_OUT", logoPosition: "TOP_LEFT", logoAttachmentId: "synthetic", cues: [{ start: 0, end: 15 }] },
  }, async (path, diagnostics) => {
    assert(!diagnostics.quality.some(q => q.status === "FAIL"));
    assert(diagnostics.quality.some(q => q.id === "NARRATION" && q.status === "WARNING"));
    await copyFile(path, `${dir}/after-multiscene-15s.mp4`);
    await writeFile(`${dir}/multiscene.json`, JSON.stringify(diagnostics, null, 2));
  });
}
await writeFile(`${dir}/${label}.json`, JSON.stringify({ label, fixture: "GEOMETRIC_SYNTHETIC_NOT_AI", timings, aggregationAssertions: 9, layoutAndNegativeQCAssertions: 7 }, null, 2));
console.info(JSON.stringify({ label, timings, aggregationAssertions: "PASS (9)", layoutAndNegativeQCAssertions: "PASS (7; negative QC uses simulated failures)" }));
