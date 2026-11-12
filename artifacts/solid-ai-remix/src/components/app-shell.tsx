import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, UserRound, BookOpenText, Users, LogOut, Download, Clapperboard, Film, Gauge, Plug, ScrollText, BadgeCheck, Crown } from 'lucide-react';
import type { Member } from '@workspace/api-client-react';
import { Wordmark } from '@/components/brand';
import { roleLabel, initials } from '@/lib/labels';
import { useInstallPrompt } from '@/lib/pwa';
import { cn } from '@/lib/utils';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function useSignOut() {
  const { signOut } = useClerk();
  const qc = useQueryClient();
  return () => {
    qc.clear();
    void signOut({ redirectUrl: basePath || '/' });
  };
}

export function AppShell({ me, children }: { me: Member; children: ReactNode }) {
  const [loc] = useLocation();
  const signOut = useSignOut();
  const { canInstall, install } = useInstallPrompt();
  const nav = [
    ...(me.role === 'SUPER_ADMIN' ? [{ href: '/operations', label: 'Dashboard Super Admin', icon: Crown }] : []),
    { href: '/studio', label: 'Studio', icon: LayoutGrid },
    { href: '/creative', label: 'Kreatif', icon: Clapperboard },
    { href: '/videos', label: 'Video', icon: Film },
    { href: '/character', label: 'Karakter', icon: UserRound },
    { href: '/knowledge', label: 'Pengetahuan', icon: BookOpenText },
    { href: '/team', label: 'Tim', icon: Users, show: me.role === 'SUPER_ADMIN' || me.role === 'ADMIN' },
    { href: '/video-review', label: 'Review', icon: BadgeCheck, show: me.role !== 'VIEWER' },
    { href: '/facts', label: 'Fakta', icon: ScrollText, show: me.role === 'SUPER_ADMIN' || me.role === 'ADMIN' || me.role === 'REVIEWER_COMPLIANCE' },
    { href: '/operations', label: 'Operasional', icon: Gauge, show: me.role === 'ADMIN' },
    { href: '/providers', label: 'Provider', icon: Plug, show: me.role === 'SUPER_ADMIN' },
  ].filter((n) => n.show !== false);
  const active = (h: string) => loc === h || loc.startsWith(h + '/');

  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-[100dvh] flex-col bg-sidebar p-5 text-sidebar-foreground md:flex">
        <Wordmark light />
        <nav className="mt-10 flex flex-col gap-1" aria-label="Navigasi utama">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              data-testid={`link-nav-${n.href.slice(1)}`}
              aria-current={active(n.href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sidebar-primary',
                active(n.href) ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
              )}
            >
              <n.icon className="h-4 w-4" aria-hidden="true" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {canInstall && (
            <button onClick={install} data-testid="button-install" className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border px-3 py-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent">
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Pasang aplikasi
            </button>
          )}
          <div className="rounded-2xl bg-sidebar-accent p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">{initials(me.name)}</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" data-testid="text-me-name">{me.name}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/60">{roleLabel[me.role]}</div>
              </div>
            </div>
            <button onClick={signOut} data-testid="button-signout" className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs text-sidebar-foreground/80 hover:bg-sidebar hover:text-sidebar-foreground">
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Keluar
            </button>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur md:hidden">
        <Wordmark />
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-full bg-sidebar py-1 pl-1 pr-3 text-sidebar-foreground" data-testid="badge-me-mobile">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">{initials(me.name)}</div>
            <div className="min-w-0 leading-tight">
              <div className="max-w-[96px] truncate text-xs font-semibold" data-testid="text-me-name-mobile">{me.name}</div>
              <div className={cn('font-mono text-[9px] uppercase tracking-wider', me.role === 'SUPER_ADMIN' ? 'text-sidebar-primary' : 'text-sidebar-foreground/60')} data-testid="text-me-role-mobile">{roleLabel[me.role]}</div>
            </div>
          </div>
        <button onClick={signOut} aria-label="Keluar" data-testid="button-signout-mobile" className="grid h-10 w-10 place-items-center rounded-full bg-muted">
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
        </div>
      </header>

      <main className="px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">
        <div key={loc} className="rise mx-auto max-w-5xl">{children}</div>
      </main>

      <nav className="fixed inset-x-3 bottom-3 z-40 flex gap-1 overflow-x-auto rounded-2xl bg-sidebar p-1.5 shadow-lg md:hidden" aria-label="Navigasi utama">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? 'page' : undefined}
            data-testid={`link-mnav-${n.href.slice(1)}`}
            className={cn('flex min-w-[64px] shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium', active(n.href) ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/70')}
          >
            <n.icon className="h-[18px] w-[18px]" aria-hidden="true" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{eyebrow}</div>
      <h1 className="font-display mt-2 text-4xl font-extrabold md:text-5xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <button onClick={onRetry} data-testid="button-retry" className="mt-3 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
          Coba lagi
        </button>
      )}
    </div>
  );
}
