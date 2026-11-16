// HTTP client for a ComfyUI instance behind Cloudflare Tunnel + Access (service token).
// Secrets and the base URL are read from the environment, never logged, and never
// included in error messages: callers show `ComfyError.message` to users.
import type { ApiWorkflow } from "./workflow";

export type ComfyErrorCode =
  | "NOT_CONFIGURED" | "ACCESS_DENIED" | "OFFLINE" | "TIMEOUT" | "REJECTED" | "NODE_MISSING" | "JOB_FAILED" | "BAD_RESPONSE";
export class ComfyError extends Error {
  constructor(public code: ComfyErrorCode, message: string, public detail?: string[]) { super(message); }
}

export type ComfyConfig = { baseUrl: string; accessId: string; accessSecret: string };
export function comfyConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ComfyConfig | null {
  const baseUrl = env.COMFYUI_URL?.trim().replace(/\/+$/, ""), accessId = env.CF_ACCESS_CLIENT_ID?.trim(), accessSecret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (!baseUrl || !accessId || !accessSecret) return null;
  try {
    const u = new URL(baseUrl);
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null; // credentials only over TLS (or loopback for dev)
  } catch { return null; }
  return { baseUrl, accessId, accessSecret };
}

type FetchLike = typeof fetch;
export type ClientOptions = { fetch?: FetchLike; timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> };
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export type SystemStats = { online: true; comfyVersion: string | null; devices: { name: string; vramTotal: number | null; vramFree: number | null }[] };
export type QueueInfo = { running: number; pending: number };
export type OutputFile = { filename: string; subfolder: string; type: string };
export type HistoryState =
  | { state: "NOT_FOUND" }
  | { state: "FAILED"; reason: string }
  | { state: "COMPLETED"; files: OutputFile[] };

export class ComfyClient {
  private f: FetchLike; private timeout: number; private retries: number; private sleep: (ms: number) => Promise<void>;
  constructor(private cfg: ComfyConfig, opt: ClientOptions = {}) {
    this.f = opt.fetch ?? fetch; this.timeout = opt.timeoutMs ?? 30_000; this.retries = opt.retries ?? 2; this.sleep = opt.sleep ?? wait;
  }
  private headers(extra?: Record<string, string>) {
    return { "CF-Access-Client-Id": this.cfg.accessId, "CF-Access-Client-Secret": this.cfg.accessSecret, Accept: "application/json", ...extra };
  }
  /** One request with a timeout; maps transport and Cloudflare Access failures to ComfyError. */
  private async once(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const ms = init.timeoutMs ?? this.timeout;
    let res: Response;
    try {
      res = await this.f(`${this.cfg.baseUrl}${path}`, { ...init, headers: this.headers(init.headers as Record<string, string>), redirect: "manual", signal: AbortSignal.timeout(ms) });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) throw new ComfyError("TIMEOUT", "ComfyUI tidak merespons dalam batas waktu.");
      throw new ComfyError("OFFLINE", "ComfyUI tidak dapat dijangkau (tunnel atau PC GPU mati).");
    }
    // Cloudflare Access answers a missing/invalid service token with 401/403 or a 3xx to its login page.
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new ComfyError("ACCESS_DENIED", "Ditolak Cloudflare Access: periksa CF_ACCESS_CLIENT_ID/SECRET dan kebijakan Service Token.");
    }
    // 502/503/504 and Cloudflare 52x/530 mean the tunnel or origin is down or too slow.
    if (res.status === 524 || res.status === 504) throw new ComfyError("TIMEOUT", "ComfyUI melewati batas waktu Cloudflare (sekitar 100 detik).");
    if (res.status >= 500) throw new ComfyError("OFFLINE", "ComfyUI offline atau tunnel tidak aktif.");
    return res;
  }
  private async withRetry<T>(fn: () => Promise<T>, retries = this.retries): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); }
      catch (err) {
        const transient = err instanceof ComfyError && (err.code === "OFFLINE" || err.code === "TIMEOUT");
        if (!transient || attempt >= retries) throw err;
        await this.sleep(500 * 3 ** attempt);
      }
    }
  }
  private async json<T>(path: string, init?: RequestInit & { timeoutMs?: number }, retries?: number): Promise<T> {
    return this.withRetry(async () => {
      const res = await this.once(path, init);
      if (res.status === 404) throw new ComfyError("BAD_RESPONSE", "Endpoint ComfyUI tidak ditemukan.");
      if (!res.ok) {
        let reason: string[] = [];
        if (res.status === 400) reason = summarizeRejection(await res.json().catch(() => null));
        throw new ComfyError("REJECTED", `ComfyUI menolak permintaan (${res.status}).`, reason);
      }
      try { return await res.json() as T; } catch { throw new ComfyError("BAD_RESPONSE", "Respons ComfyUI bukan JSON (mungkin halaman login Cloudflare)."); }
    }, retries);
  }

  async systemStats(): Promise<SystemStats> {
    const d = await this.json<any>("/system_stats");
    if (!d || typeof d !== "object" || !Array.isArray(d.devices)) throw new ComfyError("BAD_RESPONSE", "Respons /system_stats tidak dikenali.");
    return { online: true, comfyVersion: typeof d.system?.comfyui_version === "string" ? d.system.comfyui_version : null,
      devices: d.devices.slice(0, 8).map((x: any) => ({ name: String(x.name ?? "GPU").slice(0, 120), vramTotal: Number.isFinite(x.vram_total) ? x.vram_total : null, vramFree: Number.isFinite(x.vram_free) ? x.vram_free : null })) };
  }
  async queue(): Promise<QueueInfo> {
    const d = await this.json<any>("/queue");
    return { running: Array.isArray(d?.queue_running) ? d.queue_running.length : 0, pending: Array.isArray(d?.queue_pending) ? d.queue_pending.length : 0 };
  }
  /** Per-class lookup keeps responses small compared with the full /object_info. */
  async objectInfo(nodeClass: string): Promise<any | null> {
    const d = await this.json<any>(`/object_info/${encodeURIComponent(nodeClass)}`);
    return d && typeof d === "object" && d[nodeClass] ? d[nodeClass] : null;
  }
  async uploadImage(bytes: Uint8Array, filename: string, contentType: string, subfolder = "solid"): Promise<string> {
    const send = async () => {
      const form = new FormData();
      form.set("image", new Blob([bytes as unknown as ConstructorParameters<typeof Blob>[0] extends (infer T)[] | undefined ? T : never], { type: contentType }), filename);
      form.set("subfolder", subfolder); form.set("type", "input"); form.set("overwrite", "true");
      const res = await this.once("/upload/image", { method: "POST", body: form, timeoutMs: 90_000 });
      if (!res.ok) throw new ComfyError("REJECTED", `Upload gambar ditolak (${res.status}).`);
      const d = await res.json().catch(() => null) as { name?: string; subfolder?: string } | null;
      if (!d?.name) throw new ComfyError("BAD_RESPONSE", "Respons upload gambar tidak dikenali.");
      return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
    };
    return this.withRetry(send, 1);
  }
  /** Never retried automatically: a retry after an ambiguous failure could queue a second GPU job. */
  async submit(workflow: ApiWorkflow, clientId: string): Promise<string> {
    const d = await this.json<{ prompt_id?: string; error?: unknown; node_errors?: unknown }>("/prompt",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: clientId }) }, 0);
    if (!d?.prompt_id || d.error) throw new ComfyError("REJECTED", "Workflow ditolak ComfyUI.", summarizeRejection(d));
    return d.prompt_id;
  }
  async history(promptId: string): Promise<HistoryState> {
    const d = await this.json<Record<string, any>>(`/history/${encodeURIComponent(promptId)}`);
    return interpretHistory(d?.[promptId]);
  }
  /** Streams a finished output; the caller pipes it to storage. */
  async view(file: OutputFile, timeoutMs = 10 * 60_000): Promise<{ body: ReadableStream<Uint8Array>; length: number | null }> {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    const res = await this.withRetry(async () => {
      const r = await this.once(`/view?${q}`, { timeoutMs });
      if (!r.ok || !r.body) throw new ComfyError("BAD_RESPONSE", `Hasil tidak dapat diunduh (${r.status}).`);
      return r;
    });
    const len = Number(res.headers.get("content-length"));
    return { body: res.body!, length: Number.isFinite(len) && len > 0 ? len : null };
  }
}

