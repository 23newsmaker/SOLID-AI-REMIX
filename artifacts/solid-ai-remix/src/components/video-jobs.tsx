import { useState } from 'react';
import { Link } from 'wouter';
import { Download, RotateCcw, Trash2, X } from 'lucide-react';
import type { VideoJob } from '@workspace/api-client-react';
import { Pill } from '@/components/brand';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fmtDate } from '@/lib/labels';
import { retentionNotice, actualCost, isActive, isPublishApproved, jobStatusLabel, jobStatusTone, motionLabel, publicationLabel, publicationTone, usd } from '@/lib/video';

export function JobCard({ j, onCancel, onDelete, onNewVersion, pending, canManage = true }: {
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
          {playable && !j.simulation && <Pill tone={publicationTone(j)} data-testid={`status-final-review-${j.id}`}>{publicationLabel(j)}</Pill>}
        </div>
      </div>
      {isActive(j) && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-1/3 animate-pulse rounded-full bg-accent" /></div>}
      {j.error && <p className="mt-2 rounded-xl bg-destructive/8 p-2 text-xs text-destructive" data-testid={`text-job-error-${j.id}`}>{j.error}</p>}
      {playable && j.resultUrl && (
        <video src={j.resultUrl} controls preload="metadata" className="mt-3 aspect-[9/16] max-h-[420px] w-full rounded-2xl bg-sidebar object-contain" data-testid={`video-result-${j.id}`} />
      )}
      <RetentionNotice j={j} />
      {j.deleted && <p className="mt-2 text-xs text-muted-foreground">Hasil sudah dihapus.</p>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Durasi</dt><dd>{j.durationSeconds} dtk · {j.width}x{j.height}</dd></div>
        <div><dt className="text-muted-foreground">Gerak</dt><dd>{motionLabel[j.options.motion]}</dd></div>
        <div><dt className="text-muted-foreground">Percobaan</dt><dd>{j.attempts}</dd></div>
        <div><dt className="text-muted-foreground">Biaya total</dt><dd>{usd(actualCost(j))}</dd><dt className="text-muted-foreground">Provider saja</dt><dd>{usd(j.providerCostUsd)}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {playable && j.publicationUrl && isPublishApproved(j) && <a href={j.publicationUrl} download className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground" data-testid={`link-publication-download-${j.id}`}><Download className="h-3.5 w-3.5" /> Unduh publikasi</a>}
        {playable && j.resultUrl && <a href={`${j.resultUrl}?download=1`} download className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs" data-testid={`link-download-${j.id}`}><Download className="h-3.5 w-3.5" /> {isPublishApproved(j) ? 'Unduh MP4' : 'Unduh MP4 · REVIEW NOT APPROVED'}</a>}
        {playable && !j.simulation && <Link href={`/video-review?job=${j.id}`} className="inline-flex items-center rounded-xl bg-muted px-3 py-1.5 text-xs" data-testid={`link-final-review-${j.id}`}>Review akhir</Link>}
        {canManage && isActive(j) && <button onClick={() => onCancel(j)} disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs disabled:opacity-50" data-testid={`button-cancel-job-${j.id}`}><X className="h-3.5 w-3.5" /> Batalkan</button>}
        {canManage && !isActive(j) && !j.deleted && <button onClick={() => setConfirmDel(true)} disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs disabled:opacity-50" data-testid={`button-delete-result-${j.id}`}><Trash2 className="h-3.5 w-3.5" /> Hapus hasil</button>}
        {j.conceptId && <button onClick={() => onNewVersion(j.conceptId as string)} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 text-xs" data-testid={`button-new-version-${j.id}`}><RotateCcw className="h-3.5 w-3.5" /> Versi baru</button>}
        {j.conceptId && <Link href={`/creative?concept=${j.conceptId}`} className="inline-flex items-center rounded-xl px-3 py-1.5 text-xs underline-offset-2 hover:underline" data-testid={`link-job-concept-${j.id}`}>Kembali ke konsep</Link>}
      </div>
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent className="rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Hapus hasil video?</AlertDialogTitle>
            <AlertDialogDescription>File MP4 akan dihapus permanen dari penyimpanan. Riwayat job tetap tercatat.</AlertDialogDescription>
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

export function RetentionNotice({ j }: { j: VideoJob }) {
  const n = retentionNotice(j);
  if (!n || j.deleted) return null;
  return (
    <p className="mt-2 rounded-xl bg-destructive/8 p-2 text-xs text-destructive" data-testid={`text-retention-notice-${j.id}`}>
      Pemberitahuan retensi sejak {fmtDate(n.at)}{n.version !== null ? ` (kebijakan versi ${n.version})` : ''}: file hasil akan dihapus permanen setelah masa tenggang 24 jam. Unduh salinan bila masih diperlukan.
    </p>
  );
}
