import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Download, RotateCcw, Trash2, X } from 'lucide-react';
import type { VideoJob } from '@workspace/api-client-react';
import { Pill } from '@/components/brand';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fmtDate } from '@/lib/labels';
import { retentionNotice, actualCost, isActive, isPublishApproved, jobStatusLabel, jobStatusTone, motionLabel, publicationLabel, publicationTone, usd } from '@/lib/video';

export function JobCard({ j, onCancel, onDelete, onNewVersion, pending, canManage = true, sharedMode = false, footer }: {
  sharedMode?: boolean; footer?: ReactNode;
  canManage?: boolean; j: VideoJob; onCancel: (j: VideoJob) => void; onDelete: (j: VideoJob) => void; onNewVersion: (conceptId: string) => void; pending: boolean;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const playable = j.status === 'COMPLETED' && !!j.resultUrl && !j.deleted;
  return (
    <li className="rounded-[24px] bg-card p-4 ring-1 ring-card-border" data-testid={`card-job-${j.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{j.title}</div>
          <div className="font-mono text-[10px] text-muted-foreground">v{j.conceptVersion} · {j.mode === 'HEMAT' ? 'Hemat' : 'AI'} · {j.provider} · {fmtDate(j.createdAt)}</div>
        </div>
        <div className="flex gap-1">
          {j.simulation && <Pill tone="ink">Simulasi</Pill>}
          <Pill tone={jobStatusTone[j.status]} data-testid={`status-job-${j.id}`}>{jobStatusLabel[j.status]}</Pill>
          {playable && !j.simulation && !sharedMode && <Pill tone={publicationTone(j)} data-testid={`status-final-review-${j.id}`}>{publicationLabel(j)}</Pill>}
        </div>
      </div>
      {isActive(j) && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/3 animate-pulse rounded-full bg-accent" /></div>}
      {isActive(j) && j.ai && <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-ai-phase-${j.id}`}>{AI_PHASE[j.ai.phase] ?? j.ai.phase}{j.ai.pollCount > 0 ? ` · cek ke-${j.ai.pollCount}` : ''}. Render AI bisa memakan beberapa menit.</p>}
      {j.ai?.errorDetail && j.ai.errorDetail.length > 0 && <ul className="mt-1 list-disc rounded-xl bg-destructive/8 p-2 pl-6 text-xs text-destructive">{j.ai.errorDetail.map((d) => <li key={d}>{d}</li>)}</ul>}
      {j.error && <p className="mt-2 rounded-xl bg-destructive/8 p-2 text-xs text-destructive" data-testid={`text-job-error-${j.id}`}>{j.error}</p>}
      {playable && j.resultUrl && (
        <video src={j.resultUrl} controls preload="metadata" className="mt-3 aspect-[9/16] max-h-[420px] w-full rounded-2xl bg-sidebar object-contain" data-testid={`video-result-${j.id}`} />
      )}
      <RetentionNotice j={j} />
      {j.deleted && <p className="mt-2 text-xs text-muted-foreground">{j.cleanupPending ? 'Video tidak bisa diakses lagi; pembersihan file di storage belum selesai.' : 'File video sudah dihapus dari storage. Foto karakter dan riwayat pemakaian tetap tersimpan.'}</p>}
      <details open={sharedMode ? undefined : true} className="mt-3">
      <summary className={sharedMode ? 'cursor-pointer text-xs text-muted-foreground' : 'hidden'}>Rincian video dan pemeriksaan teknis</summary>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Durasi</dt><dd>{j.durationSeconds} dtk · {j.width}x{j.height}</dd></div>
        <div><dt className="text-muted-foreground">{j.ai ? 'Workflow' : 'Gerak'}</dt><dd>{j.ai ? `${j.ai.workflowKind} · seed ${j.ai.seed}` : motionLabel[j.options.motion]}</dd></div>
        <div><dt className="text-muted-foreground">Percobaan</dt><dd>{j.attempts}</dd></div>
        <div><dt className="text-muted-foreground">Biaya total</dt><dd>{usd(actualCost(j))}</dd><dt className="text-muted-foreground">Provider saja</dt><dd>{usd(j.providerCostUsd)}</dd></div>
      </dl>
      {j.ai && (
        <details className="mt-3 rounded-xl bg-muted/40 p-3 text-xs" data-testid={`ai-details-${j.id}`}>
          <summary className="cursor-pointer font-semibold">Asal hasil · provider {j.provider} · konsep v{j.conceptVersion}</summary>
          <p className="mt-2">Workflow <span className="font-mono">{j.ai.workflowFile}</span> · {j.ai.width}x{j.ai.height} · {j.ai.frameLength} frame · seed {j.ai.seed}</p>
          {j.ai.workflowHash && <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">sha256 graf workflow: {j.ai.workflowHash}</p>}
          {j.ai.technicalChecks && <ul className="mt-2 space-y-1">{j.ai.technicalChecks.map((q, i) => <li key={i}><strong>{q.ok ? 'LULUS' : 'GAGAL'} {String(q.id)}</strong> · {String(q.detail)}</li>)}</ul>}
          <p className="mt-2 text-muted-foreground">ComfyUI tidak punya quality gate sendiri. Pemeriksaan di atas hanya teknis; identitas wajah, suara, dan klaim wajib dinilai manusia di review akhir.</p>
        </details>
      )}
      {j.diagnostics ? <details className="mt-3 rounded-xl bg-muted/40 p-3 text-xs" data-testid={`diagnostics-${j.id}`}>
        <summary className="cursor-pointer font-semibold">Waktu & pemeriksaan teknis · {j.diagnostics.rendererVersion}</summary>
        <p className="mt-2">Antre {time(j.diagnostics.queueMs)} · Bahan {time(j.diagnostics.materialMs)} · Render {time(j.diagnostics.renderMs)} · QC {time(j.diagnostics.validationMs)} · Simpan {time(j.diagnostics.storageMs)} · Total produksi {time(j.diagnostics.totalMs)} (tanpa antre).</p>
        <p className="mt-1 text-muted-foreground">{j.diagnostics.bytes == null ? 'Ukuran belum terukur' : `${(j.diagnostics.bytes / 1048576).toFixed(2)} MiB`} · Waktu terukur, bukan estimasi pekerjaan berikutnya. Waktu unduh tergantung perangkat/jaringan.</p>
        <ul className="mt-2 space-y-1">{j.diagnostics.quality.map(q => <li key={q.id}><strong>{q.status.replaceAll('_', ' ')}</strong> · {q.detail}</li>)}</ul>
        {!j.diagnostics.quality.length && <p className="mt-2">Pemeriksaan teknis belum selesai / NOT TESTED.</p>}
      </details> : !j.simulation && <p className="mt-2 text-[11px] text-muted-foreground">QC & rincian waktu belum terukur untuk job ini (NOT TESTED). Riwayat lama tidak diisi dengan perkiraan.</p>}
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        {playable && j.publicationUrl && isPublishApproved(j) && <a href={j.publicationUrl} download className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground" data-testid={`link-publication-download-${j.id}`}><Download className="h-3.5 w-3.5" /> Unduh publikasi</a>}
        {playable && j.resultUrl && <a href={`${j.resultUrl}${j.resultUrl.includes('?') ? '&' : '?'}download=1`} download className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs" data-testid={`link-download-${j.id}`}><Download className="h-3.5 w-3.5" /> {sharedMode || isPublishApproved(j) ? 'Unduh MP4' : 'Unduh MP4 · REVIEW NOT APPROVED'}</a>}
        {playable && !j.simulation && !sharedMode && <Link href={`/video-review?job=${j.id}`} className="inline-flex items-center rounded-xl bg-muted px-3 py-1.5 text-xs" data-testid={`link-final-review-${j.id}`}>Review akhir</Link>}
        {canManage && isActive(j) && <button onClick={() => onCancel(j)} disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs disabled:opacity-50" data-testid={`button-cancel-job-${j.id}`}><X className="h-3.5 w-3.5" /> Batalkan</button>}
        {canManage && !isActive(j) && (!j.deleted || j.cleanupPending) && <button onClick={() => setConfirmDel(true)} disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs disabled:opacity-50" data-testid={`button-delete-result-${j.id}`}><Trash2 className="h-3.5 w-3.5" /> {j.cleanupPending ? 'Ulangi penghapusan' : 'Hapus video'}</button>}
        {j.conceptId && <button onClick={() => onNewVersion(j.conceptId as string)} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs" data-testid={`button-new-version-${j.id}`}><RotateCcw className="h-3.5 w-3.5" /> Versi baru</button>}
        {j.conceptId && !sharedMode && <Link href={`/creative?concept=${j.conceptId}`} className="inline-flex items-center rounded-xl px-3 py-1.5 text-xs underline-offset-2 hover:underline" data-testid={`link-job-concept-${j.id}`}>Kembali ke konsep</Link>}
      </div>
      {footer}
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent className="rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Hapus video permanen?</AlertDialogTitle>
            <AlertDialogDescription>File video asli dan hasil akhir akan dihapus permanen dari storage dan tidak dapat dikembalikan. Foto karakter, bahan pendukung, dan riwayat pemakaian tetap tersimpan. Kuota harian tidak dikembalikan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-result">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDelete(j)} className="bg-destructive text-destructive-foreground" data-testid="button-confirm-delete-result">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
const AI_PHASE: Record<string, string> = {
  QUEUED: 'Menunggu giliran', PREFLIGHT: 'Memeriksa node dan model di ComfyUI', UPLOADING: 'Mengunggah gambar ke GPU',
  SUBMITTED: 'Sedang dirender di GPU', DOWNLOADING: 'Mengunduh dan memeriksa hasil',
};
const time = (v: number | null | undefined) => v == null ? 'belum terukur' : `${(v / 1000).toFixed(2)} dtk`;

export function RetentionNotice({ j }: { j: VideoJob }) {
  const n = retentionNotice(j);
  if (!n || j.deleted) return null;
  return (
    <p className="mt-2 rounded-xl bg-destructive/8 p-2 text-xs text-destructive" data-testid={`text-retention-notice-${j.id}`}>
      Pemberitahuan retensi sejak {fmtDate(n.at)}{n.version !== null ? ` (kebijakan versi ${n.version})` : ''}: file hasil akan dihapus permanen setelah masa tenggang 24 jam. Unduh salinan bila masih diperlukan.
    </p>
  );
}
