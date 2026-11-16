import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, Power } from 'lucide-react';
import {
  useGetProviderControls, getGetProviderControlsQueryKey, useUpdateProviderControls,
  useGetOperationsSettings, getGetOperationsSettingsQueryKey, useUpdateComfyProvider, useTestComfyProvider,
} from '@workspace/api-client-react';
import type { ComfyTestResult, Member, ProviderControl } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDate } from '@/lib/labels';
import { NoAccess, Panel, Empty, LIVE, btnPrimary, inputCls, invalidatePrefixes, isSuper } from '@/components/ops-kit';

export default function ProvidersPage({ me }: { me: Member }) {
  if (!isSuper(me)) return <NoAccess eyebrow="Tahap D — provider" title="Provider">Status dan sakelar provider hanya untuk Super Admin.</NoAccess>;
  return <Providers />;
}

function Providers() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const list = useGetProviderControls({ query: { queryKey: getGetProviderControlsQueryKey(), ...LIVE } });
  const settings = useGetOperationsSettings({ query: { queryKey: getGetOperationsSettingsQueryKey(), ...LIVE } });
  const upd = useUpdateProviderControls();
  const [reason, setReason] = useState('');
  const local = settings.data?.localEnabled;
  const valid = reason.trim().length >= 10 && reason.trim().length <= 500;

  const toggle = () => {
    if (local === undefined) return;
    upd.mutate({ data: { localEnabled: !local, reason: reason.trim() } }, {
      onSuccess: (rows) => {
        qc.setQueryData(getGetProviderControlsQueryKey(), rows);
        setReason('');
        void invalidatePrefixes(qc, ['/api/operations', '/api/video', '/api/overview', '/api/app-info']);
        toast({ title: !local ? 'Render lokal diaktifkan' : 'Render lokal dimatikan' });
      },
      onError: (e) => toast({ title: 'Gagal mengubah provider', description: errMsg(e), variant: 'destructive' }),
    });
  };

  return (
    <>
      <PageHead eyebrow="Tahap D — provider" title="Provider">
        Render lokal dan provider ComfyUI (GPU milik tim) dapat dinyalakan atau dimatikan di sini. Provider AI berbayar belum disetujui dan tidak dapat diaktifkan dari aplikasi.
      </PageHead>
      <Panel title="Sakelar render lokal" eyebrow="Super Admin">
        {settings.isLoading ? <Skeleton className="h-24 rounded-2xl" /> : settings.isError ? <ErrorBox message={errMsg(settings.error)} onRetry={() => settings.refetch()} /> : (
          <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start">
            <div className="flex items-center gap-3 rounded-2xl bg-sidebar p-4 text-sidebar-foreground">
              <Power className={local ? 'h-6 w-6 text-sidebar-primary' : 'h-6 w-6 text-sidebar-foreground/40'} />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Status saat ini</div>
                <div className="font-display text-xl font-bold" data-testid="status-local-enabled">{local ? 'Aktif' : 'Mati'}</div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="provider-reason">Alasan perubahan (10–500 karakter, tercatat di audit)</label>
              <textarea id="provider-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} mt-1`} data-testid="input-provider-reason" />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={toggle} disabled={!valid || upd.isPending} className={btnPrimary} data-testid="button-toggle-local">
                  {upd.isPending ? 'Menyimpan...' : local ? 'Matikan render lokal' : 'Aktifkan render lokal'}
                </button>
                <span className="font-mono text-[11px] text-muted-foreground">{reason.trim().length}/10 minimum</span>
              </div>
            </div>
          </div>
        )}
      </Panel>

      <ComfyPanel card={list.data?.find((p) => p.id === 'comfyui')} loading={list.isLoading} />

      <Panel title="Daftar provider" eyebrow="Informasi" className="mt-6">
        {list.isLoading ? <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
          : list.isError ? <ErrorBox message={errMsg(list.error)} onRetry={() => list.refetch()} />
          : !list.data?.length ? <Empty>Server belum melaporkan provider apa pun.</Empty> : (
            <ul className="space-y-3">
              {list.data.map((p) => (
                <li key={p.id} className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/60" data-testid={`row-provider-${p.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{p.model}</span>
                    <span className="flex-1" />
                    {p.simulation && <Pill tone="ink">Simulasi</Pill>}
                    <Pill tone={p.enabled ? 'ok' : 'muted'}>{p.enabled ? 'Aktif' : 'Nonaktif'}</Pill>
                  </div>
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Koneksi</dt><dd>{p.connection}</dd></div>
                    <div><dt className="text-muted-foreground">Kemampuan</dt><dd>{p.capabilities}</dd></div>
                    <div><dt className="text-muted-foreground">Harga</dt><dd>{p.price} <span className="text-muted-foreground">({p.priceSource})</span></dd></div>
                    <div><dt className="text-muted-foreground">Diperiksa</dt><dd>{p.checkedAt ? fmtDate(p.checkedAt) : 'Belum pernah'}</dd></div>
                  </dl>
                  {p.reason && <p className="mt-2 rounded-xl bg-muted p-2 text-xs">{p.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        <p className="mt-4 text-xs text-muted-foreground">Alamat dan kunci ComfyUI hanya ada di secret server dan tidak pernah ditampilkan di sini. Tidak ada layanan berbayar yang diaktifkan.</p>
      </Panel>
    </>
  );
}

const connLabel: Record<string, string> = { ONLINE: 'Online', OFFLINE: 'Offline', NOT_CONFIGURED: 'Belum dikonfigurasi', ACCESS_DENIED: 'Ditolak Cloudflare Access' };
const mbToGb = (v: number | null) => (v === null ? '?' : (v / 1024).toFixed(1));

function ComfyPanel({ card, loading }: { card: ProviderControl | undefined; loading: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const upd = useUpdateComfyProvider();
  const test = useTestComfyProvider();
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<ComfyTestResult | null>(null);
  const valid = reason.trim().length >= 10 && reason.trim().length <= 500;
  if (loading) return <Skeleton className="mt-6 h-40 rounded-2xl" />;
  if (!card) return null;
  const st = result?.status ?? card.comfy ?? null;
  const toggle = () => upd.mutate({ data: { enabled: !card.enabled, reason: reason.trim() } }, {
    onSuccess: (rows) => {
      qc.setQueryData(getGetProviderControlsQueryKey(), rows);
      setReason('');
      void invalidatePrefixes(qc, ['/api/operations', '/api/video']);
      toast({ title: !card.enabled ? 'ComfyUI diaktifkan' : 'ComfyUI dimatikan' });
    },
    onError: (e) => toast({ title: 'Gagal mengubah provider', description: errMsg(e), variant: 'destructive' }),
  });
  const runTest = () => test.mutate(undefined, {
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: getGetProviderControlsQueryKey() }); },
    onError: (e) => toast({ title: 'Tes koneksi gagal', description: errMsg(e), variant: 'destructive' }),
  });
  return (
    <Panel title="ComfyUI (AI)" eyebrow="GPU milik tim · Super Admin" className="mt-6">
      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-start" data-testid="panel-comfyui">
        <div className="flex items-center gap-3 rounded-2xl bg-sidebar p-4 text-sidebar-foreground">
          <Cpu className={st?.online ? 'h-6 w-6 text-sidebar-primary' : 'h-6 w-6 text-sidebar-foreground/40'} />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Koneksi</div>
            <div className="font-display text-xl font-bold" data-testid="status-comfy-connection">{connLabel[card.connection] ?? card.connection}</div>
            <div className="font-mono text-[10px] text-sidebar-foreground/60">{card.enabled ? 'Provider aktif' : 'Provider nonaktif'}</div>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          {st?.error && <p className="rounded-xl bg-destructive/8 p-2 text-xs text-destructive" data-testid="text-comfy-error">{st.error.message}{st.error.detail.length > 0 && ` (${st.error.detail.join('; ')})`}</p>}
          {st?.online && (
            <dl className="grid gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Versi ComfyUI</dt><dd>{st.comfyVersion ?? 'tidak dilaporkan'}</dd></div>
              <div><dt className="text-muted-foreground">Antrean</dt><dd>{st.queueRunning ?? '?'} berjalan · {st.queuePending ?? '?'} menunggu</dd></div>
              <div><dt className="text-muted-foreground">GPU</dt><dd>{st.gpus.length ? st.gpus.map((g) => `${g.name} (${mbToGb(g.vramFreeMb)}/${mbToGb(g.vramTotalMb)} GB bebas)`).join(', ') : 'tidak dilaporkan'}</dd></div>
            </dl>
          )}
          {result && (
            <ul className="space-y-1 text-xs" data-testid="list-comfy-workflows">
              {result.workflows.map((w) => (
                <li key={w.kind} className="rounded-xl bg-muted p-2">
                  <strong>{w.ready ? 'SIAP' : 'BELUM SIAP'}</strong> · {w.file}
                  {w.missing.length > 0 && <ul className="mt-1 list-disc pl-5 text-destructive">{w.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={runTest} disabled={test.isPending} className={btnPrimary} data-testid="button-test-comfy">{test.isPending ? 'Menguji...' : 'Tes koneksi dan workflow'}</button>
            <span className="text-[11px] text-muted-foreground">Memeriksa /system_stats, antrean, dan semua node/model tiap workflow.</span>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="comfy-reason">Alasan perubahan (10–500 karakter, tercatat di audit)</label>
            <textarea id="comfy-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputCls} mt-1`} data-testid="input-comfy-reason" />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button onClick={toggle} disabled={!valid || upd.isPending || (!card.enabled && !(st?.configured ?? false))} className={btnPrimary} data-testid="button-toggle-comfy">
                {upd.isPending ? 'Menyimpan...' : card.enabled ? 'Matikan ComfyUI' : 'Aktifkan ComfyUI'}
              </button>
              <span className="font-mono text-[11px] text-muted-foreground">{reason.trim().length}/10 minimum</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Mengaktifkan berarti foto karakter dan gambar terpilih akan dikirim ke GPU milik tim lewat Cloudflare Tunnel untuk dirender. Hasil tetap melalui review akhir.</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
