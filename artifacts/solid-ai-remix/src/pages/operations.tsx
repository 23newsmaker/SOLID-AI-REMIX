import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk } from '@clerk/react';
import { AlertTriangle, Download, RotateCcw, Users, Plug, ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import {
  useGetOperationsReport, getGetOperationsReportQueryKey, exportOperationsReport,
  useGetOperationsSettings, getGetOperationsSettingsQueryKey, useUpdateOperationsSettings,
  useGetRetentionPreview, getGetRetentionPreviewQueryKey, useApproveRetentionPolicy,
  useGetOperationsAudit, getGetOperationsAuditQueryKey,
} from '@workspace/api-client-react';
import type { Member, OperationsGroup, OperationsSettings, OperationsSettingsInput, GetOperationsReportParams } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg, errStatus, fmtDate } from '@/lib/labels';
import { usd } from '@/lib/video';
import { NoAccess, Panel, Empty, Label, Stat, LIVE, btnPrimary, btnMuted, btnDanger, inputCls, invalidatePrefixes, isAdminRole, isSuper } from '@/components/ops-kit';

export default function OperationsPage({ me }: { me: Member }) {
  const clerk = useClerk();
  if (!isAdminRole(me)) return <NoAccess eyebrow="Tahap D — operasional" title="Operasional">Laporan, pengaturan, audit, dan retensi hanya untuk Admin dan Super Admin.</NoAccess>;
  const owner = isSuper(me);
  return (
    <>
      <PageHead eyebrow={owner ? 'Kendali pemilik' : 'Tahap D — operasional'} title={owner ? 'Dashboard Super Admin' : 'Operasional'}>
        Laporan pemakaian, batas harian, anggaran, audit, dan kebijakan retensi. Biaya yang tidak diketahui tetap ditandai tidak diketahui, tidak dianggap nol.
      </PageHead>
      {owner && (
        <nav aria-label="Kendali Super Admin" className="mb-6 grid gap-3 sm:grid-cols-2" data-testid="nav-owner-controls">
          <OwnerLink href="/team" icon={Users} title="Kelola tim" desc="Aktifkan anggota, atur peran dan status." testid="link-owner-team" />
          <OwnerLink href="/providers" icon={Plug} title="Kelola provider" desc="Nyalakan atau matikan renderer dengan alasan tercatat." testid="link-owner-providers" />
        </nav>
      )}
      {owner && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-card-border">
          <button type="button" onClick={() => clerk.openUserProfile()} className={btnMuted} data-testid="button-owner-account">Akun & password saya</button>
          <p className="max-w-xl text-xs text-muted-foreground">Atur akun masuk Anda sendiri melalui pengaturan keamanan. Jika tersedia, tambahkan atau ubah password di sana; jangan bagikan password kepada tim atau melalui chat.</p>
        </div>
      )}
      <div className="space-y-6">
        <Report />
        <SettingsForm />
        <Retention me={me} />
        <Audit />
      </div>
    </>
  );
}

