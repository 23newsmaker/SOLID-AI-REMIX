// Pre-submit check: every node class and model file a workflow uses must exist on the ComfyUI target.
import { ComfyError, type ComfyClient } from "./client";
import type { ApiWorkflow } from "./workflow";

// Loader node -> the input holding a model filename. Only loaders listed here are
// checked against the server's option list; other string inputs are plain parameters.
const MODEL_INPUTS: Record<string, string[]> = {
  UNETLoader: ["unet_name"], CLIPLoader: ["clip_name"], VAELoader: ["vae_name"],
};

export type Requirements = { classes: string[]; models: { nodeClass: string; input: string; name: string }[] };
export function requirementsOf(wf: ApiWorkflow): Requirements {
  const classes = [...new Set(Object.values(wf).map(n => n.class_type))].sort();
  const models: Requirements["models"] = [];
  for (const n of Object.values(wf)) {
    for (const input of MODEL_INPUTS[n.class_type] ?? []) {
      const name = n.inputs[input];
      if (typeof name === "string" && !models.some(m => m.nodeClass === n.class_type && m.name === name)) models.push({ nodeClass: n.class_type, input, name });
    }
  }
  return { classes, models };
}

/** ComfyUI describes a combo as `[[a, b]]` (classic) or `["COMBO", {options: [a, b]}]` (newer). */
export function comboOptions(spec: unknown): string[] | null {
  if (!Array.isArray(spec)) return null;
  if (Array.isArray(spec[0])) return spec[0].map(String);
  if (spec[0] === "COMBO" && Array.isArray((spec[1] as any)?.options)) return (spec[1] as any).options.map(String);
  return null;
}
export type Missing = { classes: string[]; models: string[] };
/** Pure: infoByClass maps class -> /object_info entry (null when the node does not exist). */
export function findMissing(req: Requirements, infoByClass: Record<string, any | null>): Missing {
  const classes = req.classes.filter(c => !infoByClass[c]);
  const models: string[] = [];
  for (const m of req.models) {
    const info = infoByClass[m.nodeClass];
    if (!info) continue; // class itself is already reported
    const options = comboOptions(info.input?.required?.[m.input] ?? info.input?.optional?.[m.input]);
    if (!options || !options.includes(m.name)) models.push(`${m.name} (${m.nodeClass}.${m.input})`);
  }
  return { classes, models };
}
export const describeMissing = (m: Missing) =>
  [...m.classes.map(c => `node ${c}`), ...m.models.map(x => `model ${x}`)];

export async function preflight(client: ComfyClient, wf: ApiWorkflow): Promise<void> {
  const req = requirementsOf(wf);
  const info: Record<string, any | null> = {};
  const queue = [...req.classes];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) info[c] = await client.objectInfo(c).catch(err => {
      // A missing class may surface as an empty body or 404; transport/Access errors must propagate.
      if (err instanceof ComfyError && (err.code === "BAD_RESPONSE" || err.code === "REJECTED")) return null;
      throw err;
    });
  }));
  const missing = findMissing(req, info), list = describeMissing(missing);
  if (list.length) throw new ComfyError("NODE_MISSING", "ComfyUI tidak memiliki node/model yang dibutuhkan workflow.", list);
}