/** Pure: translate a /history entry. Absent entry = still queued or running. */
export function interpretHistory(entry: any): HistoryState {
  if (!entry || typeof entry !== "object") return { state: "NOT_FOUND" };
  const st = entry.status;
  if (st?.status_str === "error") return { state: "FAILED", reason: executionError(st.messages) };
  if (st?.completed) {
    const files: OutputFile[] = [];
    for (const out of Object.values<any>(entry.outputs ?? {})) {
      for (const list of Object.values<any>(out ?? {})) {
        if (!Array.isArray(list)) continue;
        for (const f of list) {
          if (f && typeof f.filename === "string" && /\.mp4$/i.test(f.filename)) {
            files.push({ filename: f.filename, subfolder: typeof f.subfolder === "string" ? f.subfolder : "", type: typeof f.type === "string" ? f.type : "output" });
          }
        }
      }
    }
    return files.length ? { state: "COMPLETED", files } : { state: "FAILED", reason: "Job selesai tetapi tidak menghasilkan MP4." };
  }
  return { state: "NOT_FOUND" };
}
function executionError(messages: unknown): string {
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (Array.isArray(m) && m[0] === "execution_error" && m[1]) {
        const node = [m[1].node_type, m[1].exception_type].filter(Boolean).join(": ");
        const text = String(m[1].exception_message ?? "").split("\n")[0]!.slice(0, 200);
        return `ComfyUI gagal menjalankan workflow${node ? ` (${node})` : ""}${text ? `: ${text}` : "."}`;
      }
    }
  }
  return "ComfyUI melaporkan kegagalan saat menjalankan workflow.";
}
/** Pure: reduce ComfyUI's validation response to short, path-free lines. */
export function summarizeRejection(d: any): string[] {
  const out: string[] = [];
  const top = d?.error;
  if (top && typeof top === "object") out.push([top.type, top.message].filter(Boolean).join(": ").slice(0, 200));
  else if (typeof top === "string") out.push(top.slice(0, 200));
  for (const [id, n] of Object.entries<any>(d?.node_errors ?? {}).slice(0, 8)) {
    const msgs = (n?.errors ?? []).map((e: any) => e?.message).filter(Boolean).slice(0, 2).join("; ");
    out.push(`node ${id} (${n?.class_type ?? "?"}): ${msgs}`.slice(0, 220));
  }
  return out.filter(Boolean);
}

let shared: ComfyClient | null = null;
export function comfyClient(): ComfyClient {
  const cfg = comfyConfigFromEnv();
  if (!cfg) throw new ComfyError("NOT_CONFIGURED", "COMFYUI_URL, CF_ACCESS_CLIENT_ID dan CF_ACCESS_CLIENT_SECRET belum diatur.");
  return shared ??= new ComfyClient(cfg);
}
