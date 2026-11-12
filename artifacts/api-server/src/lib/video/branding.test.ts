import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { CreateVideoJobBody, type VideoRenderOptions } from "@workspace/api-zod";
import { resolveLogo, legacyLogoIds, sceneMaterials } from "./branding";
import { materialConsentForSave, materialConsentEvidence } from "../studio-policy";
import { renderHemat, mediaCommand } from "./renderer";

const options: VideoRenderOptions = { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", cues: [{ start: 0, end: 10 }], brandingMode: "NONE", postTextMode: "MANUAL_AFTER_DOWNLOAD" };
const logo = { id: "old-logo", contentType: "image/png", finalPath: "/objects/concepts/old-logo" };
const photo = { id: "photo", contentType: "image/jpeg", finalPath: "/objects/concepts/photo" };
test("new shared jobs need no logo but private requests cannot bypass branding", () => {
  assert.equal(resolveLogo(options, true, []), null);
  assert.throws(() => resolveLogo(options, false, []), /studio bersama/);
  assert.throws(() => resolveLogo({ ...options, brandingMode: undefined }, true, []), /logo asli/);
  assert.throws(() => resolveLogo({ ...options, brandingMode: "LOGO" }, false, []), /logo asli/);
  assert.equal(resolveLogo({ ...options, brandingMode: undefined, logoAttachmentId: logo.id }, false, [logo]), logo);
});
test("the generated request contract preserves no-logo mode without a logo ID", () => {
  const body = CreateVideoJobBody.parse({ conceptId: "00000000-0000-4000-8000-000000000001", version: 1, mode: "HEMAT",
    requestKey: "00000000-0000-4000-8000-000000000002", confirmed: true, options });
  assert.equal(body.options.brandingMode, "NONE");
  assert.equal(body.options.logoAttachmentId, undefined);
  assert.throws(() => CreateVideoJobBody.parse({ ...body, options: { ...options, brandingMode: "UNKNOWN" } }));
});
test("only recorded legacy logos still attached to this concept are excluded from new scenes", () => {
  const ids = legacyLogoIds([
    { ...options, brandingMode: undefined, logoAttachmentId: logo.id },
    { ...options, brandingMode: "LOGO", logoAttachmentId: logo.id },
    { ...options, brandingMode: "LOGO", logoAttachmentId: "unrelated-removed-image" },
    { ...options, brandingMode: "NONE", logoAttachmentId: photo.id },
  ], [logo, photo]);
  assert.deepEqual(ids, [logo.id]);
  const stored = JSON.parse(JSON.stringify({ ...options, legacyLogoAttachmentIds: ids })) as VideoRenderOptions;
  assert.deepEqual(sceneMaterials([logo, photo], stored), [photo]);
  assert.deepEqual(sceneMaterials([logo, photo], { ...options, brandingMode: undefined }, logo.id), [photo]);
  assert.deepEqual(sceneMaterials([logo, photo], options), [logo, photo]);
});
test("internal permission is granted only for authenticated studio context, with honest evidence", () => {
  assert.equal(materialConsentForSave(false, "validated-folder"), true);
  assert.equal(materialConsentForSave(false, undefined), false);
  assert.equal(materialConsentForSave(true, undefined), true);
  assert.deepEqual(materialConsentEvidence(true, "validated-folder"), { materialConsent: true, materialConsentBasis: "STUDIO_OWNER_POLICY" });
  assert.equal(materialConsentEvidence(false).materialConsentBasis, "NOT_GRANTED");
  assert.equal(materialConsentEvidence(true).materialConsentBasis, "UPLOADER_CONFIRMATION");
});
test("real 10-second MP4 renders without logo; legacy mode still renders its logo", { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "solid-branding-test-"));
  try {
    const character = await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#1644aa" } }).png().toBuffer();
    const redLogo = await sharp({ create: { width: 150, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
    async function render(brandingMode: "NONE" | "LOGO", includeLogo: boolean) {
      let pixel: Buffer | undefined;
      await renderHemat({ duration: 10, character, logo: includeLogo ? redLogo : undefined,
        options: { ...options, brandingMode, logoAttachmentId: includeLogo ? logo.id : undefined },
        scenes: [], chunks: ["Video uji internal."], cta: "", disclaimer: "" }, async (path, diagnostics) => {
        assert((await readFile(path)).length > 0);
        assert(!diagnostics.quality.some(check => check.status === "FAIL"));
        const sample = join(dir, `${brandingMode}.png`);
        await mediaCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", path, "-frames:v", "1", "-threads", "1", sample]);
        pixel = await sharp(sample).extract({ left: 500, top: 160, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      });
      return pixel!;
    }
    const plain = await render("NONE", false);
    assert(plain[2]! > plain[0]! + 70, "A no-logo MP4 must retain the blue character image at the logo position");
    const branded = await render("LOGO", true);
    assert(branded[0]! > 200 && branded[2]! < 40, "Legacy logo must still be red at its previous position");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
