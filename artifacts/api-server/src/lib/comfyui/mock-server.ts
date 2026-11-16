// Small in-memory stand-in for ComfyUI + Cloudflare Access, for tests and local development only.
// It implements just the endpoints the client uses. It is not part of the production bundle.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildWorkflow, type ApiWorkflow, type WorkflowKind } from "./workflow";
import { requirementsOf } from "./preflight";

export type MockOptions = {
  access?: { id: string; secret: string };      // when set, requests without these headers get 403 like Access
  missingClasses?: string[]; missingModels?: string[];
  pollsBeforeDone?: number;                     // /history stays empty for this many calls
  failExecution?: boolean;                      // history reports an execution error
  noOutput?: boolean;                           // completes without an MP4
  mp4?: Buffer;                                 // bytes served by /view
  offline?: boolean;                            // answer 530 like a stopped tunnel
};
export type MockComfy = {
  url: string; close(): Promise<void>; options: MockOptions;
  submitted: { promptId: string; workflow: ApiWorkflow }[]; uploads: string[]; calls: string[];
};

const FAKE_MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(2048, 7)]);

export async function startMockComfy(options: MockOptions = {}): Promise<MockComfy> {
  const submitted: MockComfy["submitted"] = [], uploads: string[] = [], calls: string[] = [], polls = new Map<string, number>();
  const modelsByClass: Record<string, [string, string]> = { UNETLoader: ["unet_name", ""], CLIPLoader: ["clip_name", ""], VAELoader: ["vae_name", ""] };
  const known = new Map<string, Set<string>>(), classes = new Set<string>();
  for (const kind of ["I2V", "FIRST_LAST", "REF2VA"] as WorkflowKind[]) {
    const wf = buildWorkflow({ kind, prompt: "p", seed: 1, width: 480, height: 864, length: 141, filenamePrefix: "video/x", images: kind === "FIRST_LAST" ? ["a", "b"] : ["a"] });
    const req = requirementsOf(wf);
    req.classes.forEach(c => classes.add(c));
    for (const m of req.models) { if (!known.has(m.nodeClass)) known.set(m.nodeClass, new Set()); known.get(m.nodeClass)!.add(m.name); }
  }
  const res = { MockCounter: 0 };
  const server: Server = createServer(async (req, rsp) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      rsp.writeHead(status, body === undefined ? headers : { "content-type": "application/json", ...headers });
      rsp.end(body === undefined ? undefined : JSON.stringify(body));
    };
    calls.push(`${req.method} ${url.pathname}`);
    if (options.offline) return send(530);
    if (options.access && (req.headers["cf-access-client-id"] !== options.access.id || req.headers["cf-access-client-secret"] !== options.access.secret)) {
      return send(403, undefined);
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);

    if (req.method === "GET" && url.pathname === "/system_stats") {
      return send(200, { system: { comfyui_version: "mock-1.0" }, devices: [{ name: "Mock GPU", vram_total: 24e9, vram_free: 20e9 }] });
    }
    if (req.method === "GET" && url.pathname === "/queue") return send(200, { queue_running: [], queue_pending: [] });
    const info = /^\/object_info\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && info) {
      const cls = decodeURIComponent(info[1]!);
      if (!classes.has(cls) || options.missingClasses?.includes(cls)) return send(200, {});
      const spec = modelsByClass[cls];
      const names = [...(known.get(cls) ?? [])].filter(n => !options.missingModels?.includes(n));
      return send(200, { [cls]: { input: { required: spec ? { [spec[0]]: [names] } : {} } } });
    }
    if (req.method === "POST" && url.pathname === "/upload/image") {
      const name = /filename="([^"]+)"/.exec(raw.toString("latin1"))?.[1] ?? "upload.png";
      uploads.push(name);
      return send(200, { name, subfolder: "solid", type: "input" });
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      const body = JSON.parse(raw.toString("utf8")) as { prompt: ApiWorkflow };
      const errors: Record<string, unknown> = {};
      for (const [id, n] of Object.entries(body.prompt)) {
        if (!classes.has(n.class_type) || options.missingClasses?.includes(n.class_type)) errors[id] = { class_type: n.class_type, errors: [{ message: "Node class does not exist" }] };
        else if (n.class_type === "LoadImage" && !uploads.some(u => String(n.inputs.image).endsWith(u))) errors[id] = { class_type: n.class_type, errors: [{ message: "Image not found in input folder" }] };
      }
      if (Object.keys(errors).length) return send(400, { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" }, node_errors: errors });
      const promptId = `mock-prompt-${++res.MockCounter}`;
      submitted.push({ promptId, workflow: body.prompt });
      return send(200, { prompt_id: promptId, number: res.MockCounter, node_errors: {} });
    }
    const hist = /^\/history\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && hist) {
      const id = decodeURIComponent(hist[1]!);
      if (!submitted.some(s => s.promptId === id)) return send(200, {});
      const n = (polls.get(id) ?? 0) + 1; polls.set(id, n);
      if (n <= (options.pollsBeforeDone ?? 0)) return send(200, {});
      if (options.failExecution) {
        return send(200, { [id]: { status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "MiniMaxH3ImageToVideo", exception_type: "RuntimeError", exception_message: "CUDA out of memory" }]] }, outputs: {} } });
      }
      const outputs = options.noOutput ? {} : { "15": { images: [{ filename: `${id}.mp4`, subfolder: "video", type: "output" }], animated: [true] } };
      return send(200, { [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs } });
    }
    if (req.method === "GET" && url.pathname === "/view") {
      const bytes = options.mp4 ?? FAKE_MP4;
      rsp.writeHead(200, { "content-type": "video/mp4", "content-length": String(bytes.length) });
      return void rsp.end(bytes);
    }
    return send(404, { error: "not found" });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, options, submitted, uploads, calls, close: () => new Promise<void>(r => server.close(() => r())) };
}
