import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listVideoJobs, cancelVideoJob, deleteVideoResult, getStudioSelfCheck, saveStudioSelfCheck, type VideoJob } from '@workspace/api-client-react';
import { JobCard } from '@/components/video-jobs';
import { isActive } from '@/lib/video';
import { pollingInterval } from '@/lib/activity-polling';
import { errMsg } from '@/lib/labels';

export function StudioHistory({ folderId, refreshKey, currentVersion, currentConceptId, dirty, onNewVersion }: {
  folderId: string; refreshKey: number; currentVersion: number; currentConceptId: string | null;
  dirty: boolean; onNewVersion: (id: string) => void;
}) {
  const options = { headers: { 'X-Solid-Folder': folderId } };
  const jobs = useQuery({
    queryKey: ['shared', folderId, 'jobs', refreshKey], queryFn: ({ signal }) => listVideoJobs({ ...options, signal }), retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: query => pollingInterval(query.state.data?.some(isActive) ? 4000 : 30000, query.state.data?.some(isActive) ?? false),
  });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [showDeleted, setShowDeleted] = useState(false), [visibleCount, setVisibleCount] = useState(10);
  const visibleJobs = (jobs.data ?? []).filter(job => !job.deleted || job.cleanupPending || showDeleted);
  async function action(job: VideoJob, remove: boolean) {
    if (pending) return;
    if (!remove && !window.confirm('Batalkan proses video ini? Kuota harian tetap terpakai.')) return;
    setPending(true); setError('');
    try { if (remove) await deleteVideoResult(job.id, options); else await cancelVideoJob(job.id, options); }
    catch (e) { setError(errMsg(e)); }
    finally { await jobs.refetch(); setPending(false); }
  }
  return <section className="ss-form-section" aria-labelledby="studio-results">
    <div className="ss-step-head"><span className="ss-step-num">4</span><h2 id="studio-results">Hasil & riwayat folder</h2></div>
    {error && <p className="ss-alert" role="alert">{error}</p>}
    {jobs.isLoading ? <p role="status">Memuat video...</p> : jobs.isError ? <p role="alert">{errMsg(jobs.error)}</p>
      : !visibleJobs.length ? <p className="ss-helper">Belum ada file video aktif di folder ini. Video baru muncul di sini setelah dikonfirmasi.</p>
      : <ul className="space-y-4">{visibleJobs.slice(0, visibleCount).map(job => <JobCard key={job.id} j={job} sharedMode
        pending={pending} onDelete={j => void action(j, true)} onCancel={j => void action(j, false)}
        onNewVersion={onNewVersion}
        footer={job.status === 'COMPLETED' && !job.deleted && !job.simulation ? <SelfCheck folderId={folderId} job={job}
          dirty={job.conceptId === currentConceptId && (dirty || currentVersion !== job.conceptVersion)}
          revision={currentVersion} /> : undefined} />)}</ul>}
    {visibleJobs.length > visibleCount && <button className="ss-btn outline small" onClick={() => setVisibleCount(n => n + 10)}>Tampilkan 10 lainnya</button>}
    {jobs.data?.some(job => job.deleted && !job.cleanupPending) && <label className="ss-check-row"><input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} />Tampilkan riwayat video yang file-nya sudah dihapus</label>}
  </section>;
}

function SelfCheck({ folderId, job, dirty, revision }: { folderId: string; job: VideoJob; dirty: boolean; revision: number }) {
  const status = useQuery({
    queryKey: ['shared', folderId, job.id, 'self-check', revision], queryFn: () => getStudioSelfCheck(folderId, job.id),
    enabled: !dirty, retry: false, refetchOnWindowFocus: true,
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function check() {
    if (busy || dirty) return;
    const manualText = job.options.postTextMode === 'MANUAL_AFTER_DOWNLOAD';
    const visualChecks = job.options.brandingMode === 'NONE' ? 'wajah, angka/fakta, subtitle dan suara' : 'wajah, logo, angka/fakta, subtitle dan suara';
    if (!window.confirm(manualText
      ? `Sudah memeriksa ${visualChecks}? Caption, CTA dan disclaimer perlu dilengkapi manual sebelum posting. Ini pemeriksaan pembuat, bukan persetujuan DR atau perusahaan.`
      : `Sudah memeriksa ${visualChecks}, CTA dan disclaimer? Ini pemeriksaan pembuat, bukan persetujuan DR atau perusahaan.`)) return;
    setBusy(true); setError('');
    try { await saveStudioSelfCheck(folderId, job.id, { confirmed: true, conceptVersion: job.conceptVersion }); await status.refetch(); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }
  const checked = !dirty && status.data?.checked;
  return <div className="mt-4 border-t pt-3 text-xs">
    <strong>{checked ? 'Sudah saya periksa' : dirty || status.data?.stale ? 'Input berubah — hasil ini perlu dibuat/diperiksa ulang' : 'Belum diperiksa pembuat'}</strong>
    <p className="mt-1 text-muted-foreground">Periksa sebelum dipakai. Bukan persetujuan DR/perusahaan atau bukti identitas pemeriksa.</p>
    {!checked && <button className="ss-btn small" style={{ marginTop: 8 }} onClick={() => void check()} disabled={busy || dirty || status.isLoading} data-testid={`button-self-check-${job.id}`}>{busy ? 'Menyimpan...' : 'Sudah saya periksa'}</button>}
    {(error || status.isError) && <p role="alert" className="mt-2 text-destructive">{error || errMsg(status.error)}</p>}
  </div>;
}
