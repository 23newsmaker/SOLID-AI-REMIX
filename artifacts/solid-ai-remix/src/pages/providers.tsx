import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import {
  useGetProviderControls, getGetProviderControlsQueryKey, useUpdateProviderControls,
  useGetOperationsSettings, getGetOperationsSettingsQueryKey,
} from '@workspace/api-client-react';
import type { Member } from '@workspace/api-client-react';
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
        Hanya render lokal yang dapat dinyalakan atau dimatikan di sini. Provider AI berbayar belum disetujui dan tidak dapat diaktifkan dari aplikasi.
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
        <p className="mt-4 text-xs text-muted-foreground">Aplikasi ini tidak menyimpan kunci API dan tidak mengaktifkan layanan berbayar. Provider AI tetap nonaktif sampai ada persetujuan di luar aplikasi.</p>
      </Panel>
    </>
  );
}
