import { test } from "node:test";
import assert from "node:assert/strict";
import { planInputs, seedFor, technicalChecks } from "./plan";
import { MAX_SEED } from "./workflow";

const img = (id: string, type = "image/png") => ({ id, name: `${id}.png`, contentType: type });
const mp4 = { id: "v", name: "clip.mp4", contentType: "video/mp4" };
const wav = { id: "a", name: "voice.wav", contentType: "audio/wav" };

test("I2V sends only the character photo; attachments are reported as ignored", () => {
  const p = planInputs("I2V", [img("a"), mp4]);
  assert.equal(p.use.length, 0);
  assert.equal(p.ignored.length, 2);
  assert.ok(p.ignored.some(i => /MP4/.test(i.reason)));
});
test("FIRST_LAST needs one image and uses only the first", () => {
  assert.deepEqual(planInputs("FIRST_LAST", [img("a"), img("b")]).use.map(m => m.id), ["a"]);
  assert.throws(() => planInputs("FIRST_LAST", [mp4]), /frame terakhir/);
});
test("REF2VA uses images only, never MP4 or audio, and needs at least one", () => {
  const p = planInputs("REF2VA", [img("a"), img("b"), mp4, wav]);
  assert.deepEqual(p.use.map(m => m.id), ["a", "b"]);
  assert.equal(p.ignored.length, 2);
  assert.throws(() => planInputs("REF2VA", [mp4]), /minimal satu/);
});
test("seed is deterministic per request and within range", () => {
  const h = "ab".repeat(32);
  assert.equal(seedFor(h), seedFor(h));
  assert.notEqual(seedFor(h), seedFor("cd".repeat(32)));
  for (const x of ["00000000", "ffffffff", "7fffffff"]) assert.ok(seedFor(x.padEnd(64, "0")) <= MAX_SEED);
});
test("technical checks require h264 video, an audio track, plausible duration and size", () => {
  const good = { streams: [{ codec_type: "video", codec_name: "h264", width: 768, height: 1344 }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "5.9" } };
  assert.ok(technicalChecks(good, 4_000_000, 5.875).every(c => c.ok));
  const noAudio = { ...good, streams: [good.streams[0]] };
  assert.equal(technicalChecks(noAudio, 4_000_000, 5.875).find(c => c.id === "AUDIO_TRACK")!.ok, false);
  assert.equal(technicalChecks(good, 4_000_000, 15).find(c => c.id === "DURATION")!.ok, false);
  assert.equal(technicalChecks(good, 30 * 1024 * 1024, 5.875).find(c => c.id === "FILE_SIZE")!.ok, false);
  assert.equal(technicalChecks({}, 0, 5).every(c => !c.ok), true);
});
