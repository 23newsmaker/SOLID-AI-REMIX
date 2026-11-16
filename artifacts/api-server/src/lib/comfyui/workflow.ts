// Pure workflow builder for the MiniMax H3 ComfyUI templates.
// No I/O: template + parameters -> API-format workflow JSON. The node ids and
// input names below come from the supplied "Save (API Format)" files and their
// mapping table; nothing here is guessed. See docs/comfyui-integration.md.
import i2v from "./workflows/minimax_h3_i2v.api.json";
import firstLast from "./workflows/minimax_h3_first_last_i2v.api.json";
import ref2va from "./workflows/minimax_h3_ref2va.api.json";

export type WorkflowKind = "I2V" | "FIRST_LAST" | "REF2VA";
export type ApiNode = { class_type: string; inputs: Record<string, unknown> };
export type ApiWorkflow = Record<string, ApiNode>;

export const WORKFLOW_FILES: Record<WorkflowKind, string> = {
  I2V: "minimax_h3_i2v.api.json",
  FIRST_LAST: "minimax_h3_first_last_i2v.api.json",
  REF2VA: "minimax_h3_ref2va.api.json",
};
const TEMPLATES: Record<WorkflowKind, ApiWorkflow> = {
  I2V: i2v as unknown as ApiWorkflow,
  FIRST_LAST: firstLast as unknown as ApiWorkflow,
  REF2VA: ref2va as unknown as ApiWorkflow,
};

// Node ids documented in the mapping table.
export const NODE = { generator: "6", steps: "7", seed: "9", save: "15", firstFrame: "16", lastFrame: "17", refBase: 20 } as const;
export const MAX_REF_IMAGES = 9;
export const MAX_PROMPT_LENGTH = 6000;
export const MAX_SEED = 2_147_483_647;

export type BuildParams = {
  kind: WorkflowKind;
  prompt: string;
  seed: number;
  width: number;
  height: number;
  length: number;
  steps?: 12 | 20;
  /** Names returned by /upload/image ("subfolder/name"), in order. */
  images: string[];
  refImageSize?: "match" | "max";
  filenamePrefix: string;
};

/** MiniMax H3 AV latent needs 17k+5 frames at 24 fps, k = 7..21 (124..362 frames). */
export function lengthForSeconds(seconds: number): number {
  const k = Math.max(7, Math.min(21, Math.round((Math.max(5, seconds) * 24 - 5) / 17)));
  return 17 * k + 5;
}
export const FPS = 24;
export const secondsForLength = (length: number) => length / FPS;

