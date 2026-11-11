import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9', className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#2a1430" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#f5b82e" strokeWidth="5" />
      <path d="M24 38c2 3 5 4 8 4 4 0 7-2 7-5 0-7-14-4-14-11 0-3 3-5 7-5 3 0 5 1 7 3" fill="none" stroke="#e8462a" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-none">
        <div className={cn('font-display text-[15px] font-extrabold', light ? 'text-sidebar-foreground' : 'text-foreground')}>SOLID AI REMIX</div>
        <div className={cn('mt-1 font-mono text-[10px] uppercase tracking-[0.18em]', light ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>Studio Solid Gold</div>
      </div>
    </div>
  );
}

export function Pill({ children, tone = 'muted', className, ...rest }: { children: React.ReactNode; tone?: 'muted' | 'hot' | 'sun' | 'ink' | 'ok'; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const tones = {
    muted: 'bg-muted text-muted-foreground',
    hot: 'bg-primary/12 text-primary',
    sun: 'bg-accent/30 text-accent-foreground',
    ink: 'bg-foreground text-background',
    ok: 'bg-[hsl(170_40%_36%/0.14)] text-[hsl(170_45%_26%)]',
  };
  return (
    <span {...rest} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wider', tones[tone], className)}>
      {children}
    </span>
  );
}
