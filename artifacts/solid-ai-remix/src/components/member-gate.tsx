import type { ReactNode } from 'react';
import { useGetMe } from '@workspace/api-client-react';
import type { Member } from '@workspace/api-client-react';
import { RefreshCw, LogOut, Hourglass, ShieldOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Wordmark } from '@/components/brand';
import { useSignOut, ErrorBox } from '@/components/app-shell';
import { errMsg } from '@/lib/labels';

export function MemberGate({ children }: { children: (me: Member) => ReactNode }) {
  const me = useGetMe();
  const signOut = useSignOut();

  if (me.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6 md:p-10" aria-busy="true">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      </div>
    );
  }
  if (me.isError || !me.data) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorBox message={errMsg(me.error, 'Tidak bisa memuat akun Anda.')} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (me.data.status !== 'ACTIVE') {
    const suspended = me.data.status === 'SUSPENDED';
    const Icon = suspended ? ShieldOff : Hourglass;
    return (
      <div className="grid min-h-[100dvh] place-items-center p-5">
        <div className="rise w-full max-w-lg rounded-[28px] bg-card p-8 shadow-sm ring-1 ring-card-border">
          <Wordmark />
          <div className="mt-8 grid h-14 w-14 place-items-center rounded-2xl bg-accent/40">
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="font-display mt-5 text-3xl font-extrabold" data-testid="text-gate-title">
            {suspended ? 'Akses sedang ditangguhkan' : 'Menunggu persetujuan'}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {suspended
              ? 'Akun Anda dinonaktifkan sementara oleh Super Admin. Hubungi admin Solid Gold bila menurut Anda ini keliru.'
              : 'Akun Anda sudah terdaftar. Super Admin perlu mengaktifkan keanggotaan sebelum Anda bisa masuk ke studio.'}
          </p>
          <div className="mt-6 rounded-xl bg-muted px-4 py-3 text-sm">
            <div className="font-medium">{me.data.name}</div>
            <div className="text-muted-foreground">{me.data.email}</div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => me.refetch()} disabled={me.isFetching} data-testid="button-refresh-status" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              <RefreshCw className={me.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" /> Periksa ulang
            </button>
            <button onClick={signOut} data-testid="button-gate-signout" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium ring-1 ring-border hover:bg-muted">
              <LogOut className="h-4 w-4" aria-hidden="true" /> Keluar
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <>{children(me.data)}</>;
}
