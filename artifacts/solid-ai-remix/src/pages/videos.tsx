import { useState } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetVideoConfig, useListVideoJobs, useCancelVideoJob, useDeleteVideoResult, useListCreativeConcepts, useGetCharacter,
  getListVideoJobsQueryKey, getGetVideoConfigQueryKey, getGetVideoJobQueryKey, getGetVideoUsageQueryKey,
} from '@workspace/api-client-react';
import type { Member, VideoJob } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { VideoComposer, Empty } from '@/components/video-composer';
import { JobCard } from '@/components/video-jobs';
import { VideoAdminPanel } from '@/components/video-admin';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/labels';
import { isActive } from '@/lib/video';

export default function VideosPage({ me }: { me: Member }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const isAdmin = me.role === 'ADMIN' || me.role === 'SUPER_ADMIN';
  const canWrite = me.role !== 'VIEWER';
  const [conceptId, setConceptId] = useState(() => new URLSearchParams(search).get('concept') ?? '');

  const jobs = useListVideoJobs({ query: { queryKey: getListVideoJobsQueryKey(), refetchOnWindowFocus: true, refetchInterval: (q) => ((q.state.data ?? []).some(isActive) ? 4000 : 20000) } });
  const anyActive = (jobs.data ?? []).some(isActive);
  const config = useGetVideoConfig({ query: { queryKey: getGetVideoConfigQueryKey(), refetchOnWindowFocus: true, refetchInterval: anyActive ? 4000 : 20000 } });
  const concepts = useListCreativeConcepts({ query: { refetchOnWindowFocus: true, refetchInterval: 20000 } });
  const ch = useGetCharacter();
  const mine = (concepts.data ?? []).filter((c) => c.ownerId === me.id);
  const approved = mine.filter((c) => c.status === 'APPROVED' && !c.stale);

  const cancel = useCancelVideoJob();
  const del = useDeleteVideoResult();
  const after = (id: string) => {
    void qc.invalidateQueries({ queryKey: getListVideoJobsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetVideoJobQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getGetVideoConfigQueryKey() });
    if (isAdmin) void qc.invalidateQueries({ queryKey: getGetVideoUsageQueryKey() });
  };
  const onCancel = (j: VideoJob) => cancel.mutate({ id: j.id }, {
    onSuccess: () => { after(j.id); toast({ title: 'Job dibatalkan' }); },
    onError: (e) => toast({ title: 'Gagal membatalkan', description: errMsg(e), variant: 'destructive' }),
  });
  const onDelete = (j: VideoJob) => del.mutate({ id: j.id }, {
    onSuccess: () => { after(j.id); toast({ title: 'Hasil video dihapus' }); },
    onError: (e) => toast({ title: 'Gagal menghapus', description: errMsg(e), variant: 'destructive' }),
  });
  const onNewVersion = (id: string) => { setConceptId(id); window.scrollTo({ top: 0, behavior: 'smooth' }); toast({ title: 'Konsep dimuat', description: 'Atur ulang opsi lalu konfirmasi lagi.' }); };

  const cfg = config.data;
  return (
    <>
      <PageHead eyebrow="Tahap C — produksi video" title="Video">
        Ubah konsep yang disetujui menjadi video vertikal Mode Hemat dari karakter dan bahan Anda. Naskah tidak diubah oleh sistem.
      </PageHead>

      {config.isLoading ? <Skeleton className="h-16 rounded-2xl" /> : config.isError ? <ErrorBox message={errMsg(config.error)} onRetry={() => config.refetch()} /> : cfg && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-sidebar p-3 text-sm text-sidebar-foreground" data-testid="status-video-config">
          <Pill tone={cfg.paused ? 'hot' : 'ok'}>{cfg.paused ? 'Dijeda' : 'Aktif'}</Pill>
          <Pill tone="muted">AI {cfg.aiEnabled ? 'aktif' : 'nonaktif'}</Pill>
          <span className="font-mono text-xs" data-testid="text-daily-quota">Kuota {cfg.dailyUsed}/{cfg.dailyLimit} · {cfg.timezone}</span>
          <span className="font-mono text-xs text-sidebar-foreground/60">{cfg.provider}</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {!canWrite ? <Empty title="Mode baca saja">Peran Pengamat tidak dapat membuat video.</Empty>
            : concepts.isLoading || config.isLoading || ch.isLoading ? <Skeleton className="h-[480px] rounded-[28px]" />
            : concepts.isError ? <ErrorBox message={errMsg(concepts.error)} onRetry={() => concepts.refetch()} />
            : cfg && (
              <>
                <label className="mb-4 block text-sm font-medium">Konsep disetujui
                  <select value={conceptId} onChange={(e) => setConceptId(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" data-testid="select-video-concept">
                    <option value="">Pilih konsep...</option>
                    {approved.map((c) => <option key={c.id} value={c.id}>{c.title} (v{c.version})</option>)}
                    {conceptId && !approved.some((c) => c.id === conceptId) && <option value={conceptId}>Konsep terpilih (belum siap)</option>}
                  </select>
                </label>
                <VideoComposer conceptId={conceptId} concepts={approved} character={ch.data?.character ?? null} config={cfg} canWrite={canWrite} />
              </>
            )}
        </div>

        <aside aria-labelledby="h-jobs">
          <h2 id="h-jobs" className="font-display text-xl font-bold">Riwayat render</h2>
          {jobs.isLoading ? <div className="mt-3 space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
            : jobs.isError ? <div className="mt-3"><ErrorBox message={errMsg(jobs.error)} onRetry={() => jobs.refetch()} /></div>
            : !jobs.data?.length ? <p className="mt-3 rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada job video.</p>
            : <ul className="mt-3 space-y-3">{[...jobs.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((j) => <JobCard key={j.id} j={j} onCancel={onCancel} onDelete={onDelete} onNewVersion={onNewVersion} pending={!canWrite || cancel.isPending || del.isPending} />)}</ul>}
          {cfg && <p className="mt-3 text-xs text-muted-foreground">{cfg.retentionNote}</p>}
        </aside>
      </div>

      {isAdmin && <VideoAdminPanel />}
    </>
  );
}
