import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import type { Member } from '@workspace/api-client-react';
import { PageHead } from '@/components/app-shell';
import { cn } from '@/lib/utils';

export const inputCls = 'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/40 disabled:opacity-60';
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50';
export const btnMuted = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm disabled:opacity-50';
export const btnDanger = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50';

/** Refresh reviews during interaction; resume on return without endless idle requests. */
export { ACTIVITY_REFRESH as LIVE } from '@/lib/activity-polling';

export const isSuper = (m: Member) => m.role === 'SUPER_ADMIN';
export const isAdminRole = (m: Member) => m.role === 'SUPER_ADMIN' || m.role === 'ADMIN';
export const isReviewerRole = (m: Member) => m.role === 'SUPER_ADMIN' || m.role === 'REVIEWER_COMPLIANCE';

/** Invalidate every cached query whose URL key starts with one of the prefixes. */
export function invalidatePrefixes(qc: QueryClient, prefixes: string[]) {
  return qc.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === 'string' && prefixes.some((p) => k.startsWith(p));
    },
  });
}

export function Panel({ title, eyebrow, children, className, action }: { title: string; eyebrow?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cn('rounded-[24px] bg-card p-5 ring-1 ring-card-border md:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          {eyebrow && <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{eyebrow}</div>}
          <h2 className="font-display text-xl font-bold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">{children}</p>;
}

export function NoAccess({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <>
      <PageHead eyebrow={eyebrow} title={title} />
      <div className="rounded-3xl bg-card p-8 ring-1 ring-card-border" data-testid="status-no-access">
        <ShieldAlert className="h-6 w-6 text-primary" aria-hidden="true" />
        <h2 className="font-display mt-4 text-2xl font-bold">Akses dibatasi</h2>
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      </div>
    </>
  );
}

export function Label({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="ml-2 text-[11px] text-muted-foreground">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Stat({ label, value, sub, testid }: { label: string; value: ReactNode; sub?: ReactNode; testid?: string }) {
  return (
    <div className="rounded-2xl bg-background/70 p-3 ring-1 ring-border/60">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display mt-1 text-2xl font-extrabold" data-testid={testid}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
