import assert from "node:assert/strict";
import { test } from "node:test";
import { videoPostText } from "./post-text";
import { prepareText } from "./layout";
import { CreateVideoJobBody } from "@workspace/api-zod";

test("shared manual mode omits both overlays without altering saved text", () => {
  const saved = Object.freeze({ cta: "Teks CTA lama", disclaimer: "Disclaimer yang sudah disimpan." });
  assert.deepEqual(videoPostText(saved, "MANUAL_AFTER_DOWNLOAD", true), { cta: "", disclaimer: "" });
  assert.equal(saved.cta, "Teks CTA lama");
  assert.equal(saved.disclaimer, "Disclaimer yang sudah disimpan.");
});
test("a shared manual job accepts an empty disclaimer", () => {
  assert.deepEqual(videoPostText({ cta: "", disclaimer: "" }, "MANUAL_AFTER_DOWNLOAD", true), { cta: "", disclaimer: "" });
});
test("manual text cannot bypass the private workflow's disclaimer requirement", () => {
  assert.throws(() => videoPostText({ cta: "", disclaimer: "" }, "MANUAL_AFTER_DOWNLOAD", false), /studio bersama/);
  for (const shared of [true, false]) {
    assert.throws(() => videoPostText({ cta: "", disclaimer: "" }, undefined, shared), /disclaimer/);
    assert.throws(() => videoPostText({ cta: "", disclaimer: "" }, "IN_VIDEO", shared), /disclaimer/);
  }
});
test("old jobs keep their in-video text when no new mode was saved", () => {
  const saved = { cta: "Hubungi kami", disclaimer: "Ketentuan perusahaan berlaku." };
  assert.deepEqual(videoPostText(saved, undefined, true), saved);
  assert.deepEqual(videoPostText(saved, undefined, false), saved);
});
test("the request contract preserves manual mode and rejects unknown modes", () => {
  const body = { conceptId: "00000000-0000-4000-8000-000000000001", version: 1, mode: "HEMAT",
    requestKey: "00000000-0000-4000-8000-000000000002", confirmed: true,
    options: { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", logoAttachmentId: "fixture-logo",
      cues: [{ start: 0, end: 12 }], postTextMode: "MANUAL_AFTER_DOWNLOAD" } };
  assert.equal(CreateVideoJobBody.parse(body).options.postTextMode, "MANUAL_AFTER_DOWNLOAD");
  assert.equal(CreateVideoJobBody.safeParse({ ...body, options: { ...body.options, postTextMode: "UNKNOWN" } }).success, false);
});
test("the actual compositor layout has subtitle graphics but no CTA/disclaimer graphics in manual mode", async () => {
  const text = videoPostText({ cta: "Old CTA", disclaimer: "Old disclaimer" }, "MANUAL_AFTER_DOWNLOAD", true);
  const layout = await prepareText(["Video uji internal."], text.cta, text.disclaimer);
  assert.equal(layout.cta, null);
  assert.equal(layout.disclaimer, null);
  assert.equal(layout.cues.length, 1);
  assert.ok(layout.cues[0]?.input.length);
});
