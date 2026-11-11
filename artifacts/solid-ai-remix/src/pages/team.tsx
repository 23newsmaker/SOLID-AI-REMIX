import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import {
  useListTeam, getListTeamQueryKey, useUpdateTeamMember,
  getGetOverviewQueryKey, getGetActivityQueryKey,
} from '@workspace/api-client-react';
import type { Member, Role, MemberStatus } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDate, initials, roleLabel, statusLabel } from '@/lib/labels';

const ROLES = Object.keys(roleLabel) as Role[];
const STATUSES = Object.keys(statusLabel) as MemberStatus[];

function Row({ m, self }: { m: Member; self: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const upd = useUpdateTeamMember();
  const [role, setRole] = useState<Role>(m.role);
  const [status, setStatus] = useState<MemberStatus>(m.status);
  const dirty = role !== m.role || status !== m.status;
  const save = () =>
    upd.mutate({ id: m.id, data: { role, status } }, {
      onSuccess: () => {
        toast({ title: 'Keanggotaan diperbarui' });
        qc.invalidateQueries({ queryKey: getListTeamQueryKey() });
        qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
        qc.invalidateQueries({ queryKey: getGetActivityQueryKey() });
      },
      onError: (e) => { toast({ title: 'Gagal memperbarui', description: errMsg(e), variant: 'destructive' }); setRole(m.role); setStatus(m.status); },
    });
  const sel = 'rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-input focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';
  return (
    <li data-testid={`row-member-${m.id}`} className="grid gap-3 rounded-2xl bg-card p-4 ring-1 ring-card-border md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary font-display font-bold">{initials(m.name)}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold"><span className="truncate">{m.name}</span>{self && <Pill>Anda</Pill>}</div>
          <div className="truncate text-xs text-muted-foreground">{m.email} — sejak {fmtDate(m.createdAt)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Peran ${m.name}`} value={role} disabled={self || upd.isPending} onChange={(e) => setRole(e.target.value as Role)} data-testid={`select-role-${m.id}`} className={sel}>
          {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
        </select>
        <select aria-label={`Status ${m.name}`} value={status} disabled={self || upd.isPending} onChange={(e) => setStatus(e.target.value as MemberStatus)} data-testid={`select-status-${m.id}`} className={sel}>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
        </select>
        <button onClick={save} disabled={!dirty || upd.isPending} data-testid={`button-save-member-${m.id}`} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
          {upd.isPending ? 'Menyimpan...' : 'Simpan'}
        </button>
      </div>
    </li>
  );
}

export default function Team({ me }: { me: Member }) {
  const isSuper = me.role === 'SUPER_ADMIN';
  const team = useListTeam({ query: { enabled: isSuper, queryKey: getListTeamQueryKey() } });

  if (!isSuper) {
    return (
      <>
        <PageHead eyebrow="Tim" title="Keanggotaan" />
        <div className="rounded-3xl bg-card p-8 ring-1 ring-card-border">
          <ShieldAlert className="h-6 w-6 text-primary" aria-hidden="true" />
          <h2 className="font-display mt-4 text-2xl font-bold">Khusus Super Admin</h2>
          <p className="mt-2 text-sm text-muted-foreground">Aktivasi akun dan pengaturan peran hanya dapat dilakukan oleh Super Admin.</p>
        </div>
      </>
    );
  }

  const list = team.data ?? [];
  const pending = list.filter((m) => m.status === 'PENDING');
  const rest = list.filter((m) => m.status !== 'PENDING');
  const active = list.filter((m) => m.status === 'ACTIVE').length;

  return (
    <>
      <PageHead eyebrow="Tim" title="Keanggotaan">Aktifkan karyawan baru dan atur perannya. Maksimal sepuluh anggota aktif.</PageHead>
      {team.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        : team.isError ? <ErrorBox message={errMsg(team.error)} onRetry={() => team.refetch()} /> : (
          <>
            <p className="mb-6 font-mono text-xs text-muted-foreground" data-testid="text-active-count">{active} anggota aktif dari 10</p>
            {pending.length > 0 && (
              <section className="mb-8">
                <h2 className="font-display mb-3 text-xl font-bold">Menunggu aktivasi <span className="text-primary">{pending.length}</span></h2>
                <ul className="space-y-2">{pending.map((m) => <Row key={m.id} m={m} self={m.id === me.id} />)}</ul>
              </section>
            )}
            <section>
              <h2 className="font-display mb-3 text-xl font-bold">Semua anggota</h2>
              {rest.length ? <ul className="space-y-2">{rest.map((m) => <Row key={m.id} m={m} self={m.id === me.id} />)}</ul>
                : <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">Belum ada anggota lain.</p>}
            </section>
          </>
        )}
    </>
  );
}
