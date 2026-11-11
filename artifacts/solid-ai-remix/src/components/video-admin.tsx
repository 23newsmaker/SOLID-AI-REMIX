import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetVideoUsage, useUpdateVideoSettings, getGetVideoUsageQueryKey, getGetVideoConfigQueryKey } from '@workspace/api-client-react';
import { ErrorBox } from '@/components/app-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/labels';
import { usd } from '@/lib/video';

export function VideoAdminPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const usage = useGetVideoUsage();
  const upd = useUpdateVideoSettings();
  const [paused, setPaused] = useState(false);
  const [budget, setBudget] = useState('');
  useEffect(() => {
    if (usage.data) { setPaused(usage.data.paused); setBudget(usage.data.budgetUsd === null ? '' : String(usage.data.budgetUsd)); }
  }, [usage.data]);

  const save = () => {
    const b = budget.trim() === '' ? null : Number(budget);
    if (b !== null && (!Number.isFinite(b) || b < 0 || b > 10000)) { toast({ title: 'Anggaran tidak valid', description: 'Isi 0–10000 USD atau kosongkan bila belum ditetapkan.', variant: 'destructive' }); return; }
    upd.mutate({ data: { paused, budgetUsd: b } }, {
      onSuccess: (u) => {
        qc.setQueryData(getGetVideoUsageQueryKey(), u);
        void qc.invalidateQueries({ queryKey: getGetVideoConfigQueryKey() });
        toast({ title: 'Pengaturan video disimpan' });
      },
      onError: (e) => toast({ title: 'Gagal menyimpan', description: errMsg(e), variant: 'destructive' }),
    });
  };

  return (
    <section className="mt-10 rounded-[28px] bg-card p-5 ring-1 ring-card-border md:p-7" aria-labelledby="h-video-admin">
      <div className="font-mono text-[11px] uppercase tracking-widest text-primary">Admin</div>
      <h2 id="h-video-admin" className="font-display text-2xl font-extrabold">Pemakaian dan pengaturan</h2>
      {usage.isLoading ? <Skeleton className="mt-4 h-40 rounded-2xl" /> : usage.isError ? <div className="mt-4"><ErrorBox message={errMsg(usage.error)} onRetry={() => usage.refetch()} /></div> : usage.data && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat k="Bulan" v={usage.data.month} />
            <Stat k="Biaya provider diketahui" v={usd(usage.data.knownProviderUsd)} />
            <Stat k="Biaya tak diketahui" v={`${usage.data.unknownCosts} job`} />
            <Stat k="Anggaran" v={usage.data.budgetUsd === null ? 'Belum ditetapkan' : `US$${usage.data.budgetUsd}`} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{usage.data.costNote} Total tidak mencakup biaya render/penyimpanan yang tidak tercatat.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} data-testid="checkbox-video-paused" /> Jeda produksi video</label>
            <label className="block text-sm">Anggaran bulanan (USD, kosong = belum ditetapkan)
              <input type="number" min={0} max={10000} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" data-testid="input-video-budget" />
            </label>
            <button onClick={save} disabled={upd.isPending} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-video-settings">{upd.isPending ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
          {usage.data.members.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Belum ada pemakaian bulan ini.</p> : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left font-mono text-[10px] uppercase text-muted-foreground"><th className="py-2">Anggota</th><th>Job</th><th>Gagal</th><th>Ulang</th><th>Biaya diketahui</th><th>Tak diketahui</th></tr></thead>
                <tbody>{usage.data.members.map((m) => (
                  <tr key={m.userId} className="border-t" data-testid={`row-usage-${m.userId}`}><td className="py-2">{m.name}</td><td>{m.jobs}</td><td>{m.failures}</td><td>{m.retries}</td><td>{usd(m.knownProviderUsd)}</td><td>{m.unknownCosts}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rounded-xl bg-muted/60 p-3"><dt className="font-mono text-[10px] uppercase text-muted-foreground">{k}</dt><dd className="text-sm font-semibold">{v}</dd></div>;
}
