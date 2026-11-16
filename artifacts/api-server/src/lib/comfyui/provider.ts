// Provider state for ComfyUI: configuration presence, health, Super-only opt-in, connection test.
// URL and credentials never leave this process: callers only get booleans and short messages.
import { eq } from "drizzle-orm";
import { db, providerSettings, type MemberRecord } from "@workspace/db";
import { UpdateComfyProviderBody } from "@workspace/api-zod";
import { CreativeError } from "../creative-policy";
import { audit } from "../operations/audit";
import { ComfyClient, ComfyError, comfyClient, comfyConfigFromEnv } from "./client";
import { preflight } from "./preflight";
import { buildWorkflow, WORKFLOW_FILES, type WorkflowKind } from "./workflow";

export const COMFY_ID = "comfyui";
export const COMFY_MODEL = "MiniMax H3 (ComfyUI)";

export type ComfyStatus = {
  configured: boolean; online: boolean; comfyVersion: string | null;
  gpus: { name: string; vramTotalMb: number | null; vramFreeMb: number | null }[];
  queueRunning: number | null; queuePending: number | null; checkedAt: string | null;
  error: { code: string; message: string; detail: string[] } | null;
};
const mb = (v: number | null) => (v === null ? null : Math.round(v / 1_048_576));
const toError = (e: unknown) => e instanceof ComfyError
  ? { code: e.code, message: e.message, detail: e.detail ?? [] }
  : { code: "INTERNAL", message: "Kesalahan internal saat memeriksa ComfyUI.", detail: [] };

let cache: { at: number; status: ComfyStatus } | undefined;
const TTL_MS = 15_000;

export async function comfyStatus(force = false, client?: ComfyClient): Promise<ComfyStatus> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.status;
  const base: ComfyStatus = { configured: !!comfyConfigFromEnv(), online: false, comfyVersion: null, gpus: [], queueRunning: null, queuePending: null, checkedAt: new Date().toISOString(), error: null };
  let status = base;
  if (!base.configured) status = { ...base, error: { code: "NOT_CONFIGURED", message: "COMFYUI_URL, CF_ACCESS_CLIENT_ID dan CF_ACCESS_CLIENT_SECRET belum diatur di secret server.", detail: [] } };
  else {
    try {
      // Health must answer quickly even when the tunnel hangs: short timeout, no retries.
      const c = client ?? new ComfyClient(comfyConfigFromEnv()!, { timeoutMs: 8000, retries: 0 });
      const stats = await c.systemStats();
      const q = await c.queue().catch(() => null);
      status = { ...base, online: true, comfyVersion: stats.comfyVersion, queueRunning: q?.running ?? null, queuePending: q?.pending ?? null,
        gpus: stats.devices.map(d => ({ name: d.name, vramTotalMb: mb(d.vramTotal), vramFreeMb: mb(d.vramFree) })) };
    } catch (e) { status = { ...base, error: toError(e) }; }
  }
  cache = { at: Date.now(), status };
  return status;
}
export const resetComfyStatusCache = () => { cache = undefined; };

export async function comfyEnabled(): Promise<{ enabled: boolean; reason: string }> {
  const [row] = await db.select().from(providerSettings).where(eq(providerSettings.id, COMFY_ID));
  return { enabled: row?.enabled ?? false, reason: row?.reason ?? "" };
}
/** Single gate used by the UI config and by job creation. */
export async function comfyAvailability(force = false): Promise<{ available: boolean; reason: string | null; status: ComfyStatus }> {
  const [setting, status] = await Promise.all([comfyEnabled(), comfyStatus(force)]);
  if (!setting.enabled) return { available: false, reason: "Provider ComfyUI belum diaktifkan oleh admin utama.", status };
  if (!status.configured) return { available: false, reason: "ComfyUI belum dikonfigurasi di server.", status };
  if (!status.online) return { available: false, reason: status.error?.message ?? "ComfyUI offline.", status };
  return { available: true, reason: null, status };
}

