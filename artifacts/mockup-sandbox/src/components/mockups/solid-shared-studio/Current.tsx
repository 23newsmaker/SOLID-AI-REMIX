import type {ReactNode, AnchorHTMLAttributes} from 'react';
import {LayoutGrid,UserRound,BookOpenText,Users,LogOut,Download,Clapperboard,Film,Gauge,Plug,ScrollText,BadgeCheck,Crown,Check,Circle,ArrowRight} from 'lucide-react';
import {cn} from '@/lib/utils';
import './_group.css';
// Extracted unchanged page/shell markup; all auth/router/API dependencies are static fixtures.
type Member={id:string;name:string;role:'SUPER_ADMIN'|'ADMIN'|'CREATOR'|'VIEWER'|'REVIEWER_COMPLIANCE'};
const roleLabel:Record<string,string>={SUPER_ADMIN:'Super Admin',ADMIN:'Admin',CREATOR:'Kreator',VIEWER:'Pengamat',REVIEWER_COMPLIANCE:'Reviewer'};
const initials=(s:string)=>s.split(' ').map(p=>p[0]).slice(0,2).join('');
const errMsg=(e:unknown)=>String(e??''); const fmtDate=(s:string)=>s;
function Link({href,...props}:AnchorHTMLAttributes<HTMLAnchorElement>){return <a {...props} href={href} onClick={e=>e.preventDefault()}/>}
function useLocation(){return ['/studio',()=>{}] as const}
function useClerk(){return {signOut:(_x:unknown)=>{}}}
function useQueryClient(){return {clear:()=>{}}}
function useInstallPrompt(){return {canInstall:false,install:()=>{}}}
function Skeleton({className}:{className?:string}){return <div className={className}/>}
function useGetOverview(){return {data:{nextStep:'Siapkan karakter dan kenali sumber resmi sebelum fitur pembuatan dibuka.',dailyUsed:0,dailyLimit:3,characterReady:false,sourceCount:0,approvedPublicCount:0,activeMembers:2,maxMembers:null as number|null,generationEnabled:false},isError:false,isLoading:false,error:null,refetch:()=>{}}}
function useGetActivity(){return {data:[] as {id:string;action:string;description:string;createdAt:string}[],isError:false,isLoading:false,error:null,refetch:()=>{}}}
function useGetCharacter(){return {data:{character:null as {name:string;photoUrl:string}|null},isLoading:false}}


function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9', className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#2a1430" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#f5b82e" strokeWidth="5" />
      <path d="M24 38c2 3 5 4 8 4 4 0 7-2 7-5 0-7-14-4-14-11 0-3 3-5 7-5 3 0 5 1 7 3" fill="none" stroke="#e8462a" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

