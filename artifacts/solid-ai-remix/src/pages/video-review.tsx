import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, Hand, RotateCcw, Send, X } from 'lucide-react';
import {
  useListVideoJobs, getListVideoJobsQueryKey,
  useGetFinalVideoReview, getGetFinalVideoReviewQueryKey, useTransitionFinalVideoReview,
} from '@workspace/api-client-react';
import type { Member, VideoJob, FinalVideoEvidence, FinalVideoReviewInputAction, FinalVideoReviewInputChecklistItem } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg, errStatus, fmtDate } from '@/lib/labels';
import { publicationLabel, publicationTone } from '@/lib/video';
import { Panel, Empty, LIVE, btnPrimary, btnMuted, btnDanger, invalidatePrefixes, isReviewerRole } from '@/components/ops-kit';
import { cn } from '@/lib/utils';
import { RetentionNotice } from '@/components/video-jobs';

const CHECKS: { k: FinalVideoReviewInputChecklistItem; l: string }[] = [
  { k: 'IDENTITY', l: 'Identitas karakter sesuai foto acuan' },
  { k: 'VISUAL', l: 'Visual layak dan tidak menyesatkan' },
  { k: 'LOGO', l: 'Logo benar dan tidak terdistorsi' },
  { k: 'NUMBERS', l: 'Angka sesuai fakta yang disetujui' },
  { k: 'PRODUCT', l: 'Produk dan segmen benar' },
  { k: 'SUBTITLE', l: 'Subtitle akurat dan terbaca' },
  { k: 'AUDIO', l: 'Audio dan narasi sesuai' },
  { k: 'CTA', l: 'CTA sesuai konsep' },
  { k: 'DISCLAIMER', l: 'Disclaimer tampil dan benar' },
  { k: 'CONCEPT', l: 'Sesuai versi konsep yang disetujui' },
];

export default function VideoReviewPage({ me }: { me: Member }) {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const jobId = new URLSearchParams(search).get('job');
  const jobs = useListVideoJobs({ query: { queryKey: getListVideoJobsQueryKey(), ...LIVE } });
  const reviewable = (jobs.data ?? []).filter((j) => j.status === 'COMPLETED' && !j.deleted && !j.simulation);
  const queue = reviewable.filter((j) => j.ownerId !== me.id);
  const mine = reviewable.filter((j) => j.ownerId === me.id);
  const open = (id: string) => setLocation(`/video-review?job=${id}`);

  return (
    <>
      <PageHead eyebrow="Tahap D — review akhir" title="Review video">
        Pemilik mengajukan hasil video. Reviewer lain mengklaim, memeriksa sepuluh butir, lalu menyetujui, menolak, atau meminta revisi. Hanya hasil yang disetujui yang mendapat unduhan publikasi.
      </PageHead>
      {jobId ? <Detail id={jobId} me={me} /> : jobs.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        : jobs.isError ? <ErrorBox message={errMsg(jobs.error)} onRetry={() => jobs.refetch()} /> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Video saya" eyebrow={`${mine.length} hasil`}>
              {!mine.length ? <Empty>Belum ada hasil video selesai milik Anda. <Link href="/videos" className="font-semibold text-primary">Buka halaman Video</Link></Empty> : <JobList jobs={mine} onOpen={open} />}
            </Panel>
            <Panel title={isReviewerRole(me) ? 'Antrean reviewer' : 'Video anggota lain'} eyebrow={`${queue.length} hasil`}>
              {!queue.length ? <Empty>Tidak ada video anggota lain yang dapat dilihat.</Empty> : <JobList jobs={queue} onOpen={open} me={me} />}
            </Panel>
          </div>
        )}
    </>
  );
}

