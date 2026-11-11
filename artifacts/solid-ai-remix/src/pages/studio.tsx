import { Link } from 'wouter';
import { Check, Circle, ArrowRight, Clapperboard } from 'lucide-react';
import { useGetOverview, useGetActivity, useGetCharacter } from '@workspace/api-client-react';
import type { Member } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg, fmtDate, roleLabel } from '@/lib/labels';

export default function Studio({ me }: { me: Member }) {
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
            <div className="flex items-center gap-2"><Clapperboard className="h-5 w-5 text-sidebar-primary" aria-hidden="true" /><Pill tone="sun">Tidak tersedia</Pill></div>
            <div className="font-display mt-4 text-2xl font-extrabold">Pembuatan video belum aktif</div>
            <p className="mt-2 text-sm text-sidebar-foreground/70">Fase {o?.phase ?? 'A'}. Tidak ada video atau model bahasa yang berjalan.</p>
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
              { ok: o.activeMembers > 0, t: 'Anggota aktif', v: `${o.activeMembers} dari ${o.maxMembers}` },
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
