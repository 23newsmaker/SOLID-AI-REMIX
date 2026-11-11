import type { OptimizationMetrics, VideoDiagnostics } from "@workspace/api-zod";
import type { VideoJobRow } from "@workspace/db";

export function optimizationMetrics(input: VideoJobRow[]): OptimizationMetrics {
  const rows = input.filter(j => !j.simulation);
  const completed = rows.filter(j => j.status === "COMPLETED");
  const approved = completed.filter(j => j.publicationStatus === "APPROVED_FOR_PUBLICATION");
  const diagnostics = rows.map(j => j.diagnostics as VideoDiagnostics | null).filter((d): d is VideoDiagnostics => !!d);
  const avg = (key: "queueMs" | "renderMs" | "totalMs") => {
    const values = diagnostics.map(d => d[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  };
  const pct = (count: number, denominator: number) => denominator ? count * 100 / denominator : null;
  const known = rows.length > 0 && rows.every(j => j.actualCostUsd !== null);
  const total = known ? rows.reduce((s, j) => s + j.actualCostUsd!, 0) : null;
  return {
    approvalPercent: pct(approved.length, completed.length),
    failurePercent: pct(rows.filter(j => j.status === "FAILED").length, rows.length),
    retryPercent: pct(rows.filter(j => j.attempts > 1).length, rows.length),
    actualPerSuccessfulUsd: total !== null && completed.length ? total / completed.length : null,
    actualPerPublishableUsd: total !== null && approved.length ? total / approved.length : null,
    averageQueueMs: avg("queueMs"), averageRenderMs: avg("renderMs"), averageTotalMs: avg("totalMs"),
    timedJobs: diagnostics.filter(d => d.totalMs !== null).length,
    measuredBytes: diagnostics.reduce((s, d) => s + (d.bytes ?? 0), 0),
    technicalPass: diagnostics.filter(d => d.quality.some(q => q.id === "DECODE" && q.status === "PASS") && !d.quality.some(q => q.status === "FAIL")).length,
    technicalFail: diagnostics.filter(d => d.quality.some(q => q.status === "FAIL")).length,
    untested: rows.filter(j => !(j.diagnostics as VideoDiagnostics | null)?.quality?.length).length,
    characterConsistency: "NOT TESTED — tidak ada provider AI aktif; foto compositor bukan bukti konsistensi AI.",
  };
}
