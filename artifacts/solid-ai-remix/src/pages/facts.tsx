import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Pencil, Plus, X } from 'lucide-react';
import {
  useListComplianceSources, getListComplianceSourcesQueryKey, useReviewComplianceSource,
  useListPublicFacts, getListPublicFactsQueryKey, useCreatePublicFact, useRevisePublicFact, useReviewPublicFact,
} from '@workspace/api-client-react';
import type { Member, ComplianceSource, PublicFact, SourcePolicyInputAccess, SourcePolicyInputValidation, PublicFactReviewInputStatus } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { errMsg, errStatus, fmtDate } from '@/lib/labels';
import { NoAccess, Panel, Empty, Label, LIVE, btnPrimary, btnMuted, btnDanger, inputCls, invalidatePrefixes, isReviewerRole } from '@/components/ops-kit';

const AFFECTED = ['/api/compliance', '/api/facts', '/api/public-facts', '/api/creative', '/api/knowledge', '/api/overview', '/api/operations'];
const accessLabel: Record<string, string> = { INTERNAL_GENERAL: 'Internal umum', INTERNAL_RESTRICTED: 'Internal terbatas', APPROVED_FOR_PUBLIC_CONTENT: 'Disetujui untuk publik' };
const validationLabel: Record<string, string> = { NEEDS_REVIEW: 'Perlu ditinjau', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };
const factStatusTone = (s: string) => (s === 'APPROVED' ? 'ok' : s === 'REJECTED' || s === 'REVOKED' ? 'hot' : 'sun') as 'ok' | 'hot' | 'sun';

export default function FactsPage({ me }: { me: Member }) {
  const canPropose = me.role === 'ADMIN' || me.role === 'SUPER_ADMIN' || me.role === 'REVIEWER_COMPLIANCE';
  if (!canPropose) return <NoAccess eyebrow="Tahap D — fakta" title="Sumber & fakta">Pengelolaan sumber dan fakta publik dibatasi untuk Admin, Reviewer Kepatuhan, dan Super Admin. Kreator memilih fakta yang sudah disetujui langsung dari halaman Kreatif.</NoAccess>;
  return <Facts me={me} />;
}

function Facts({ me }: { me: Member }) {
  const sources = useListComplianceSources({ query: { queryKey: getListComplianceSourcesQueryKey(), ...LIVE } });
  const facts = useListPublicFacts({ query: { queryKey: getListPublicFactsQueryKey(), ...LIVE } });
  const [proposeFrom, setProposeFrom] = useState<ComplianceSource | null>(null);
  return (
    <>
      <PageHead eyebrow="Tahap D — fakta" title="Sumber & fakta">
        Baca kutipan asli sebelum mengusulkan atau memverifikasi fakta. Persetujuan fakta dan kebijakan sumber hanya oleh Reviewer Kepatuhan atau Super Admin, dan tidak oleh pengusulnya sendiri.
      </PageHead>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="Sumber kepatuhan" eyebrow={`${sources.data?.length ?? 0} sumber`}>
          {sources.isLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
            : sources.isError ? <ErrorBox message={errMsg(sources.error)} onRetry={() => sources.refetch()} />
            : !sources.data?.length ? <Empty>Belum ada sumber kepatuhan yang terdaftar.</Empty>
            : <ul className="space-y-3">{sources.data.map((s) => <SourceRow key={s.id} s={s} me={me} onPropose={() => setProposeFrom(s)} />)}</ul>}
        </Panel>
        <div className="space-y-6">
          {proposeFrom && <FactForm key={proposeFrom.id} source={proposeFrom} onClose={() => setProposeFrom(null)} />}
          <Panel title="Fakta publik" eyebrow={`${facts.data?.filter((f) => f.usable).length ?? 0} dapat dipakai`}>
            {facts.isLoading ? <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
              : facts.isError ? <ErrorBox message={errMsg(facts.error)} onRetry={() => facts.refetch()} />
              : !facts.data?.length ? <Empty>Belum ada fakta. Buka sebuah sumber, baca isinya, lalu pilih Usulkan fakta.</Empty>
              : <ul className="space-y-3">{facts.data.map((f) => <FactRow key={f.id} f={f} me={me} sources={sources.data ?? []} />)}</ul>}
          </Panel>
        </div>
      </div>
    </>
  );
}