const MULT = 32;
const round32 = (v: number) => Math.max(MULT, Math.round(v / MULT) * MULT);
export const aspectRatio = (format: string) => ({ "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 }[format] ?? 9 / 16);

/** Character shots (I2V) use a 768px short edge capped at 768*1344; others use the ~480*864 budget. */
export function dimensionsFor(kind: WorkflowKind, format: string): { width: number; height: number } {
  const ratio = Math.max(0.25, Math.min(4, aspectRatio(format)));
  if (kind === "I2V") {
    let w = ratio >= 1 ? 768 * ratio : 768, h = ratio >= 1 ? 768 : 768 / ratio;
    const cap = 768 * 1344;
    if (w * h > cap) { const s = Math.sqrt(cap / (w * h)); w *= s; h *= s; }
    return { width: round32(w), height: round32(h) };
  }
  const pixels = 480 * 864;
  const w = Math.max(256, round32(Math.sqrt(pixels * ratio)));
  return { width: w, height: Math.max(256, round32(w / ratio)) };
}

export class WorkflowBuildError extends Error {}
const fail = (msg: string): never => { throw new WorkflowBuildError(msg); };

export function requiredImages(kind: WorkflowKind): { min: number; max: number } {
  return kind === "I2V" ? { min: 1, max: 1 } : kind === "FIRST_LAST" ? { min: 2, max: 2 } : { min: 1, max: MAX_REF_IMAGES };
}

export function buildWorkflow(p: BuildParams): ApiWorkflow {
  const need = requiredImages(p.kind);
  if (p.images.length < need.min || p.images.length > need.max) {
    fail(`Workflow ${p.kind} membutuhkan ${need.min === need.max ? need.min : `${need.min}-${need.max}`} gambar, diberikan ${p.images.length}.`);
  }
  if (p.images.some(n => !/^[\w./ -]{1,200}$/.test(n) || n.includes(".."))) fail("Nama gambar hasil upload tidak valid.");
  if (!p.prompt.trim() || p.prompt.length > MAX_PROMPT_LENGTH) fail("Prompt kosong atau terlalu panjang.");
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > MAX_SEED) fail("Seed harus bilangan bulat 0..2147483647.");
  if (![p.width, p.height].every(v => Number.isInteger(v) && v >= 256 && v <= 2048 && v % MULT === 0)) fail("Lebar/tinggi harus kelipatan 32 dalam 256..2048.");
  const k = (p.length - 5) / 17;
  if (!Number.isInteger(k) || k < 7 || k > 21) fail("Jumlah frame harus 17k+5 dengan k 7..21.");
  if (!/^[\w/-]{1,120}$/.test(p.filenamePrefix) || p.filenamePrefix.includes("..")) fail("Awalan nama file tidak valid.");

  const wf = structuredClone(TEMPLATES[p.kind]);
  const node = (id: string) => wf[id] ?? fail(`Template tidak memiliki node ${id}.`);
  const gen = node(NODE.generator);
  gen.inputs.prompt = p.prompt; gen.inputs.width = p.width; gen.inputs.height = p.height; gen.inputs.length = p.length;
  node(NODE.seed).inputs.noise_seed = p.seed;
  node(NODE.steps).inputs.steps = p.steps ?? 12;
  node(NODE.save).inputs.filename_prefix = p.filenamePrefix;

  if (p.kind === "REF2VA") {
    // Replace the example reference nodes (21, 22) with exactly the supplied images.
    for (const id of Object.keys(wf)) if (Number(id) > NODE.refBase && Number(id) <= NODE.refBase + MAX_REF_IMAGES) delete wf[id];
    const refs: Record<string, [string, number]> = {};
    p.images.forEach((name, i) => {
      const id = String(NODE.refBase + 1 + i);
      wf[id] = { class_type: "LoadImage", inputs: { image: name } };
      refs[`ref_image_${i + 1}`] = [id, 0];
    });
    gen.inputs.ref_images = refs;
    gen.inputs.ref_image_size = p.refImageSize ?? "match";
  } else {
    node(NODE.firstFrame).inputs.image = p.images[0];
    if (p.kind === "FIRST_LAST") node(NODE.lastFrame).inputs.image = p.images[1];
  }
  return wf;
}

/** Stable SHA input: the exact graph that is sent, for audit and reproducibility. */
export const workflowId = (kind: WorkflowKind) => WORKFLOW_FILES[kind];

// ---- Prompt composition (deterministic, pure) -------------------------------

export type PromptConcept = {
  style: "UGC" | "CINEMATIC"; scenes: string; characterMotion: string; cameraMotion: string; visual: string;
  narration: string; format: string; durationSeconds: number;
};
// "<d>" is the dialogue delimiter; user text must not be able to open/close it.
const clean = (s: string) => s.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function composePrompt(c: PromptConcept, kind: WorkflowKind, imageCount: number): string {
  const lines: string[] = [];
  const dialogue = clean(c.narration);
  if (dialogue) {
    lines.push(
      "AUDIO LANGUAGE LOCK - highest priority: The only spoken dialogue in this video is " +
      `<d>[Indonesian] ${clip(dialogue, 1200)}</d>. The speaker is a native Bahasa Indonesia speaker and uses natural ` +
      "everyday Indonesian pronunciation, rhythm and intonation. Do not translate the dialogue, do not use an English accent, " +
      "and do not invent any other speech.", "");
  }
  if (kind === "REF2VA") {
    lines.push("REFERENCE ASSETS: <Picture 1> is the presenter; keep the presenter's face, hair, headwear and clothing exactly as in <Picture 1>." +
      (imageCount > 1 ? ` <Picture 2>${imageCount > 2 ? ` to <Picture ${imageCount}>` : ""} are supplied visual assets; reproduce them faithfully and do not alter their text, logos or numbers.` : ""), "");
  } else if (kind === "FIRST_LAST") {
    lines.push("The video starts on the first supplied image (the presenter) and ends on the second supplied image. Keep the presenter's face, hair, headwear and clothing unchanged.", "");
  } else {
    lines.push("CHARACTER REFERENCE LOCK: the first frame shows the presenter. Do not add, remove or change their accessories, hair, headwear or clothing.", "");
  }
  lines.push("VISUAL AND MOTION INSTRUCTIONS:");
  lines.push(c.style === "UGC" ? "Style: natural, relaxed, professional UGC-style presenter video." : "Style: cinematic lighting with deliberate camera movement.");
  const parts: [string, string][] = [["Scene", c.scenes], ["Presenter motion", c.characterMotion], ["Camera", c.cameraMotion], ["Visual", c.visual]];
  for (const [label, text] of parts) { const t = clean(text); if (t) lines.push(`${label}: ${clip(t, 1200)}`); }
  lines.push(`Format: ${c.format}, about ${Math.round(c.durationSeconds)} seconds.`);
  lines.push("Do not add any on-screen text, numbers, prices, logos or claims that are not present in the supplied images.");
  return clip(lines.join("\n"), MAX_PROMPT_LENGTH);
}