export async function providerCard() {
  const [setting, status] = await Promise.all([comfyEnabled(), comfyStatus()]);
  return {
    id: COMFY_ID, name: "ComfyUI (AI)", model: COMFY_MODEL, enabled: setting.enabled, simulation: false,
    connection: !status.configured ? "NOT_CONFIGURED" : status.online ? "ONLINE" : status.error?.code === "ACCESS_DENIED" ? "ACCESS_DENIED" : "OFFLINE",
    capabilities: "MP4 dengan suara dari model; foto karakter sebagai frame pertama (I2V), frame pertama+terakhir, atau 1–9 gambar referensi. Lampiran MP4 tidak dipakai. Bukan lip-sync/RVC; identitas wajah wajib ditinjau manusia.",
    price: "Provider USD 0 (GPU milik sendiri); biaya listrik/GPU belum diukur", priceSource: "GPU lokal pemilik lewat Cloudflare Tunnel; tidak ada tagihan API",
    checkedAt: status.checkedAt, reason: setting.reason || (status.error ? status.error.message : ""), comfy: status,
  };
}

export async function saveComfyProvider(body: unknown, me: MemberRecord) {
  if (me.status !== "ACTIVE" || me.role !== "SUPER_ADMIN") throw new CreativeError(403, "Konfigurasi provider hanya admin utama.");
  const input = UpdateComfyProviderBody.parse(body);
  if (input.enabled && !comfyConfigFromEnv()) throw new CreativeError(409, "Atur COMFYUI_URL, CF_ACCESS_CLIENT_ID dan CF_ACCESS_CLIENT_SECRET di secret server sebelum mengaktifkan.");
  await db.transaction(async tx => {
    const before = await comfyEnabled();
    await tx.insert(providerSettings).values({ id: COMFY_ID, enabled: input.enabled, reason: input.reason, updatedBy: me.id })
      .onConflictDoUpdate({ target: providerSettings.id, set: { enabled: input.enabled, reason: input.reason, updatedBy: me.id, updatedAt: new Date() } });
    await audit(me.id, "PROVIDER_COMFYUI_SWITCH", COMFY_ID, { enabled: before.enabled }, { enabled: input.enabled, reason: input.reason }, tx);
  });
  resetComfyStatusCache();
}

export type WorkflowCheck = { kind: WorkflowKind; file: string; ready: boolean; missing: string[] };
export async function testComfy(me: MemberRecord) {
  if (me.status !== "ACTIVE" || me.role !== "SUPER_ADMIN") throw new CreativeError(403, "Tes koneksi hanya untuk admin utama.");
  const status = await comfyStatus(true);
  const workflows: WorkflowCheck[] = [];
  if (status.online) {
    const c = comfyClient();
    for (const kind of Object.keys(WORKFLOW_FILES) as WorkflowKind[]) {
      const wf = buildWorkflow({ kind, prompt: "probe", seed: 1, width: 480, height: 864, length: 141, filenamePrefix: "video/probe",
        images: kind === "FIRST_LAST" ? ["solid/a.png", "solid/b.png"] : ["solid/a.png"] });
      try { await preflight(c, wf); workflows.push({ kind, file: WORKFLOW_FILES[kind], ready: true, missing: [] }); }
      catch (e) {
        const missing = e instanceof ComfyError && e.code === "NODE_MISSING" ? e.detail ?? [] : [e instanceof ComfyError ? e.message : "Pemeriksaan gagal."];
        workflows.push({ kind, file: WORKFLOW_FILES[kind], ready: false, missing });
      }
    }
  } else {
    for (const kind of Object.keys(WORKFLOW_FILES) as WorkflowKind[]) {
      workflows.push({ kind, file: WORKFLOW_FILES[kind], ready: false, missing: ["ComfyUI tidak online; tidak dapat diperiksa."] });
    }
  }
  return { status, workflows };
}