function OwnerLink({ href, icon: Icon, title, desc, testid }: { href: string; icon: typeof Users; title: string; desc: string; testid: string }) {
  return (
    <Link href={href} data-testid={testid} className="group flex items-center gap-4 rounded-2xl bg-sidebar p-4 text-sidebar-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-sidebar-primary">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="font-display block text-lg font-bold">{title}</span>
        <span className="block text-xs text-sidebar-foreground/70">{desc}</span>
      </span>
      <ArrowUpRight className="h-5 w-5 shrink-0 text-sidebar-primary transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
    </Link>
  );
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const monthStart = () => today().slice(0, 8) + '01';

function Report() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState('');
  const [mode, setMode] = useState<'' | 'HEMAT' | 'AI'>('');
  const [provider, setProvider] = useState('');
  const params = useMemo<GetOperationsReportParams>(() => ({ from: from || undefined, to: to || undefined, userId: userId || undefined, mode: mode || undefined, provider: provider || undefined }), [from, to, userId, mode, provider]);
  const report = useGetOperationsReport(params, { query: { queryKey: getGetOperationsReportQueryKey(params), ...LIVE } });
  const r = report.data;
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const res = (await exportOperationsReport(params, { responseType: 'blob' })) as unknown as Blob | string;
      const blob = res instanceof Blob ? res : new Blob([String(res)], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `operasional-${from || 'awal'}-${to || 'akhir'}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast({ title: 'Gagal mengunduh CSV', description: errMsg(e), variant: 'destructive' });
    } finally { setExporting(false); }
  };

  return (
    <Panel title="Laporan" eyebrow="Pemakaian & biaya" action={
      <button onClick={() => void doExport()} disabled={exporting} className={btnMuted} data-testid="button-export-csv"><Download className="h-4 w-4" /> {exporting ? 'Mengunduh...' : 'Unduh CSV'}</button>
    }>
      <div className="grid gap-3 sm:grid-cols-3">
        <Label label="Dari"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} data-testid="input-report-from" /></Label>
        <Label label="Sampai"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} data-testid="input-report-to" /></Label>
        <Label label="Anggota">
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls} data-testid="select-report-user">
            <option value="">Semua anggota</option>
            {(r?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            {userId && !r?.users.some((u) => u.id === userId) && <option value={userId}>{userId}</option>}
          </select>
        </Label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Label label="Mode"><select value={mode} onChange={e => setMode(e.target.value as typeof mode)} className={inputCls} data-testid="select-report-mode"><option value="">Semua mode</option><option value="HEMAT">Hemat</option><option value="AI">AI (belum aktif)</option></select></Label>
        <Label label="Provider"><select value={provider} onChange={e => setProvider(e.target.value)} className={inputCls} data-testid="select-report-provider"><option value="">Semua provider</option><option value="local-compositor">Renderer lokal</option>{(r?.providers ?? []).filter(p => p.id !== 'local-compositor').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{provider && provider !== 'local-compositor' && !r?.providers.some(p => p.id === provider) && <option value={provider}>{provider}</option>}</select></Label>
      </div>
      {report.isLoading ? <Skeleton className="mt-4 h-64 rounded-2xl" /> : report.isError ? <div className="mt-4"><ErrorBox message={errMsg(report.error)} onRetry={() => report.refetch()} /></div> : r && (
        <div className="mt-5 space-y-5">
          {r.warnings.length > 0 && (
            <ul className="space-y-1 rounded-2xl bg-accent/25 p-3 text-sm ring-1 ring-accent/50" data-testid="list-report-warnings">
              {r.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</li>)}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Job" value={r.summary.jobs} sub={`${r.summary.successful} berhasil · ${r.summary.failed} gagal`} testid="text-report-jobs" />
            <Stat label="Biaya aktual" value={usd(r.summary.actualUsd)} sub={`Subtotal diketahui ${usd(r.summary.knownSubtotalUsd)}`} testid="text-report-actual" />
            <Stat label="Biaya tidak diketahui" value={r.summary.unknownCosts} sub={`Estimasi tertunda ${usd(r.summary.estimatedPendingUsd)}`} />
            <Stat label="Simulasi" value={r.simulations} sub="Dihitung terpisah, tanpa biaya" />
            <Stat label="Anggota aktif" value={r.activeMembers} sub={`${r.pendingMembers} menunggu`} />
            <Stat label="Konsep" value={r.concepts} sub={`${r.approvedConcepts} setuju · ${r.rejectedConcepts} tolak · ${r.waitingConcepts} menunggu`} />
            <Stat label="Diproses" value={r.processing} sub={`Percobaan ulang ${r.summary.retries}`} />
            <Stat label="Karakter" value={r.characters} />
          </div>
          {r.summary.optimization && <div className="space-y-3 rounded-2xl bg-muted/40 p-3" data-testid="panel-optimization">
            <h3 className="font-display text-lg font-bold">Optimasi E · data terukur</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Video layak" value={r.summary.approved} sub={`${percent(r.summary.optimization.approvalPercent)} dari render selesai; persetujuan masih valid`} />
              <Stat label="Biaya/video layak" value={usd(r.summary.optimization.actualPerPublishableUsd)} sub="Total aktual semua job / video layak" />
              <Stat label="Biaya/video berhasil" value={usd(r.summary.optimization.actualPerSuccessfulUsd)} sub="Termasuk biaya job gagal/batal" />
              <Stat label="Kegagalan / retry" value={`${percent(r.summary.optimization.failurePercent)} / ${percent(r.summary.optimization.retryPercent)}`} sub="Persentase job dalam filter" />
              <Stat label="Rata-rata antre" value={milliseconds(r.summary.optimization.averageQueueMs)} />
              <Stat label="Rata-rata render" value={milliseconds(r.summary.optimization.averageRenderMs)} />
              <Stat label="Rata-rata produksi" value={milliseconds(r.summary.optimization.averageTotalMs)} sub={`${r.summary.optimization.timedJobs} sampel total terukur; tidak termasuk antre`} />
              <Stat label="QC teknis" value={`${r.summary.optimization.technicalPass} PASS / ${r.summary.optimization.technicalFail} FAIL`} sub={`${r.summary.optimization.untested} belum diuji; bukan izin publikasi`} />
            </div>
            <p className="text-xs text-muted-foreground">{r.summary.optimization.characterConsistency} Ukuran hasil terukur {(r.summary.optimization.measuredBytes / 1048576).toFixed(2)} MiB (bukan total penyimpanan atau biaya).</p>
          </div>}
          <p className="font-mono text-[11px] text-muted-foreground">Periode {fmtDate(r.from)} sampai {fmtDate(r.to)} · batas harian {r.settings.dailyLimit} · {r.settings.paused ? 'produksi dijeda' : 'produksi berjalan'}</p>
          <GroupTable title="Per anggota" rows={r.users} />
          <GroupTable title="Per mode" rows={r.modes} />
          <GroupTable title="Per provider" rows={r.providers} />
          <div>
            <h3 className="font-display mb-2 text-lg font-bold">Job dalam periode</h3>
            {!r.jobs.length ? <Empty>Tidak ada job pada periode ini.</Empty> : (
              <div className="overflow-x-auto rounded-2xl ring-1 ring-border/60">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-muted/70 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr><th className="p-2">Judul</th><th className="p-2">Status</th><th className="p-2">Mode</th><th className="p-2">Model</th><th className="p-2">Sumber biaya</th><th className="p-2">Aktual</th><th className="p-2">Provider</th><th className="p-2">Render</th><th className="p-2">TTS</th><th className="p-2">Ulang</th><th className="p-2">Dibuat</th></tr>
                  </thead>
                  <tbody>
                    {r.jobs.map((j) => (
                      <tr key={j.id} className="border-t border-border/60" data-testid={`row-report-job-${j.id}`}>
                        <td className="p-2 font-medium">{j.title}{j.simulation && <Pill tone="ink" className="ml-1">Simulasi</Pill>}</td>
                        <td className="p-2">{j.status}</td>
                        <td className="p-2">{j.mode}</td>
                        <td className="p-2">{j.cost?.model ?? 'Tidak diketahui'}</td>
                        <td className="p-2">{j.cost ? `${j.cost.source} · ${j.cost.currency}${j.cost.legacy ? ' · lama' : ''}` : 'Tidak diketahui'}</td>
                        <td className="p-2">{usd(j.cost ? j.cost.actualUsd : j.actualCostUsd)}</td>
                        <td className="p-2">{usd(j.cost?.providerUsd)}</td>
                        <td className="p-2">{usd(j.cost?.renderUsd)}</td>
                        <td className="p-2">{usd(j.cost?.ttsUsd)}</td>
                        <td className="p-2">{j.cost ? `${j.cost.retries} · ${usd(j.cost.retryUsd)}` : j.attempts}</td>
                        <td className="p-2">{fmtDate(j.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

function GroupTable({ title, rows }: { title: string; rows: OperationsGroup[] }) {
  return (
    <div>
      <h3 className="font-display mb-2 text-lg font-bold">{title}</h3>
      {!rows.length ? <Empty>Belum ada data.</Empty> : (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-border/60">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-muted/70 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="p-2">Nama</th><th className="p-2">Job</th><th className="p-2">Berhasil</th><th className="p-2">Gagal</th><th className="p-2">Ulang</th><th className="p-2">Aktual</th><th className="p-2">Diketahui</th><th className="p-2">Tak diketahui</th><th className="p-2">Final S/T/M</th><th className="p-2">Biaya/layak</th><th className="p-2">Produksi</th></tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-t border-border/60">
                  <td className="p-2 font-medium">{g.name}</td><td className="p-2">{g.jobs}</td><td className="p-2">{g.successful}</td><td className="p-2">{g.failed}</td><td className="p-2">{g.retries}</td>
                  <td className="p-2">{usd(g.actualUsd)}</td><td className="p-2">{usd(g.knownSubtotalUsd)}</td><td className="p-2">{g.unknownCosts}</td><td className="p-2">{g.approved}/{g.rejected}/{g.waiting}</td><td className="p-2">{usd(g.optimization?.actualPerPublishableUsd)}</td><td className="p-2">{milliseconds(g.optimization?.averageTotalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const milliseconds = (v: number | null | undefined) => v == null ? 'Belum terukur' : `${(v / 1000).toFixed(2)} dtk`;
const percent = (v: number | null | undefined) => v == null ? 'Belum tersedia' : `${v.toFixed(1)}%`;

type Draft = { paused: boolean; dailyLimit: number; budgetUsd: string; dailyBudgetUsd: string; userBudgetUsd: string; warningPercent: number; retentionDays: string };
const toDraft = (s: OperationsSettings): Draft => ({
  paused: s.paused, dailyLimit: s.dailyLimit, warningPercent: s.warningPercent,
  budgetUsd: s.budgetUsd === null ? '' : String(s.budgetUsd),
  dailyBudgetUsd: s.dailyBudgetUsd === null ? '' : String(s.dailyBudgetUsd),
  userBudgetUsd: s.userBudgetUsd === null ? '' : String(s.userBudgetUsd),
  retentionDays: s.retentionDays === null ? '' : String(s.retentionDays),
});
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function SettingsForm() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const settings = useGetOperationsSettings({ query: { queryKey: getGetOperationsSettingsQueryKey(), ...LIVE } });
  const upd = useUpdateOperationsSettings();
  const [d, setD] = useState<Draft | null>(null);
  const inited = useRef(false);
  useEffect(() => {
    if (settings.data && !inited.current) { inited.current = true; setD(toDraft(settings.data)); }
  }, [settings.data]);
  const s = settings.data;
  const dirty = !!(s && d && JSON.stringify(toDraft(s)) !== JSON.stringify(d));

  const errs: string[] = [];
  if (d) {
    if (!(d.dailyLimit >= 1 && d.dailyLimit <= 3)) errs.push('Batas harian harus 1 sampai 3.');
    if (!(d.warningPercent >= 1 && d.warningPercent <= 100)) errs.push('Persen peringatan harus 1 sampai 100.');
    for (const [k, l] of [['budgetUsd', 'Anggaran bulanan'], ['dailyBudgetUsd', 'Anggaran harian'], ['userBudgetUsd', 'Anggaran per anggota']] as const) {
      const v = num(d[k]); if (v !== null && !(v >= 0 && v <= 10000)) errs.push(`${l} harus 0 sampai 10000 atau dikosongkan.`);
    }
    const r = num(d.retentionDays); if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 3650)) errs.push('Retensi harus 1 sampai 3650 hari atau dikosongkan (manual).');
  }

  const save = () => {
    if (!d) return;
    const data: OperationsSettingsInput = {
      paused: d.paused, dailyLimit: d.dailyLimit, warningPercent: d.warningPercent,
      budgetUsd: num(d.budgetUsd), dailyBudgetUsd: num(d.dailyBudgetUsd), userBudgetUsd: num(d.userBudgetUsd), retentionDays: num(d.retentionDays),
    };
    upd.mutate({ data }, {
      onSuccess: (n) => {
        qc.setQueryData(getGetOperationsSettingsQueryKey(), n);
        setD(toDraft(n));
        void invalidatePrefixes(qc, ['/api/operations', '/api/video', '/api/overview', '/api/app-info']);
        toast({ title: 'Pengaturan disimpan', description: n.retentionDays !== null && !n.retentionApproved ? 'Usulan retensi menunggu persetujuan Super Admin.' : undefined });
      },
      onError: (e) => toast({ title: 'Gagal menyimpan', description: errMsg(e), variant: 'destructive' }),
    });
  };

  const budget = (k: 'budgetUsd' | 'dailyBudgetUsd' | 'userBudgetUsd', label: string) => d && (
    <Label label={label} hint="USD, kosong = tanpa batas">
      <div className="flex gap-2">
        <input type="number" min={0} max={10000} step="0.01" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={inputCls} data-testid={`input-${k}`} />
        <button type="button" onClick={() => setD({ ...d, [k]: '' })} disabled={d[k] === ''} className={btnMuted} data-testid={`button-clear-${k}`}>Kosongkan</button>
      </div>
    </Label>
  );

  return (
    <Panel title="Pengaturan" eyebrow="Kuota & anggaran" action={dirty ? <button onClick={() => s && setD(toDraft(s))} className={btnMuted} data-testid="button-reset-settings"><RotateCcw className="h-4 w-4" /> Batalkan perubahan</button> : undefined}>
      {settings.isLoading || (!d && !settings.isError) ? <Skeleton className="h-64 rounded-2xl" /> : settings.isError ? <ErrorBox message={errMsg(settings.error)} onRetry={() => settings.refetch()} /> : d && s && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.paused} onChange={(e) => setD({ ...d, paused: e.target.checked })} data-testid="checkbox-paused" /> Jeda semua produksi video</label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label label="Batas video harian tim" hint="1–3">
              <select value={d.dailyLimit} onChange={(e) => setD({ ...d, dailyLimit: Number(e.target.value) })} className={inputCls} data-testid="select-daily-limit">
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n} per hari</option>)}
              </select>
            </Label>
            <Label label="Peringatan anggaran" hint="persen terpakai, 1–100">
              <input type="number" min={1} max={100} value={d.warningPercent} onChange={(e) => setD({ ...d, warningPercent: Number(e.target.value) })} className={inputCls} data-testid="input-warning-percent" />
            </Label>
            {budget('budgetUsd', 'Anggaran bulanan')}
            {budget('dailyBudgetUsd', 'Anggaran harian')}
            {budget('userBudgetUsd', 'Anggaran per anggota')}
            <Label label="Usulan retensi" hint="hari, kosong = manual">
              <div className="flex gap-2">
                <input type="number" min={1} max={3650} value={d.retentionDays} onChange={(e) => setD({ ...d, retentionDays: e.target.value })} className={inputCls} data-testid="input-retention-days" />
                <button type="button" onClick={() => setD({ ...d, retentionDays: '' })} disabled={d.retentionDays === ''} className={btnMuted} data-testid="button-clear-retention">Manual</button>
              </div>
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">{s.costNote}</p>
          {errs.length > 0 && <ul className="text-xs text-destructive" data-testid="list-settings-errors">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
          {settings.isFetching === false && dirty && <p className="text-xs text-primary">Ada perubahan yang belum disimpan. Data server tidak menimpa isian ini.</p>}
          <button onClick={save} disabled={!dirty || errs.length > 0 || upd.isPending} className={btnPrimary} data-testid="button-save-settings">{upd.isPending ? 'Menyimpan...' : 'Simpan pengaturan'}</button>
        </div>
      )}
    </Panel>
  );
}

function Retention({ me }: { me: Member }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prev = useGetRetentionPreview({ query: { queryKey: getGetRetentionPreviewQueryKey(), ...LIVE } });
  const approve = useApproveRetentionPolicy();
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const p = prev.data;
  const s = p?.settings;
  const canApprove = isSuper(me) && !!s && s.retentionDays !== null && !s.retentionApproved;

  const submit = () => {
    if (!s) return;
    approve.mutate({ data: { version: s.retentionVersion, confirmed, note: note.trim() } }, {
      onSuccess: () => {
        setConfirmed(false); setNote('');
        void invalidatePrefixes(qc, ['/api/operations', '/api/video']);
        toast({ title: 'Kebijakan retensi disetujui', description: `Versi ${s.retentionVersion}` });
      },
      onError: (e) => toast({ title: errStatus(e) === 409 ? 'Versi kebijakan berubah' : 'Gagal menyetujui', description: errStatus(e) === 409 ? 'Muat ulang pratinjau lalu periksa versi terbaru.' : errMsg(e), variant: 'destructive' }),
    });
  };

  return (
    <Panel title="Retensi" eyebrow="Penghapusan permanen">
      {prev.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : prev.isError ? <ErrorBox message={errMsg(prev.error)} onRetry={() => prev.refetch()} /> : p && s && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={s.retentionDays === null ? 'muted' : s.retentionApproved ? 'ok' : 'sun'} data-testid="status-retention">
              {s.retentionDays === null ? 'Manual' : s.retentionApproved ? 'Disetujui' : 'Menunggu persetujuan'}
            </Pill>
            <span className="font-mono text-[11px] text-muted-foreground">versi {s.retentionVersion} · {s.retentionDays === null ? 'tanpa hapus otomatis' : `${s.retentionDays} hari`}</span>
          </div>
          <div className="flex gap-2 rounded-2xl bg-destructive/8 p-3 text-sm text-destructive" data-testid="text-retention-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{p.warning} Penghapusan bersifat permanen dan hanya berjalan setelah masa tenggang 24 jam sejak persetujuan. Tidak ada tombol hapus sekaligus.</p>
          </div>
          <div>
            <h3 className="font-display mb-2 text-lg font-bold">Kandidat penghapusan ({p.candidates.length})</h3>
            {!p.candidates.length ? <Empty>Tidak ada hasil video yang akan dihapus oleh kebijakan ini.</Empty> : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {p.candidates.map((j) => <li key={j.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-background/60 px-3 py-2 text-xs ring-1 ring-border/60" data-testid={`row-retention-${j.id}`}><span className="font-medium">{j.title}</span><span className="font-mono text-muted-foreground">{j.status} · {fmtDate(j.createdAt)}</span></li>)}
              </ul>
            )}
          </div>
          {canApprove ? (
            <div className="rounded-2xl bg-sidebar p-4 text-sidebar-foreground">
              <div className="font-display text-lg font-bold">Persetujuan Super Admin untuk versi {s.retentionVersion}</div>
              <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" data-testid="checkbox-retention-confirm" /> Saya memahami file video yang memenuhi kebijakan ini akan dihapus permanen setelah masa tenggang 24 jam.</label>
              <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan persetujuan (minimal 10 karakter)" className="mt-3 w-full rounded-xl bg-sidebar-accent px-3 py-2 text-sm outline-none" data-testid="input-retention-note" />
              <button onClick={submit} disabled={!confirmed || note.trim().length < 10 || approve.isPending} className={`${btnDanger} mt-3`} data-testid="button-approve-retention">{approve.isPending ? 'Menyimpan...' : `Setujui versi ${s.retentionVersion}`}</button>
            </div>
          ) : s.retentionDays !== null && !s.retentionApproved ? (
            <p className="text-xs text-muted-foreground">Usulan ini hanya berlaku setelah Super Admin menyetujui versi yang sama secara eksplisit.</p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function Audit() {
  const audit = useGetOperationsAudit({ query: { queryKey: getGetOperationsAuditQueryKey(), ...LIVE } });
  return (
    <Panel title="Audit" eyebrow="Jejak perubahan">
      {audit.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : audit.isError ? <ErrorBox message={errMsg(audit.error)} onRetry={() => audit.refetch()} />
        : !audit.data?.length ? <Empty>Belum ada catatan audit.</Empty> : (
          <ul className="max-h-[520px] space-y-2 overflow-y-auto">
            {audit.data.map((a) => (
              <li key={a.id} className="rounded-xl bg-background/60 px-3 py-2 text-sm ring-1 ring-border/60" data-testid={`row-audit-${a.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] uppercase text-primary">{a.action}</span>
                  <Pill tone={a.result === 'OK' || a.result === 'SUCCESS' ? 'ok' : 'muted'}>{a.result}</Pill>
                  <span className="font-mono text-[10px] text-muted-foreground">{fmtDate(a.createdAt)} · {a.userId}{a.objectId ? ` · ${a.objectId}` : ''}</span>
                </div>
                <p className="mt-1">{a.description}</p>
                {(a.before || a.after) && (
                  <details className="mt-1 text-xs"><summary className="cursor-pointer text-muted-foreground">Sebelum / sesudah</summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-2 font-mono">{a.before ?? '-'}{'\n---\n'}{a.after ?? '-'}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}
