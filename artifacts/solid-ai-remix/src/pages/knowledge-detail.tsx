import type { ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, AlertTriangle, Lock } from 'lucide-react';
import { useGetKnowledgeSource, getGetKnowledgeSourceQueryKey } from '@workspace/api-client-react';
import { ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { errMsg, errStatus } from '@/lib/labels';

// Safe markdown-ish renderer: builds React elements only, never injects HTML.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
  );
}
function SafeMarkdown({ src }: { src: string }) {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`u${out.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  src.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) { list.push(li[1]); return; }
    flush();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const lvl = h[1].length;
      out.push(lvl === 1 ? <h2 key={i}>{inline(h[2])}</h2> : lvl === 2 ? <h3 key={i}>{inline(h[2])}</h3> : <h4 key={i}>{inline(h[2])}</h4>);
    } else if (line.trim()) out.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="prose prose-stone max-w-none prose-headings:font-display">{out}</div>;
}

export default function KnowledgeDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useGetKnowledgeSource(id, { query: { enabled: !!id, queryKey: getGetKnowledgeSourceQueryKey(id) } });
  const s = q.data?.source;
  const st = errStatus(q.error);

  return (
    <>
      <Link href="/knowledge" data-testid="link-back" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Kembali ke indeks
      </Link>
      {q.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-64 rounded-3xl" /></div>
      ) : q.isError ? (
        st === 403 ? (
          <div className="rounded-3xl bg-card p-8 ring-1 ring-card-border">
            <Lock className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="font-display mt-4 text-2xl font-bold">Dokumen terbatas</h1>
            <p className="mt-2 text-sm text-muted-foreground">Hanya admin dan reviewer kepatuhan yang dapat membuka dokumen ini.</p>
          </div>
        ) : <ErrorBox message={errMsg(q.error, 'Sumber tidak ditemukan.')} onRetry={() => q.refetch()} />
      ) : s && (
        <article>
          <div className="flex flex-wrap gap-2">
            <Pill>{s.segment}</Pill><Pill tone="sun">{s.validation}</Pill><Pill tone="ink">{s.access}</Pill>
          </div>
          <h1 className="font-display mt-4 text-3xl font-extrabold md:text-5xl" data-testid="text-source-title">{s.title}</h1>
          <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-card p-4 text-sm ring-1 ring-card-border md:grid-cols-4">
            {[['ID sumber', s.sourceId], ['Kategori', s.category], ['Versi', s.version], ['Berkas', s.fileName]].map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="font-mono text-[10px] uppercase text-muted-foreground">{k}</dt><dd className="truncate font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 rounded-xl bg-accent/25 px-4 py-3 text-sm">Rujukan internal wajib ditinjau reviewer kepatuhan sebelum dipakai untuk publik. Label audiens lama tidak sama dengan persetujuan.</p>
          {s.warnings.length > 0 && (
            <ul className="mt-4 space-y-2" aria-label="Catatan">
              {s.warnings.map((w, i) => (
                <li key={i} className="flex gap-2 rounded-xl bg-primary/8 px-4 py-3 text-sm text-primary"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-8 rounded-3xl bg-card p-6 ring-1 ring-card-border md:p-10" data-testid="text-source-content">
            {q.data?.content ? <SafeMarkdown src={q.data.content} /> : <p className="text-muted-foreground">Isi dokumen kosong.</p>}
          </div>
        </article>
      )}
    </>
  );
}