function SourceRow({ s, me, onPropose }: { s: ComplianceSource; me: Member; onPropose: () => void }) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState(false);
  return (
    <li className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/60" data-testid={`row-source-${s.id}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{s.title}</div>
          <div className="font-mono text-[10px] text-muted-foreground">{s.segment} · v{s.version} · revisi {s.revision} · {s.sha256.slice(0, 12)}</div>
        </div>
        {!s.active && <Pill>Nonaktif</Pill>}
        <Pill tone={s.validation === 'APPROVED' ? 'ok' : s.validation === 'REJECTED' ? 'hot' : 'sun'}>{validationLabel[s.validation] ?? s.validation}</Pill>
        <Pill tone={s.access === 'APPROVED_FOR_PUBLIC_CONTENT' ? 'ok' : 'muted'}>{accessLabel[s.access] ?? s.access}</Pill>
      </div>
      {s.warnings.length > 0 && <ul className="mt-2 space-y-1 text-xs text-destructive">{s.warnings.map((w) => <li key={w} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>)}</ul>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => setOpen((o) => !o)} className={btnMuted} data-testid={`button-read-source-${s.id}`}>{open ? 'Tutup isi' : 'Baca isi lengkap'}</button>
        <button onClick={onPropose} className={btnMuted} data-testid={`button-propose-fact-${s.id}`}><Plus className="h-4 w-4" /> Usulkan fakta</button>
        {isReviewerRole(me) && <button onClick={() => setPolicy((p) => !p)} className={btnMuted} data-testid={`button-policy-${s.id}`}>Kebijakan sumber</button>}
      </div>
      {open && <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-sans text-xs" data-testid={`text-source-content-${s.id}`}>{s.content}</pre>}
      {policy && <PolicyForm s={s} onDone={() => setPolicy(false)} />}
    </li>
  );
}