function JobList({ jobs, onOpen, me }: { jobs: VideoJob[]; onOpen: (id: string) => void; me?: Member }) {
  return (
    <ul className="space-y-2">
      {[...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((j) => (
        <li key={j.id}>
          <button onClick={() => onOpen(j.id)} className="w-full rounded-2xl bg-background/60 p-3 text-left ring-1 ring-border/60 transition-transform hover:-translate-y-0.5" data-testid={`row-review-job-${j.id}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{j.title}</span>
              <Pill tone={publicationTone(j)}>{publicationLabel(j)}</Pill>
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground">v{j.conceptVersion} · rev {j.publicationVersion ?? 0} · {fmtDate(j.updatedAt)}{me && j.reviewerId === me.id ? ' · ditugaskan ke Anda' : ''}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Detail({ id, me }: { id: string; me: Member }) {
  const ev = useGetFinalVideoReview(id, { query: { queryKey: getGetFinalVideoReviewQueryKey(id), ...LIVE } });
  return (
    <>
      <Link href="/video-review" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-review"><ArrowLeft className="h-4 w-4" /> Semua video</Link>
      {ev.isLoading ? <Skeleton className="h-[520px] rounded-[28px]" /> : ev.isError ? <ErrorBox message={errMsg(ev.error)} onRetry={() => ev.refetch()} /> : ev.data && <Evidence e={ev.data} me={me} />}
    </>
  );
}

function Evidence({ e, me }: { e: FinalVideoEvidence; me: Member }) {
  const j = e.job;
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useTransitionFinalVideoReview();
  const [note, setNote] = useState('');
  const [checks, setChecks] = useState<FinalVideoReviewInputChecklistItem[]>([]);
  const [conflict, setConflict] = useState(false);
  const status = j.publicationStatus ?? 'GENERATED';
  const owner = j.ownerId === me.id;
  const assigned = !!j.reviewerId && j.reviewerId === me.id;
  const canSubmit = owner && ['GENERATED', 'REJECTED', 'REVISION_REQUIRED'].includes(status);
  const canClaim = isReviewerRole(me) && !owner && status === 'WAITING_FINAL_REVIEW' && !j.reviewerId;
  const canDecide = assigned && !owner && status === 'WAITING_FINAL_REVIEW';
  const allChecked = checks.length === CHECKS.length;

  const act = (action: FinalVideoReviewInputAction) => {
    m.mutate({ id: j.id, data: { version: j.publicationVersion ?? 0, action, note: note.trim(), checklist: action === 'SUBMIT' || action === 'CLAIM' ? [] : checks } }, {
      onSuccess: () => {
        setNote(''); setChecks([]); setConflict(false);
        void invalidatePrefixes(qc, ['/api/video', '/api/operations', '/api/creative']);
        toast({ title: 'Review diperbarui', description: action });
      },
      onError: (err) => {
        if (errStatus(err) === 409) { setConflict(true); void qc.invalidateQueries({ queryKey: getGetFinalVideoReviewQueryKey(j.id) }); }
        toast({ title: errStatus(err) === 409 ? 'Versi review berubah' : 'Gagal', description: errStatus(err) === 409 ? 'Data terbaru sudah dimuat. Periksa ulang sebelum memutuskan.' : errMsg(err), variant: 'destructive' });
      },
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Panel title={j.title} eyebrow={`Konsep v${j.conceptVersion} · revisi publikasi ${j.publicationVersion ?? 0}`} action={<Pill tone={publicationTone(j)} data-testid="status-publication">{publicationLabel(j)}</Pill>}>
          {(e.stale || j.publicationStale) && (
            <div className="mb-4 rounded-2xl bg-destructive/8 p-3 text-sm text-destructive" data-testid="status-review-stale">
              <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Bukti usang</div>
              {e.reasons.length > 0 ? <ul className="mt-1 list-inside list-disc">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p>Data acuan berubah setelah video dibuat.</p>}
            </div>
          )}
          <RetentionNotice j={j} />
          {j.resultUrl ? <video src={j.resultUrl} controls preload="metadata" className="aspect-[9/16] max-h-[520px] w-full rounded-2xl bg-sidebar object-contain" data-testid="video-review" /> : <Empty>File hasil tidak tersedia.</Empty>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {e.conceptUrl && <a href={e.conceptUrl} target="_blank" rel="noreferrer" className={btnMuted} data-testid="link-concept-evidence">Bukti konsep</a>}
            {j.conceptId && <Link href={`/creative?concept=${j.conceptId}`} className={btnMuted} data-testid="link-concept">Buka konsep</Link>}
            {j.publicationUrl && <a href={j.publicationUrl} download className={btnPrimary} data-testid="link-publication-download">Unduh versi publikasi</a>}
          </div>
        </Panel>

        <Panel title="Keputusan" eyebrow={assigned ? 'Anda reviewer yang ditugaskan' : owner ? 'Anda pemilik video' : 'Pengamatan'}>
          {conflict && <p className="mb-3 rounded-xl bg-destructive/8 p-2 text-xs text-destructive">Versi berubah saat Anda memeriksa. Data terbaru sudah dimuat.</p>}
          {canSubmit && (
            <div className="space-y-3">
              <textarea rows={2} maxLength={1500} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Catatan untuk reviewer (opsional)" className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" data-testid="input-submit-note" />
              <button onClick={() => act('SUBMIT')} disabled={m.isPending} className={btnPrimary} data-testid="button-submit-final"><Send className="h-4 w-4" /> Ajukan review akhir</button>
            </div>
          )}
          {canClaim && <button onClick={() => act('CLAIM')} disabled={m.isPending} className={btnPrimary} data-testid="button-claim"><Hand className="h-4 w-4" /> Klaim untuk ditinjau</button>}
          {canDecide && (
            <div className="space-y-3">
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {CHECKS.map((c) => (
                  <li key={c.k}>
                    <label className={cn('flex items-start gap-2 rounded-xl p-2 text-sm ring-1 ring-border/60', checks.includes(c.k) && 'bg-[hsl(170_40%_36%/0.1)]')}>
                      <input type="checkbox" checked={checks.includes(c.k)} onChange={() => setChecks((x) => (x.includes(c.k) ? x.filter((y) => y !== c.k) : [...x, c.k]))} className="mt-1" data-testid={`checkbox-check-${c.k}`} />
                      <span><span className="font-mono text-[10px] text-muted-foreground">{c.k}</span><br />{c.l}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <textarea rows={3} maxLength={1500} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Catatan reviewer (wajib, minimal 10 karakter)" className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" data-testid="input-review-final-note" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => act('APPROVE')} disabled={m.isPending || !allChecked || e.stale || note.trim().length < 10} className={btnPrimary} data-testid="button-approve-final"><Check className="h-4 w-4" /> Setujui ({checks.length}/10)</button>
                <button onClick={() => act('REVISE')} disabled={m.isPending || note.trim().length < 10} className={btnMuted} data-testid="button-revise-final"><RotateCcw className="h-4 w-4" /> Minta revisi</button>
                <button onClick={() => act('REJECT')} disabled={m.isPending || note.trim().length < 10} className={btnDanger} data-testid="button-reject-final"><X className="h-4 w-4" /> Tolak</button>
              </div>
              {e.stale && <p className="text-xs text-destructive">Bukti usang tidak dapat disetujui.</p>}
            </div>
          )}
          {!canSubmit && !canClaim && !canDecide && (
            <p className="text-sm text-muted-foreground" data-testid="text-review-no-action">
              {owner ? 'Menunggu reviewer lain. Anda tidak dapat meninjau video sendiri.' : status === 'WAITING_FINAL_REVIEW' && !j.reviewerId ? 'Hanya Reviewer Kepatuhan atau Super Admin yang dapat mengklaim.' : j.reviewerId && !assigned ? 'Video ini ditugaskan ke reviewer lain.' : 'Tidak ada tindakan untuk Anda pada status ini.'}
            </p>
          )}
        </Panel>
      </div>

      <aside className="space-y-6">
        <Panel title="Foto acuan" eyebrow="Akses terbatas">
          {e.referenceUrl ? <img src={e.referenceUrl} alt="Foto acuan karakter" className="w-full rounded-2xl object-cover" data-testid="img-reference" /> : <Empty>Foto acuan hanya tampil untuk reviewer yang ditugaskan.</Empty>}
        </Panel>
        <Panel title="Riwayat konsep" eyebrow="Baca saja">
          {!e.history.length ? <Empty>Belum ada riwayat versi.</Empty> : (
            <ol className="space-y-2">
              {e.history.map((h) => (
                <li key={`${h.version}-${h.capturedAt}`} className={cn('rounded-xl px-3 py-2 text-xs ring-1 ring-border/60', h.version === j.conceptVersion && 'ring-2 ring-primary')}>
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">v{h.version}</span><Pill>{h.status}</Pill>{h.limited && <Pill tone="sun">Terbatas</Pill>}</div>
                  <div className="mt-1 text-muted-foreground">{fmtDate(h.capturedAt)}</div>
                  <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Bukti</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px]">{h.evidence}</pre></details>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </aside>
    </div>
  );
}
