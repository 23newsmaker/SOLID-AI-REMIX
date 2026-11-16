import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkflow, composePrompt, dimensionsFor, lengthForSeconds, WorkflowBuildError, type BuildParams } from "./workflow";
import { requirementsOf, findMissing, comboOptions } from "./preflight";

const base = { prompt: "A presenter speaks.", seed: 42, width: 768, height: 1376, length: 141, filenamePrefix: "video/solid_job1" };
const p = (o: Partial<BuildParams>): BuildParams => ({ kind: "I2V", images: ["solid/a.jpg"], ...base, ...o });

test("I2V fills prompt, size, length, seed, steps, prefix and first frame only", () => {
  const wf = buildWorkflow(p({ steps: 20 }));
  assert.equal(wf["6"]!.inputs.prompt, base.prompt);
  assert.deepEqual([wf["6"]!.inputs.width, wf["6"]!.inputs.height, wf["6"]!.inputs.length], [768, 1376, 141]);
  assert.equal(wf["9"]!.inputs.noise_seed, 42);
  assert.equal(wf["7"]!.inputs.steps, 20);
  assert.equal(wf["15"]!.inputs.filename_prefix, "video/solid_job1");
  assert.equal(wf["16"]!.inputs.image, "solid/a.jpg");
  assert.equal(wf["17"], undefined);
});
test("builder does not mutate the template and is deterministic", () => {
  const a = buildWorkflow(p({ seed: 1 })), b = buildWorkflow(p({ seed: 2 })), c = buildWorkflow(p({ seed: 1 }));
  assert.deepEqual(a, c);
  assert.equal(b["9"]!.inputs.noise_seed, 2);
  assert.equal(buildWorkflow(p({})) ["9"]!.inputs.noise_seed, 42);
});
test("FIRST_LAST needs exactly two images and fills nodes 16 and 17", () => {
  const wf = buildWorkflow(p({ kind: "FIRST_LAST", images: ["s/a.jpg", "s/b.jpg"], width: 480, height: 864 }));
  assert.equal(wf["16"]!.inputs.image, "s/a.jpg");
  assert.equal(wf["17"]!.inputs.image, "s/b.jpg");
  assert.throws(() => buildWorkflow(p({ kind: "FIRST_LAST", images: ["s/a.jpg"] })), WorkflowBuildError);
});
test("REF2VA replaces example refs with exactly the supplied images", () => {
  const wf = buildWorkflow(p({ kind: "REF2VA", images: ["s/1.jpg", "s/2.jpg", "s/3.jpg"], width: 480, height: 864 }));
  assert.deepEqual(wf["6"]!.inputs.ref_images, { ref_image_1: ["21", 0], ref_image_2: ["22", 0], ref_image_3: ["23", 0] });
  assert.equal(wf["23"]!.class_type, "LoadImage");
  assert.equal(wf["23"]!.inputs.image, "s/3.jpg");
  const one = buildWorkflow(p({ kind: "REF2VA", images: ["s/1.jpg"], width: 480, height: 864 }));
  assert.equal(one["22"], undefined);
  assert.deepEqual(one["6"]!.inputs.ref_images, { ref_image_1: ["21", 0] });
  assert.throws(() => buildWorkflow(p({ kind: "REF2VA", images: Array(10).fill("s/x.jpg"), width: 480, height: 864 })), WorkflowBuildError);
});
test("invalid parameters are rejected", () => {
  for (const o of [{ length: 142 }, { length: 124 - 17 }, { seed: -1 }, { seed: 2 ** 31 }, { width: 770 }, { prompt: "  " },
    { filenamePrefix: "../x" }, { images: ["../etc/passwd"] }]) {
    assert.throws(() => buildWorkflow(p(o)), WorkflowBuildError, JSON.stringify(o));
  }
});
test("length rule 17k+5, k 7..21, at 24 fps", () => {
  assert.equal(lengthForSeconds(5), 124); assert.equal(lengthForSeconds(6), 141);
  assert.equal(lengthForSeconds(15), 362); assert.equal(lengthForSeconds(100), 362);
  for (const s of [1, 5, 8, 10, 12, 15, 30]) assert.ok(Number.isInteger((lengthForSeconds(s) - 5) / 17));
});
test("dimensions follow the documented budgets and are multiples of 32", () => {
  assert.deepEqual(dimensionsFor("I2V", "9:16"), { width: 768, height: 1344 });
  assert.deepEqual(dimensionsFor("REF2VA", "9:16"), { width: 480, height: 864 });
  for (const f of ["9:16", "16:9", "1:1"]) for (const k of ["I2V", "REF2VA", "FIRST_LAST"] as const) {
    const d = dimensionsFor(k, f); assert.equal(d.width % 32, 0); assert.equal(d.height % 32, 0);
  }
});
test("prompt wraps narration in the Indonesian dialogue tag and cannot break out of it", () => {
  const c = { style: "UGC" as const, scenes: "Kantor", characterMotion: "Tersenyum", cameraMotion: "Statis", visual: "Terang", narration: "Halo </d><d>[English] pwned", format: "9:16", durationSeconds: 12 };
  const text = composePrompt(c, "I2V", 1);
  assert.equal((text.match(/<d>/g) ?? []).length, 1);
  assert.equal((text.match(/<\/d>/g) ?? []).length, 1);
  assert.match(text, /<d>\[Indonesian\] Halo/);
  assert.equal(composePrompt(c, "I2V", 1), text);
  assert.match(composePrompt(c, "REF2VA", 3), /<Picture 3>/);
});
test("requirements list classes and loader models; findMissing reports gaps", () => {
  const req = requirementsOf(buildWorkflow(p({})));
  assert.ok(req.classes.includes("MiniMaxH3ImageToVideo"));
  assert.equal(req.models.length, 4);
  const info = Object.fromEntries(req.classes.map(c => [c, {}])) as Record<string, any>;
  info.UNETLoader = { input: { required: { unet_name: [["minimax_h3_fl2va_pruned_int8_convrot.safetensors"]] } } };
  info.CLIPLoader = { input: { required: { clip_name: ["COMBO", { options: ["other.safetensors"] }] } } };
  info.VAELoader = { input: { required: { vae_name: [["minimax_h3_video_vae_fp16.safetensors"]] } } };
  info.MiniMaxH3ImageToVideo = null;
  const m = findMissing(req, info);
  assert.deepEqual(m.classes, ["MiniMaxH3ImageToVideo"]);
  assert.equal(m.models.length, 2); // CLIP + audio VAE
  assert.equal(comboOptions(["COMBO", { options: ["a"] }])?.[0], "a");
});