function PolicyForm({ s, onDone }: { s: ComplianceSource; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useReviewComplianceSource();
  const [validation, setValidation] = useState<SourcePolicyInputValidation>((['NEEDS_REVIEW', 'APPROVED', 'REJECTED'].includes(s.validation) ? s.validation : 'NEEDS_REVIEW') as SourcePolicyInputValidation);
  const [access, setAccess] = useState<SourcePolicyInputAccess>((s.access in accessLabel ? s.access : 'INTERNAL_RESTRICTED') as SourcePolicyInputAccess);
  const [clearWarnings, setClear] = useState(false);
  const [note, setNote] = useState('');
  const changed = validation !== s.validation || access !== s.access || clearWarnings;
  const submit = () => m.mutate({ id: s.id, data: { revision: s.revision, validation, access, clearWarnings, note: note.trim() } }, {
    onSuccess: () => { void invalidatePrefixes(qc, AFFECTED); toast({ title: 'Kebijakan sumber diperbarui' }); onDone(); },
    onError: (e) => toast({ title: errStatus(e) === 409 ? 'Sumber sudah berubah' : 'Gagal memperbarui', description: errStatus(e) === 409 ? 'Revisi sumber berbeda. Baca ulang isinya sebelum memutuskan.' : errMsg(e), variant: 'destructive' }),
  });
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-sidebar p-3 text-sidebar-foreground">
      <p className="text-xs text-sidebar-foreground/70">Satu keputusan untuk satu sumber, terikat ke revisi {s.revision}.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={validation} onChange={(e) => setValidation(e.target.value as SourcePolicyInputValidation)} className="rounded-xl bg-sidebar-accent px-3 py-2 text-sm" data-testid={`select-validation-${s.id}`}>
          {Object.entries(validationLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={access} onChange={(e) => setAccess(e.target.value as SourcePolicyInputAccess)} className="rounded-xl bg-sidebar-accent px-3 py-2 text-sm" data-testid={`select-access-${s.id}`}>
          {Object.entries(accessLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {s.warnings.length > 0 && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={clearWarnings} onChange={(e) => setClear(e.target.checked)} className="mt-0.5" data-testid={`checkbox-clear-warnings-${s.id}`} /> Hapus {s.warnings.length} peringatan. Alasannya wajib ditulis di catatan.</label>}
      <textarea rows={2} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan keputusan (minimal 10 karakter)" className="w-full rounded-xl bg-sidebar-accent px-3 py-2 text-sm outline-none" data-testid={`input-policy-note-${s.id}`} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={!changed || note.trim().length < 10 || m.isPending} className="rounded-xl bg-sidebar-primary px-4 py-2 text-sm font-semibold text-sidebar-primary-foreground disabled:opacity-50" data-testid={`button-save-policy-${s.id}`}>{m.isPending ? 'Menyimpan...' : 'Simpan keputusan'}</button>
        <button onClick={onDone} className="rounded-xl px-3 py-2 text-sm hover:bg-sidebar-accent">Batal</button>
      </div>
    </div>
  );
}

function FactForm({ source, fact, onClose }: { source: ComplianceSource; fact?: PublicFact; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreatePublicFact();
  const revise = useRevisePublicFact();
  const [claim, setClaim] = useState(fact?.claim ?? '');
  const [quote, setQuote] = useState(fact?.quote ?? '');
  const quoteFound = quote.trim().length > 0 && source.content.includes(quote.trim());
  const ok = claim.trim().length >= 10 && quote.trim().length >= 10;
  const pending = create.isPending || revise.isPending;
  const done = () => { void invalidatePrefixes(qc, AFFECTED); onClose(); };
  const onError = (e: unknown) => toast({ title: errStatus(e) === 409 ? 'Fakta sudah berubah' : 'Gagal menyimpan fakta', description: errStatus(e) === 409 ? 'Versi fakta berbeda. Muat ulang daftar.' : errMsg(e), variant: 'destructive' });
  const submit = () => {
    const body = { sourceId: source.id, claim: claim.trim(), quote: quote.trim() };
    if (fact) revise.mutate({ id: fact.id, data: { ...body, version: fact.version } }, { onSuccess: () => { toast({ title: 'Revisi fakta diajukan' }); done(); }, onError });
    else create.mutate({ data: body }, { onSuccess: () => { toast({ title: 'Fakta diusulkan', description: 'Menunggu verifikasi reviewer lain.' }); done(); }, onError });
  };
  return (
    <Panel title={fact ? `Revisi fakta v${fact.version}` : 'Usulkan fakta'} eyebrow={source.title} action={<button onClick={onClose} aria-label="Tutup" className={btnMuted}><X className="h-4 w-4" /></button>}>
      <details className="mb-3" open={!fact}>
        <summary className="cursor-pointer text-xs text-muted-foreground">Isi asli sumber (revisi {source.revision})</summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 font-sans text-xs">{source.content}</pre>
      </details>
      <div className="space-y-3">
        <Label label="Klaim" hint="10–1200 karakter"><textarea rows={2} maxLength={1200} value={claim} onChange={(e) => setClaim(e.target.value)} className={inputCls} data-testid="input-fact-claim" /></Label>
        <Label label="Kutipan asli" hint="salin persis dari sumber"><textarea rows={3} maxLength={2000} value={quote} onChange={(e) => setQuote(e.target.value)} className={inputCls} data-testid="input-fact-quote" /></Label>
        {quote.trim() && !quoteFound && <p className="text-xs text-destructive">Kutipan tidak ditemukan persis di isi sumber. Server dapat menolak.</p>}
        <button onClick={submit} disabled={!ok || pending} className={btnPrimary} data-testid="button-save-fact">{pending ? 'Menyimpan...' : fact ? 'Ajukan revisi' : 'Usulkan'}</button>
      </div>
    </Panel>
  );
}

function FactRow({ f, me, sources }: { f: PublicFact; me: Member; sources: ComplianceSource[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const review = useReviewPublicFact();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const src = sources.find((s) => s.id === f.sourceId);
  const own = f.creatorId === me.id;
  const canReview = isReviewerRole(me) && !own;
  const decide = (status: PublicFactReviewInputStatus) => review.mutate({ id: f.id, data: { version: f.version, status, note: note.trim() } }, {
    onSuccess: () => { setNote(''); void invalidatePrefixes(qc, AFFECTED); toast({ title: `Fakta: ${status}` }); },
    onError: (e) => toast({ title: errStatus(e) === 409 ? 'Fakta sudah berubah' : 'Gagal meninjau', description: errStatus(e) === 409 ? 'Muat ulang dan baca versi terbaru.' : errMsg(e), variant: 'destructive' }),
  });
  if (editing && src) return <li><FactForm source={src} fact={f} onClose={() => setEditing(false)} /></li>;
  return (
    <li className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/60" data-testid={`row-fact-${f.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={factStatusTone(f.status)} data-testid={`status-fact-${f.id}`}>{f.status}</Pill>
        {f.usable ? <Pill tone="ok">Dapat dipakai</Pill> : <Pill>Belum dapat dipakai</Pill>}
        <span className="font-mono text-[10px] text-muted-foreground">v{f.version} · {f.segment} · revisi sumber {f.sourceRevision}{own ? ' · usulan Anda' : ''}</span>
      </div>
      <p className="mt-2 text-sm font-semibold">{f.claim}</p>
      <blockquote className="mt-2 border-l-2 border-accent pl-3 text-xs text-muted-foreground">{f.quote}</blockquote>
      <div className="mt-1 text-[11px] text-muted-foreground">Sumber: {src?.title ?? f.sourceId}{src && src.revision !== f.sourceRevision ? ' · revisi sumber sudah berubah' : ''}</div>
      {f.note && <p className="mt-2 rounded-lg bg-muted p-2 text-xs">Catatan: {f.note}{f.reviewedAt ? ` · ${fmtDate(f.reviewedAt)}` : ''}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {src && <button onClick={() => setEditing(true)} className={btnMuted} data-testid={`button-revise-fact-${f.id}`}><Pencil className="h-4 w-4" /> Revisi</button>}
      </div>
      {canReview && (
        <div className="mt-3 space-y-2 rounded-xl bg-sidebar p-3 text-sidebar-foreground">
          <p className="text-xs text-sidebar-foreground/70">Bandingkan klaim dengan kutipan dan isi sumber sebelum memutuskan.</p>
          <textarea rows={2} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan keputusan (minimal 10 karakter)" className="w-full rounded-xl bg-sidebar-accent px-3 py-2 text-sm outline-none" data-testid={`input-fact-note-${f.id}`} />
          <div className="flex flex-wrap gap-2">
            {f.status !== 'APPROVED' && <button onClick={() => decide('APPROVED')} disabled={note.trim().length < 10 || review.isPending} className="inline-flex items-center gap-1 rounded-xl bg-sidebar-primary px-3 py-1.5 text-sm font-semibold text-sidebar-primary-foreground disabled:opacity-50" data-testid={`button-approve-fact-${f.id}`}><Check className="h-4 w-4" /> Setujui</button>}
            {f.status !== 'APPROVED' && f.status !== 'REJECTED' && <button onClick={() => decide('REJECTED')} disabled={note.trim().length < 10 || review.isPending} className={btnDanger} data-testid={`button-reject-fact-${f.id}`}>Tolak</button>}
            {f.status === 'APPROVED' && <button onClick={() => decide('REVOKED')} disabled={note.trim().length < 10 || review.isPending} className={btnDanger} data-testid={`button-revoke-fact-${f.id}`}>Cabut</button>}
          </div>
        </div>
      )}
      {own && isReviewerRole(me) && <p className="mt-2 text-[11px] text-muted-foreground">Usulan Anda sendiri harus diverifikasi reviewer lain.</p>}
    </li>
  );
}