function Wordmark({ light }: { light?: boolean }) {
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

function Pill({ children, tone = 'muted', className, ...rest }: { children: React.ReactNode; tone?: 'muted' | 'hot' | 'sun' | 'ink' | 'ok'; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
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


const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function useSignOut() {
  const { signOut } = useClerk();
  const qc = useQueryClient();
  return () => {
    qc.clear();
    void signOut({ redirectUrl: basePath || '/' });
  };
}

function AppShell({ me, children }: { me: Member; children: ReactNode }) {
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

function PageHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{eyebrow}</div>
      <h1 className="font-display mt-2 text-4xl font-extrabold md:text-5xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-muted-foreground">{children}</div>}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
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


function Studio({ me }: { me: Member }) {
  const ov = useGetOverview();
  const act = useGetActivity();
  const ch = useGetCharacter();
  const o = ov.data;
  const character = ch.data?.character ?? null;

  return (
    <>
      <PageHead eyebrow={`Halo, ${me.name.split(' ')[0]} — ${roleLabel[me.role]}`} title="Studio">
        {o?.nextStep ?? 'Siapkan karakter dan kenali sumber resmi sebelum fitur pembuatan dibuka.'}
      </PageHead>

      {ov.isError ? (
        <ErrorBox message={errMsg(ov.error)} onRetry={() => ov.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <Link href="/character" data-testid="card-character" className="group relative overflow-hidden rounded-[28px] bg-card p-6 ring-1 ring-card-border transition-transform hover:-translate-y-0.5">
            <div className="flex items-start gap-5">
              <div className="h-28 w-24 shrink-0 overflow-hidden rounded-2xl bg-muted">
                {character ? (
                  <img src={character.photoUrl} alt={`Foto karakter ${character.name}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center font-mono text-[10px] uppercase text-muted-foreground">Kosong</div>
                )}
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Karakter Anda</div>
                {ch.isLoading ? <Skeleton className="mt-2 h-8 w-40" /> : (
                  <div className="font-display mt-1 truncate text-3xl font-extrabold" data-testid="text-character-name">{character?.name ?? 'Belum ada'}</div>
                )}
                <div className="mt-3">{character ? <Pill tone="ok">Siap</Pill> : <Pill tone="hot">Perlu disiapkan</Pill>}</div>
              </div>
            </div>
            <ArrowRight className="absolute bottom-6 right-6 h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>

          <div className="rounded-[28px] bg-sidebar p-6 text-sidebar-foreground">
            <div className="flex items-center gap-2"><Clapperboard className="h-5 w-5 text-sidebar-primary" aria-hidden="true" /><Pill tone="sun">Mode Hemat</Pill></div>
            <div className="font-display mt-4 text-2xl font-extrabold">Produksi video Hemat</div>
            <p className="mt-2 text-sm text-sidebar-foreground/70">Render template dari konsep yang disetujui. Mode AI belum aktif.</p>
            <Link href="/creative" data-testid="link-studio-creative" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-sidebar-primary px-4 py-2 text-sm font-semibold text-sidebar-primary-foreground">Susun konsep <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/videos" data-testid="link-studio-videos" className="ml-2 mt-4 inline-flex items-center gap-2 rounded-xl bg-sidebar-accent px-4 py-2 text-sm font-semibold">Video <ArrowRight className="h-4 w-4" /></Link>
            {o && <div className="mt-4 font-mono text-xs text-sidebar-foreground/60">Kuota nanti: {o.dailyUsed}/{o.dailyLimit} per hari</div>}
          </div>
        </div>
      )}

      <section className="mt-8" aria-labelledby="ready">
        <h2 id="ready" className="font-display text-xl font-bold">Kesiapan</h2>
        {ov.isLoading ? <Skeleton className="mt-3 h-40 rounded-2xl" /> : o && (
          <ul className="mt-3 divide-y overflow-hidden rounded-2xl bg-card ring-1 ring-card-border">
            {[
              { ok: o.characterReady, t: 'Karakter tersimpan', v: o.characterReady ? 'Selesai' : 'Belum' },
              { ok: o.sourceCount > 0, t: 'Sumber pengetahuan terindeks', v: `${o.sourceCount} dokumen` },
              { ok: o.approvedPublicCount > 0, t: 'Sumber disetujui untuk publik', v: `${o.approvedPublicCount} disetujui` },
              { ok: o.activeMembers > 0, t: 'Anggota aktif', v: o.maxMembers === null ? `${o.activeMembers} anggota` : `${o.activeMembers} dari ${o.maxMembers}` },
              { ok: o.generationEnabled, t: 'Pembuatan video', v: 'Nonaktif' },
            ].map((r) => (
              <li key={r.t} className="flex items-center gap-3 px-5 py-4">
                {r.ok ? <Check className="h-4 w-4 text-[hsl(170_45%_32%)]" aria-label="Selesai" /> : <Circle className="h-4 w-4 text-muted-foreground" aria-label="Belum" />}
                <span className="flex-1 text-sm">{r.t}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.v}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8" aria-labelledby="act">
        <h2 id="act" className="font-display text-xl font-bold">Aktivitas terbaru</h2>
        {act.isLoading ? <Skeleton className="mt-3 h-32 rounded-2xl" /> : act.isError ? (
          <div className="mt-3"><ErrorBox message={errMsg(act.error)} onRetry={() => act.refetch()} /></div>
        ) : !act.data?.length ? (
          <p className="mt-3 rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">Belum ada aktivitas. Mulai dengan menyimpan karakter Anda.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {act.data.map((a) => (
              <li key={a.id} data-testid={`row-activity-${a.id}`} className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-card-border sm:flex-row sm:items-center sm:gap-4">
                <span className="font-mono text-[11px] uppercase text-primary sm:w-40">{a.action}</span>
                <span className="flex-1 text-sm">{a.description}</span>
                <time className="font-mono text-[11px] text-muted-foreground">{fmtDate(a.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export function Current(){const me:Member={id:'preview-only',name:'Anggota Contoh',role:'CREATOR'};return <><div className="bg-accent px-4 py-2 text-center text-xs">Tampilan saat ini · data contoh, bukan data anggota asli</div><AppShell me={me}><Studio me={me}/></AppShell></>}