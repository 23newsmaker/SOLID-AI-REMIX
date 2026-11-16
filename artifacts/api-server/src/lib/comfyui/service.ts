// Job creation for the ComfyUI AI mode. Reuses the shared eligibility checks, quota, budgets,
// idempotency and audit behaviour of the existing video flow; the Hemat path is untouched.
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, videoJobs, comfyJobs, auditLog, type MemberRecord, type VideoJobRow } from "@workspace/db";
import type { VideoJobInput } from "@workspace/api-zod";
import { ownerLock } from "../creative-service";
import { CreativeError } from "../creative-policy";
import { eligibleAiConcept, quotaDay } from "../video/policy";
import { getSettings, enforceBudgets } from "../operations/controls";
import { STUDIO_REFERENCE_POLICY } from "../studio-references";
import { notifyComfyWork } from "./signals";
import { comfyAvailability, COMFY_ID, COMFY_MODEL } from "./provider";
import { dimensionsFor, lengthForSeconds, WORKFLOW_FILES, type WorkflowKind } from "./workflow";
import { planInputs, seedFor, PlanError, type AiInputs } from "./plan";
export { planInputs, seedFor, type AiInputs } from "./plan";

export async function createAiJob(input: VideoJobInput, me: MemberRecord, studioFolderId?: string): Promise<VideoJobRow> {
  const avail = await comfyAvailability(true);
  if (!avail.available) throw new CreativeError(409, `Render AI tidak tersedia: ${avail.reason}`);
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const kind = (input.options.aiWorkflow ?? "I2V") as WorkflowKind;
  const queued = await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`); // same global video lock as the Hemat flow
    const [old] = await tx.select().from(videoJobs).where(sql`${videoJobs.ownerId} = ${me.id} AND ${videoJobs.requestKey} = ${input.requestKey}`);
    if (old) {
      if (old.requestHash !== requestHash) throw new CreativeError(409, "Kunci permintaan sudah digunakan dengan isi berbeda. Buat versi baru secara sadar.");
      return old;
    }
    const valid = await eligibleAiConcept(input.conceptId, input.version, me, tx, studioFolderId);
    let plan: ReturnType<typeof planInputs>;
    try { plan = planInputs(kind, valid.materials); } catch (e) { throw e instanceof PlanError ? new CreativeError(400, e.message) : e; }
    // Server-owned fields: caller values are discarded, exactly as for Hemat jobs.
    const options = { ...input.options } as Record<string, unknown>;
    for (const k of ["referencePolicy", "studioFolderId", "legacyLogoAttachmentIds", "logoAttachmentId"]) delete options[k];
    options.brandingMode = "NONE";
    if (studioFolderId) { options.referencePolicy = STUDIO_REFERENCE_POLICY; options.studioFolderId = studioFolderId; }
    options.aiWorkflow = kind; options.aiQuality = input.options.aiQuality ?? "FAST";

    const conf = await getSettings(tx);
    // The Hemat renderer switch must not block AI jobs; pause and budgets still apply.
    enforceBudgets({ ...conf, localEnabled: true }, await tx.select().from(videoJobs), me.id, 0, false);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(videoJobs).where(sql`${videoJobs.ownerId} = ${me.id} AND ${videoJobs.quotaDay} = ${quotaDay()} AND ${videoJobs.simulation} = false`);
    if (count!.n >= conf.dailyLimit) throw new CreativeError(409, `Batas ${conf.dailyLimit} pekerjaan/hari tercapai (Asia/Jakarta), termasuk gagal/dibatalkan setelah antre.`);

    const { width, height } = dimensionsFor(kind, valid.data.format);
    const length = lengthForSeconds(valid.data.durationSeconds);
    const seed = seedFor(requestHash);
    const [job] = await tx.insert(videoJobs).values({
      id: randomUUID(), ownerId: me.id, conceptId: valid.row.id, conceptVersion: valid.row.version,
      characterId: valid.character.id, requestKey: input.requestKey, requestHash, title: valid.data.title,
      mode: "AI", provider: COMFY_ID, model: COMFY_MODEL, options: options as VideoJobRow["options"],
      durationSeconds: valid.data.durationSeconds, width, height, quotaDay: quotaDay(),
      // Own GPU: no provider bill. Electricity/GPU wear is unmeasured and stays unknown, not zero.
      costSource: "OWN_GPU_UNMEASURED", costDetails: { renderUsd: null, ttsUsd: 0, retryUsd: 0 },
    }).returning();
    await tx.insert(comfyJobs).values({
      jobId: job!.id, workflowKind: kind, workflowFile: WORKFLOW_FILES[kind], seed, width, height, frameLength: length,
      steps: options.aiQuality === "QUALITY" ? 20 : 12, conceptVersion: valid.row.version,
      inputs: { character: true, attachmentIds: plan.use.map(m => m.id), ignored: plan.ignored } satisfies AiInputs,
    });
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "VIDEO_QUEUED",
      description: `Pekerjaan AI (ComfyUI, ${kind}) ${job!.id} masuk antrean. Foto karakter dan gambar terpilih dikirim ke GPU milik pemilik; biaya listrik belum diukur.` });
    return job!;
  });
  if (queued.status === "QUEUED") notifyComfyWork();
  return queued;
}

export async function comfyInfo(jobId: string, mode: string) {
  if (mode !== "AI") return null;
  const [c] = await db.select().from(comfyJobs).where(eq(comfyJobs.jobId, jobId));
  if (!c) return null;
  return { phase: c.phase, workflowKind: c.workflowKind, workflowFile: c.workflowFile, workflowHash: c.workflowHash, seed: c.seed,
    width: c.width, height: c.height, frameLength: c.frameLength, errorCode: c.errorCode, errorDetail: c.errorDetail ?? [],
    technicalChecks: (c.technicalChecks as Record<string, unknown>[] | null) ?? null, pollCount: c.pollCount };
}
