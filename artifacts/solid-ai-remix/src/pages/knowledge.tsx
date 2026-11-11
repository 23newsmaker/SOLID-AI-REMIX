import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Search, AlertTriangle } from 'lucide-react';
import { useListKnowledge, getListKnowledgeQueryKey } from '@workspace/api-client-react';
import type { ListKnowledgeSegment, ListKnowledgeMode, ListKnowledgeParams } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg } from '@/lib/labels';
import { cn } from '@/lib/utils';

const SEGMENTS: { v: ListKnowledgeSegment; l: string }[] = [
  { v: 'ALL', l: 'Semua' }, { v: 'COMPANY', l: 'Perusahaan' }, { v: 'MIKRO', l: 'Mikro' }, { v: 'MINI', l: 'Mini' }, { v: 'REGULAR', l: 'Reguler' },
];

export default function Knowledge() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [segment, setSegment] = useState<ListKnowledgeSegment>('ALL');
  const [mode, setMode] = useState<ListKnowledgeMode>('INTERNAL');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params: ListKnowledgeParams = { segment, mode, ...(dq ? { q: dq } : {}) };
  const list = useListKnowledge(params, { query: { queryKey: getListKnowledgeQueryKey(params), placeholderData: (p) => p } });
  const d = list.data;

  return (
    <>
      <PageHead eyebrow="Indeks pengetahuan" title="Sumber resmi">
        Cari dokumen Solid Gold. Rujukan internal tetap perlu ditinjau sebelum dipakai di konten publik.
      </PageHead>

      <div className="sticky top-16 z-20 -mx-4 space-y-3 bg-background/90 px-4 py-3 backdrop-blur md:top-0">
        <label className="relative block">
          <span className="sr-only">Cari sumber</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul, kategori, atau isi..." data-testid="input-search" className="w-full rounded-2xl bg-card py-3.5 pl-11 pr-4 ring-1 ring-input focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Mode" className="flex rounded-full bg-muted p-1">
            {(['INTERNAL', 'PUBLIC'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} data-testid={`button-mode-${m}`} className={cn('rounded-full px-3.5 py-1.5 text-xs font-semibold', mode === m ? 'bg-foreground text-background' : 'text-muted-foreground')}>
                {m === 'INTERNAL' ? 'Internal' : 'Siap publik'}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Segmen" className="flex flex-wrap gap-1.5">
            {SEGMENTS.map((s) => (
              <button key={s.v} onClick={() => setSegment(s.v)} aria-pressed={segment === s.v} data-testid={`button-segment-${s.v}`} className={cn('rounded-full px-3 py-1.5 text-xs ring-1', segment === s.v ? 'bg-primary text-primary-foreground ring-primary' : 'ring-border hover:bg-muted')}>
                {s.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {d?.notice && <p className="mt-4 rounded-xl bg-accent/25 px-4 py-3 text-sm" data-testid="text-notice">{d.notice}</p>}
      {d && <p className="mt-4 font-mono text-xs text-muted-foreground" data-testid="text-total">{d.items.length} ditampilkan dari {d.total} — {d.publicApproved} disetujui untuk publik</p>}

      <div className="mt-4">
        {list.isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : list.isError ? (
          <ErrorBox message={errMsg(list.error)} onRetry={() => list.refetch()} />
        ) : !d?.items.length ? (
          <div className="rounded-3xl border border-dashed p-10 text-center">
            <div className="font-display text-2xl font-bold">{mode === 'PUBLIC' ? 'Belum ada sumber yang disetujui untuk publik.' : 'Tidak ada hasil.'}</div>
            <p className="mt-2 text-sm text-muted-foreground">{mode === 'PUBLIC' ? 'Ini memang kondisi awal. Persetujuan dilakukan oleh reviewer kepatuhan.' : 'Coba kata kunci lain atau ubah segmen.'}</p>
          </div>
        ) : (
          <ul className={cn('space-y-2 transition-opacity', list.isFetching && 'opacity-60')}>
            {d.items.map((s) => (
              <li key={s.id}>
                <Link href={`/knowledge/${s.id}`} data-testid={`card-source-${s.id}`} className="block rounded-2xl bg-card p-4 ring-1 ring-card-border transition-transform hover:-translate-y-0.5 hover:ring-primary/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{s.sourceId}</span>
                    <Pill>{s.segment}</Pill>
                    <Pill tone="sun">{s.validation}</Pill>
                    <Pill tone="ink">{s.access}</Pill>
                    {s.warnings.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-primary"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{s.warnings.length} catatan</span>}
                  </div>
                  <div className="mt-2 font-semibold">{s.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{s.category} — v{s.version}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
