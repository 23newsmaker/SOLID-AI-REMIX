import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, Ban, Check, ChevronDown, Clapperboard, FileText, ImageIcon, Library, Lock, Plus, RotateCcw, Save, Send, Trash2, Upload, Video, X,
} from 'lucide-react';
import {
  useGetCreativeLibrary,
  useListCreativeConcepts,
  getListCreativeConceptsQueryKey,
  useGetCreativeConcept,
  getGetCreativeConceptQueryKey,
  useGetCharacter,
  useGetOverview,
  useListKnowledge,
  usePreviewCreativePrompt,
  useCreateCreativeConcept,
  useUpdateCreativeConcept,
  useDeleteCreativeConcept,
  useTransitionCreativeConcept,
  useRequestConceptUpload,
  useFinalizeConceptUpload,
  useDeleteConceptAttachment,
} from '@workspace/api-client-react';
import type {
  Member, CreativeConcept, CreativeConceptInput, CreativeLibrary, CreativePreview, CreativeSegment, ConceptAttachment, ConceptUploadInputContentType,
  ListKnowledgeMode, ListKnowledgeSegment, CreativeStatusInputStatus,
} from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { errMsg, errStatus, fmtDate } from '@/lib/labels';
import {
  segmentLabel, conceptStatusLabel, conceptStatusTone, reviewActionLabel, emptyInput, toInput, prettyPrompt, fmtBytes, toggleSegment,
} from '@/lib/creative';
import { cn } from '@/lib/utils';

const inputCls = 'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/40';
const SEGS: CreativeSegment[] = ['MIKRO', 'MINI', 'REGULAR', 'NONE'];
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AUDIO_TYPES = ['audio/mpeg', 'audio/wav'];
const AUDIO_MAX = 5 * 1048576;
type View = 'edit' | 'summary' | 'prompt';

export default function CreativePage({ me }: { me: Member }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lib = useGetCreativeLibrary();
  const list = useListCreativeConcepts();
  const ch = useGetCharacter();
  const overview = useGetOverview();
  const character = ch.data?.character ?? null;
  const canWrite = me.role !== 'VIEWER';
  const isAdmin = me.role === 'SUPER_ADMIN' || me.role === 'ADMIN';

  const conceptSearch = useSearch();
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(conceptSearch).get('concept'));
  const detail = useGetCreativeConcept(selectedId ?? '', { query: { enabled: !!selectedId, refetchOnWindowFocus: true, queryKey: getGetCreativeConceptQueryKey(selectedId ?? '') } });
  const [form, setForm] = useState<CreativeConceptInput>(() => emptyInput());
  const [concept, setConcept] = useState<CreativeConcept | null>(null);
  const [view, setView] = useState<View>('edit');
  const [preview, setPreview] = useState<CreativePreview | null>(null);
  const [conflict, setConflict] = useState(false);
  const loadedFor = useRef<string | null>(null);

  // set own character once available for a fresh form
  useEffect(() => {
    if (character && !concept && !form.characterId) setForm((f) => ({ ...f, characterId: character.id }));
  }, [character, concept, form.characterId]);

  // load selected own concept into form exactly once per id
  const readOnly = !detail.isError && detail.data && (detail.data.ownerId !== me.id || !canWrite) ? detail.data : null;
  useEffect(() => { setPreview(null); }, [form]);
  useEffect(() => {
    const d = detail.data;
    if (!d || d.id !== selectedId || loadedFor.current === d.id) return;
    loadedFor.current = d.id;
    if (d.ownerId === me.id) {
      setConcept(d);
      setForm(toInput(d));
      setPreview(null);
      setConflict(false);
      setView('summary');
    }
  }, [detail.data, selectedId, me.id]);

  const dirty = useMemo(() => !concept || JSON.stringify(toInput(concept)) !== JSON.stringify(form), [concept, form]);
  const myCount = (list.data ?? []).filter((c) => c.ownerId === me.id).length;
  const atLimit = !!lib.data && myCount >= lib.data.maxConcepts;

  const create = useCreateCreativeConcept();
  const update = useUpdateCreativeConcept();
  const previewM = usePreviewCreativePrompt();
  const del = useDeleteCreativeConcept();
  const transition = useTransitionCreativeConcept();

  const applySaved = (c: CreativeConcept) => {
    setConcept(c);
    setPreview(null);
    loadedFor.current = c.id;
    setSelectedId(c.id);
    setForm((f) => ({ ...f, materialConsent: c.materialConsent }));
    qc.setQueryData(getGetCreativeConceptQueryKey(c.id), c);
    void qc.invalidateQueries({ queryKey: getListCreativeConceptsQueryKey() });
  };

  const newConcept = () => {
    setSelectedId(null);
    loadedFor.current = null;
    setConcept(null);
    setForm(emptyInput(character?.id ?? ''));
    setPreview(null);
    setConflict(false);
    setView('edit');
  };

  const validation = useMemo(() => {
    const m: string[] = [];
    if (!form.title.trim()) m.push('Judul wajib diisi.');
    if (!form.characterId) m.push('Karakter milik Anda wajib ada.');
    if (!form.categoryId) m.push('Pilih kategori.');
    if (!form.segments.length) m.push('Pilih minimal satu segmen.');
    return m;
  }, [form]);

  const save = () => {
    if (validation.length) { toast({ title: 'Belum bisa disimpan', description: validation[0], variant: 'destructive' }); return; }
    const onError = (e: unknown) => {
      if (errStatus(e) === 409) { setConflict(true); return; }
      toast({ title: 'Gagal menyimpan', description: errMsg(e), variant: 'destructive' });
    };
    if (concept) {
      update.mutate({ id: concept.id, data: { ...form, version: concept.version } }, {
        onSuccess: (c) => { applySaved(c); setConflict(false); toast({ title: 'Draft tersimpan', description: `Versi ${c.version}` }); },
        onError,
      });
    } else {
      create.mutate({ data: form }, {
        onSuccess: (c) => { applySaved(c); toast({ title: 'Konsep tersimpan', description: 'Bisa dibuka lagi dari riwayat.' }); },
        onError,
      });
    }
  };

  const runPreview = () => {
    if (validation.length) { toast({ title: 'Lengkapi dulu', description: validation[0], variant: 'destructive' }); return; }
    if (concept && !dirty) { setPreview(null); setView('prompt'); return; }
    previewM.mutate({ data: form }, {
      onSuccess: (p) => { setPreview(p); setView('prompt'); },
      onError: (e) => toast({ title: 'Pratinjau gagal', description: errMsg(e), variant: 'destructive' }),
    });
  };

  const reloadServer = async () => {
    if (!concept) return;
    const r = await detail.refetch();
    if (r.data) { setConcept(r.data); setForm(toInput(r.data)); setConflict(false); toast({ title: 'Versi server dimuat', description: `Versi ${r.data.version}` }); }
  };

  const doTransition = (c: CreativeConcept, status: CreativeStatusInputStatus, note: string, after?: (c: CreativeConcept) => void) => {
    transition.mutate({ id: c.id, data: { version: c.version, status, note } }, {
      onSuccess: (n) => {
        qc.setQueryData(getGetCreativeConceptQueryKey(n.id), n);
        void qc.invalidateQueries({ queryKey: getListCreativeConceptsQueryKey() });
        after?.(n);
        toast({ title: `Status: ${conceptStatusLabel[n.status]}` });
      },
      onError: (e) => toast({ title: errStatus(e) === 409 ? 'Konflik versi' : 'Gagal mengubah status', description: errStatus(e) === 409 ? 'Konsep sudah berubah. Muat ulang lalu coba lagi.' : errMsg(e), variant: 'destructive' }),
    });
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const doDelete = () => {
    if (!concept) return;
    del.mutate({ id: concept.id, data: { version: concept.version } }, {
      onSuccess: () => {
        qc.removeQueries({ queryKey: getGetCreativeConceptQueryKey(concept.id) });
        void qc.invalidateQueries({ queryKey: getListCreativeConceptsQueryKey() });
        toast({ title: 'Konsep dihapus' });
        newConcept();
      },
      onError: (e) => toast({ title: errStatus(e) === 409 ? 'Konflik versi' : 'Gagal menghapus', description: errStatus(e) === 409 ? 'Konsep sudah berubah. Muat versi server dulu.' : errMsg(e), variant: 'destructive' }),
    });
  };

  const saving = create.isPending || update.isPending;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHead eyebrow="Tahap B — penyusun konsep" title="Kreatif">
          Susun konsep dan prompt video pemasaran dari karakter Anda. Tidak ada video yang dibuat di sini.
        </PageHead>
        {isAdmin && (
          <Link href="/creative/library" data-testid="link-creative-library" className="inline-flex items-center gap-2 rounded-xl bg-card px-4 py-2 text-sm font-medium ring-1 ring-card-border hover:bg-muted">
            <Library className="h-4 w-4" /> Kelola pustaka
          </Link>
        )}
      </div>

      <FactsNotice publicCount={overview.data?.approvedPublicCount} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {readOnly ? (
            <><button onClick={() => void detail.refetch()} className="mb-3 rounded-xl bg-muted px-4 py-2 text-sm" data-testid="button-refresh-review">Muat ulang izin dan versi review</button><ReadOnlyConcept c={readOnly} me={me} onBack={newConcept} onTransition={doTransition} pending={transition.isPending} /></>
          ) : selectedId && detail.isLoading && !concept ? (
            <Skeleton className="h-[480px] rounded-[28px]" />
          ) : selectedId && detail.isError && !concept ? (
            <ErrorBox message={errMsg(detail.error)} onRetry={() => detail.refetch()} />
          ) : !canWrite ? (
            <Composed icon={<Lock className="h-5 w-5" />} title="Mode baca saja">Peran Pengamat dapat membuka riwayat, tetapi tidak membuat, mengubah, mengunggah, atau meninjau konsep.</Composed>
          ) : ch.isLoading || lib.isLoading ? (
            <Skeleton className="h-[480px] rounded-[28px]" />
          ) : lib.isError ? (
            <ErrorBox message={errMsg(lib.error)} onRetry={() => lib.refetch()} />
          ) : !character && !concept ? (
            <Composed icon={<Clapperboard className="h-5 w-5" />} title="Siapkan karakter dulu">
              Konsep wajib memakai karakter milik Anda sendiri.{' '}
              <Link href="/character" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-setup-character">Buka halaman Karakter</Link>
            </Composed>
          ) : !concept && atLimit ? (
            <Composed icon={<Ban className="h-5 w-5" />} title={`Batas ${lib.data?.maxConcepts} konsep tercapai`}>Hapus konsep lama dari riwayat untuk membuat yang baru.</Composed>
          ) : lib.data && (
            <>
              <Stepper view={view} setView={setView} concept={concept} dirty={dirty} />
              {conflict && (
                <div role="alert" className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="status-conflict">
                  <div className="font-semibold text-destructive">Konflik versi — perubahan Anda belum tersimpan</div>
                  <p className="mt-1 text-muted-foreground">Konsep ini sudah berubah di server (misalnya dari tab lain atau unggahan). Isian Anda tetap ada di layar. Salin teks penting Anda, lalu muat versi server bila ingin melanjutkan.</p>
                  <button onClick={reloadServer} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background" data-testid="button-load-server">
                    <RotateCcw className="h-3.5 w-3.5" /> Muat versi server (isian lokal diganti)
                  </button>
                </div>
              )}
              <div key={view} className="rise">
                {view === 'edit' && (character
                  ? <Editor form={form} setForm={setForm} lib={lib.data} character={character} onNext={() => setView('summary')} validation={validation} toast={toast} />
                  : <Composed icon={<AlertTriangle className="h-5 w-5" />} title="Karakter sudah dihapus">Konsep lama tetap dapat dibaca atau dihapus. <Link href="/character" className="underline">Siapkan karakter baru</Link> sebelum menyimpan perubahan.</Composed>)}
                {view === 'summary' && (
                  <div className="rounded-[28px] bg-card p-5 ring-1 ring-card-border md:p-7">
                    {concept && !dirty
                      ? <SummaryGrid input={form} categoryName={concept.categoryName} templateName={concept.templateName ?? 'Tanpa template'} characterName={concept.characterName} attachments={concept.attachments} />
                      : <SummaryBody input={form} lib={lib.data} characterName={character?.name ?? concept?.characterName ?? 'Karakter dihapus'} attachments={concept?.attachments ?? []} />}
                    {concept && (
                      <>
                        <StatusBlock c={concept} dirty={dirty} />
                        <Attachments concept={concept} lib={lib.data} dirty={dirty} onUpdated={(c) => { applySaved(c); setForm((f) => ({ ...f, materialConsent: c.materialConsent })); }} />
                        <OwnerReview c={concept} form={form} setForm={setForm} dirty={dirty} pending={transition.isPending}
                          onSubmit={() => doTransition(concept, 'READY_FOR_REVIEW', '', (n) => setConcept(n))}
                          onRetract={() => doTransition(concept, 'DRAFT', '', (n) => setConcept(n))} />
                        <Reviews c={concept} />
                      </>
                    )}
                    {!concept && <p className="mt-6 rounded-xl bg-muted p-3 text-xs text-muted-foreground">Simpan draft terlebih dahulu untuk mengunggah bahan dan mengajukan review.</p>}
                  </div>
                )}
                {view === 'prompt' && <PromptPanel preview={preview} concept={concept} dirty={dirty} onRefresh={runPreview} refreshing={previewM.isPending} />}
              </div>

              <div className="sticky bottom-24 z-20 mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-sidebar p-2 text-sidebar-foreground shadow-lg md:bottom-4">
                {view !== 'edit' && <button onClick={() => setView('edit')} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm hover:bg-sidebar-accent" data-testid="button-edit-concept"><ArrowLeft className="h-4 w-4" /> Edit Konsep</button>}
                {view === 'edit' && <button onClick={() => setView('summary')} className="rounded-xl px-3 py-2 text-sm hover:bg-sidebar-accent" data-testid="button-to-summary">Ringkasan</button>}
                <button onClick={save} disabled={saving || !character || (!!concept && !dirty)} className="inline-flex items-center gap-1.5 rounded-xl bg-sidebar-primary px-3 py-2 text-sm font-semibold text-sidebar-primary-foreground disabled:opacity-50" data-testid="button-save-draft">
                  <Save className="h-4 w-4" /> {saving ? 'Menyimpan...' : concept && !dirty ? 'Tersimpan' : 'Simpan Draft'}
                </button>
                <button onClick={runPreview} disabled={previewM.isPending} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm hover:bg-sidebar-accent disabled:opacity-50" data-testid="button-view-prompt">
                  <FileText className="h-4 w-4" /> {previewM.isPending ? 'Menyusun...' : 'Lihat Prompt Akhir'}
                </button>
                {concept && concept.status === 'APPROVED' && !concept.stale && !dirty ? (
                  <Link href={`/videos?concept=${concept.id}`} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm hover:bg-sidebar-accent" data-testid="button-generate-video">
                    <Video className="h-4 w-4" /> Buat Video
                  </Link>
                ) : (
                  <span title="Butuh konsep tersimpan yang disetujui reviewer dan tidak usang" className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/40" data-testid="button-generate-video">
                    <Video className="h-4 w-4" /> Buat Video <span className="font-mono text-[10px] uppercase">perlu disetujui</span>
                  </span>
                )}
                <span className="flex-1" />
                {concept && <button onClick={() => {
                  if (!dirty || window.confirm('Ganti isian lokal dengan versi terbaru dari server?')) void reloadServer();
                }} className="rounded-xl px-3 py-2 text-xs hover:bg-sidebar-accent" data-testid="button-reload-concept">Muat versi server</button>}
                {concept && <button onClick={() => setConfirmDelete(true)} aria-label="Hapus konsep" className="grid h-9 w-9 place-items-center rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" data-testid="button-delete-concept"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </>
          )}
        </div>

        <History list={list} me={me} selectedId={selectedId} onSelect={(id) => { if (id !== selectedId) { loadedFor.current = null; setConcept(null); setSelectedId(id); } }} onNew={newConcept} canWrite={canWrite} max={lib.data?.maxConcepts} myCount={myCount} />
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Hapus konsep ini?</AlertDialogTitle>
            <AlertDialogDescription>Konsep, prompt, dan seluruh bahan pendukungnya akan dihapus permanen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground" data-testid="button-confirm-delete">Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function FactsNotice({ publicCount }: { publicCount?: number }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-accent/25 p-4 text-sm ring-1 ring-accent/50" data-testid="notice-facts">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p><span className="font-semibold">{publicCount === 0 ? 'Saat ini nol sumber publik yang disetujui.' : publicCount === undefined ? 'Status sumber publik harus diperiksa di server.' : `${publicCount} sumber disetujui untuk publik; kesesuaian per segmen tetap wajib diperiksa.`}</span> Klaim faktual tanpa rujukan publik yang sesuai akan diberi peringatan atau diblokir. Semua isi wajib diperiksa manusia dan tidak boleh disebut aman secara otomatis.</p>
    </div>
  );
}

function Composed({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-dashed bg-card/60 p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sidebar text-sidebar-primary">{icon}</div>
      <div className="font-display mt-4 text-2xl font-extrabold">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Stepper({ view, setView, concept, dirty }: { view: View; setView: (v: View) => void; concept: CreativeConcept | null; dirty: boolean }) {
  const steps: { v: View; l: string }[] = [{ v: 'edit', l: 'Susun' }, { v: 'summary', l: 'Ringkasan' }, { v: 'prompt', l: 'Prompt' }];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-full bg-muted p-1" role="tablist">
        {steps.map((s, i) => (
          <button key={s.v} role="tab" aria-selected={view === s.v} onClick={() => setView(s.v)} data-testid={`tab-${s.v}`}
            className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition-colors', view === s.v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
            <span className="mr-1.5 font-mono text-[10px] opacity-60">0{i + 1}</span>{s.l}
          </button>
        ))}
      </div>
      <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-save-state">
        {concept ? `v${concept.version} · ${dirty ? 'perubahan belum disimpan' : 'tersimpan'}` : 'belum disimpan'}
      </span>
    </div>
  );
}

function Unvalidated() {
  return <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-primary">belum divalidasi</span>;
}

function Field({ label, hint, free, children }: { label: string; hint?: string; free?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center text-sm font-medium">{label}{free && <Unvalidated />}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

type ToastFn = ReturnType<typeof useToast>['toast'];

function Editor({ form, setForm, lib, character, onNext, validation, toast }: {
  form: CreativeConceptInput; setForm: React.Dispatch<React.SetStateAction<CreativeConceptInput>>; lib: CreativeLibrary;
  character: { id: string; name: string; photoUrl: string }; onNext: () => void; validation: string[]; toast: ToastFn;
}) {
  const [adv, setAdv] = useState(false);
  const set = <K extends keyof CreativeConceptInput>(k: K, v: CreativeConceptInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const cats = lib.categories.filter((c) => c.active || c.id === form.categoryId);
  const templates = lib.templates.filter((t) => t.categoryId === form.categoryId && t.style === form.style && form.segments.every(s => t.segments.includes(s)) && (t.active || t.id === form.templateId));

  const pickTemplate = (id: string) => {
    if (!id) { set('templateId', null); return; }
    const t = lib.templates.find((x) => x.id === id);
    if (!t) return;
    setForm((f) => ({ ...f, templateId: t.id, style: t.style, scenes: t.scenes, characterMotion: t.characterMotion, cameraMotion: t.cameraMotion, visual: t.visual, narration: t.narration, cta: t.cta }));
    toast({ title: `Template "${t.name}" diterapkan`, description: 'Adegan, gerakan, visual, narasi, dan CTA diisi dari template. Arahan bebas Anda tidak diubah.' });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-[28px] bg-sidebar p-4 text-sidebar-foreground">
        <img src={character.photoUrl} alt={`Foto karakter ${character.name}`} className="h-20 w-16 shrink-0 rounded-2xl object-cover" data-testid="img-own-character" />
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/60">Karakter Anda</div>
          <div className="font-display truncate text-2xl font-extrabold" data-testid="text-concept-character">{character.name}</div>
          <div className="text-xs text-sidebar-foreground/60">Hanya karakter milik Anda yang dapat dipakai.</div>
          {form.characterId !== character.id && <button onClick={() => set('characterId', character.id)} className="mt-2 rounded-lg bg-sidebar-primary px-3 py-1 text-xs text-sidebar-primary-foreground">Gunakan karakter ini untuk mengganti rujukan lama</button>}
        </div>
      </div>

      <div className="space-y-4 rounded-[28px] bg-card p-5 ring-1 ring-card-border md:p-6">
        <Field label="Judul konsep"><input value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Contoh: Pagi di pasar bersama karakter" className={inputCls} data-testid="input-title" /></Field>

        <Field label="Kategori">
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button type="button" key={c.id} onClick={() => setForm((f) => ({ ...f, categoryId: c.id, templateId: f.categoryId === c.id ? f.templateId : null }))} aria-pressed={form.categoryId === c.id} data-testid={`chip-category-${c.id}`}
                className={cn('rounded-full px-3.5 py-1.5 text-sm ring-1 ring-border transition-colors', form.categoryId === c.id ? 'bg-primary text-primary-foreground ring-primary' : 'hover:bg-muted')}>{c.name}</button>
            ))}
            {!cats.length && <span className="text-sm text-muted-foreground">Belum ada kategori aktif. Hubungi Admin.</span>}
          </div>
        </Field>

        <Field label="Segmen" hint="Pilih satu atau beberapa. Tidak terkait produk bersifat eksklusif.">
          <div className="flex flex-wrap gap-2">
            {SEGS.map((s) => (
              <button type="button" key={s} onClick={() => setForm(f => {
                const segments = toggleSegment(f.segments, s);
                const template = lib.templates.find(t => t.id === f.templateId);
                return { ...f, segments, templateId: template && !segments.every(x => template.segments.includes(x)) ? null : f.templateId };
              })} aria-pressed={form.segments.includes(s)} data-testid={`toggle-segment-${s}`}
                className={cn('rounded-full px-3.5 py-1.5 text-sm ring-1 ring-border transition-colors', form.segments.includes(s) ? 'bg-foreground text-background ring-foreground' : 'hover:bg-muted', s === 'NONE' && 'border-l')}>{segmentLabel[s]}</button>
            ))}
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gaya">
            <Segmented value={form.style} onChange={(v) => setForm((f) => ({ ...f, style: v, templateId: lib.templates.find((t) => t.id === f.templateId)?.style === v ? f.templateId : null }))} options={[{ v: 'UGC', l: 'UGC' }, { v: 'CINEMATIC', l: 'Cinematic' }]} testid="style" />
          </Field>
          <Field label="Mode">
            <Segmented value={form.mode} onChange={(v) => set('mode', v)} options={[{ v: 'HEMAT', l: 'Hemat' }, { v: 'AI', l: 'AI' }]} testid="mode" />
          </Field>
        </div>

        <Field label="Ide / template" hint={form.categoryId ? 'Template mengisi adegan, gerakan, visual, narasi, dan CTA.' : 'Pilih kategori untuk melihat template.'}>
          <select value={form.templateId ?? ''} onChange={(e) => pickTemplate(e.target.value)} disabled={!form.categoryId} className={inputCls} data-testid="select-template">
            <option value="">Tanpa template (ide sendiri)</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (nonaktif)'}</option>)}
          </select>
        </Field>

        <Field label="Tujuan" free><textarea rows={2} maxLength={2000} value={form.purpose} onChange={(e) => set('purpose', e.target.value)} className={inputCls} data-testid="input-purpose" /></Field>
        <Field label="Arahan bebas" hint="Disimpan persis seperti ditulis. Tidak dipahami atau diperiksa oleh AI." free>
          <textarea rows={4} maxLength={8000} value={form.direction} onChange={(e) => set('direction', e.target.value)} className={inputCls} data-testid="input-direction" />
          <span className="mt-1 block text-right font-mono text-[10px] text-muted-foreground">{form.direction.length}/8000</span>
        </Field>
      </div>

      <div className="overflow-hidden rounded-[28px] bg-card ring-1 ring-card-border">
        <button type="button" onClick={() => setAdv((a) => !a)} aria-expanded={adv} className="flex w-full items-center justify-between px-5 py-4 text-left md:px-6" data-testid="button-toggle-advanced">
          <span><span className="font-display text-lg font-bold">Pengaturan lanjutan</span><span className="block text-xs text-muted-foreground">Adegan, narasi, CTA, format, durasi, sumber pengetahuan</span></span>
          <ChevronDown className={cn('h-5 w-5 transition-transform', adv && 'rotate-180')} />
        </button>
        {adv && (
          <div className="rise space-y-4 border-t px-5 py-5 md:px-6">
            {([
              ['scenes', 'Adegan', 4000, 3], ['characterMotion', 'Gerakan karakter', 2000, 2], ['cameraMotion', 'Gerakan kamera', 2000, 2],
              ['visual', 'Visual', 2000, 2], ['narration', 'Narasi', 4000, 3], ['subtitle', 'Subtitle (maks 108 kata untuk video)', 4000, 2], ['cta', 'CTA (maks 90 karakter untuk video)', 1000, 1], ['disclaimer', 'Disclaimer (wajib untuk video, maks 220 karakter)', 220, 2],
            ] as const).map(([k, l, max, rows]) => (
              <Field key={k} label={l} free><textarea rows={rows} maxLength={max} value={form[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={inputCls} data-testid={`input-${k}`} /></Field>
            ))}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Format" hint="Metadata target, bukan kemampuan provider.">
                <select value={form.format} onChange={(e) => set('format', e.target.value as CreativeConceptInput['format'])} className={inputCls} data-testid="select-format">
                  <option value="9:16">9:16 vertikal</option><option value="16:9">16:9 horizontal</option><option value="1:1">1:1 persegi</option>
                </select>
              </Field>
              <Field label="Durasi target (detik)" hint="1–120 detik, metadata saja.">
                <input type="number" min={1} max={120} value={form.durationSeconds} onChange={(e) => set('durationSeconds', Math.max(1, Math.min(120, Number(e.target.value) || 1)))} className={inputCls} data-testid="input-duration" />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.publicMode} onChange={(e) => set('publicMode', e.target.checked)} className="mt-1" data-testid="checkbox-public-mode" /> <span>Mode publik (untuk pemasaran ke publik). Hanya fakta publik yang disetujui boleh dipakai.</span></label>
            <Sources form={form} setForm={setForm} />
          </div>
        )}
      </div>

      {validation.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground" data-testid="list-validation">{validation.map((v) => <li key={v}>· {v}</li>)}</ul>}
      <button onClick={onNext} className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5" data-testid="button-next-summary">Lanjut ke ringkasan</button>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, testid }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[]; testid: string }) {
  return (
    <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button type="button" key={o.v} onClick={() => onChange(o.v)} aria-pressed={value === o.v} data-testid={`toggle-${testid}-${o.v}`}
          className={cn('rounded-lg py-1.5 text-sm font-medium transition-colors', value === o.v ? 'bg-card shadow-sm ring-1 ring-card-border' : 'text-muted-foreground')}>{o.l}</button>
      ))}
    </div>
  );
}

function Sources({ form, setForm }: { form: CreativeConceptInput; setForm: React.Dispatch<React.SetStateAction<CreativeConceptInput>> }) {
  const [mode, setMode] = useState<ListKnowledgeMode>('PUBLIC');
  const [segment, setSegment] = useState<ListKnowledgeSegment>('ALL');
  const [q, setQ] = useState('');
  const kb = useListKnowledge({ mode, segment, q: q.trim() || undefined });
  const toggle = (id: string) => setForm((f) => ({ ...f, sourceIds: f.sourceIds.includes(id) ? f.sourceIds.filter((x) => x !== id) : f.sourceIds.length >= 12 ? f.sourceIds : [...f.sourceIds, id] }));
  return (
    <div className="rounded-2xl bg-muted/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Sumber pengetahuan (opsional)</div>
        <span className="font-mono text-[11px] text-muted-foreground">{form.sourceIds.length}/12 dipilih</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[auto_auto_1fr]">
        <Segmented value={mode} onChange={(v) => setMode(v)} options={[{ v: 'PUBLIC', l: 'Publik' }, { v: 'INTERNAL', l: 'Internal' }]} testid="kb-mode" />
        <select value={segment} onChange={(e) => setSegment(e.target.value as ListKnowledgeSegment)} className={inputCls} data-testid="select-kb-segment">
          <option value="ALL">Semua</option><option value="COMPANY">Perusahaan</option><option value="MIKRO">Mikro</option><option value="MINI">Mini</option><option value="REGULAR">Regular</option>
        </select>
        <input value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul sumber" className={inputCls} data-testid="input-kb-search" />
      </div>
      {kb.data?.notice && <p className="mt-2 text-xs text-muted-foreground">{kb.data.notice}</p>}
      <p className="mt-1 text-xs text-muted-foreground">Memilih sumber tidak menyetujuinya. Persetujuan publik tetap ditentukan server.</p>
      {kb.isLoading ? <Skeleton className="mt-3 h-24 rounded-xl" /> : kb.isError ? <div className="mt-3"><ErrorBox message={errMsg(kb.error)} onRetry={() => kb.refetch()} /></div> : (
        <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {kb.data?.items.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-card px-3 py-2 text-sm ring-1 ring-card-border" data-testid={`row-source-${s.id}`}>
                <input type="checkbox" checked={form.sourceIds.includes(s.id)} onChange={() => toggle(s.id)} className="mt-1" data-testid={`checkbox-source-${s.id}`} />
                <span className="min-w-0 flex-1"><span className="block truncate">{s.title}</span><span className="font-mono text-[10px] text-muted-foreground">{s.segment} · {s.validation} · {s.access} · v{s.version}</span></span>
              </label>
            </li>
          ))}
          {!kb.data?.items.length && <li className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Tidak ada sumber untuk filter ini.</li>}
        </ul>
      )}
    </div>
  );
}

function SummaryBody({ input, lib, characterName, attachments }: { input: CreativeConceptInput; lib?: CreativeLibrary; characterName: string; attachments: ConceptAttachment[]; }) {
  const cat = lib?.categories.find((c) => c.id === input.categoryId)?.name ?? '—';
  const tpl = input.templateId ? lib?.templates.find((t) => t.id === input.templateId)?.name ?? 'Template' : 'Tanpa template';
  return <SummaryGrid input={input} categoryName={cat} templateName={tpl} characterName={characterName} attachments={attachments} />;
}

function SummaryGrid({ input, categoryName, templateName, characterName, attachments }: { input: CreativeConceptInput; categoryName: string; templateName: string; characterName: string; attachments: ConceptAttachment[] }) {
  const meta: [string, string][] = [
    ['Karakter', characterName], ['Kategori', categoryName], ['Segmen', input.segments.map((s) => segmentLabel[s]).join(', ')],
    ['Gaya', input.style === 'UGC' ? 'UGC' : 'Cinematic'], ['Mode', input.mode === 'HEMAT' ? 'Hemat' : 'AI'], ['Template', templateName],
    ['Format', `${input.format} (metadata)`], ['Durasi target', `${input.durationSeconds} detik (metadata)`], ['Mode publik', input.publicMode ? 'Ya' : 'Tidak'],
    ['Sumber dipilih', `${input.sourceIds.length}`], ['Bahan', `${attachments.length} file`], ['Izin bahan publik', input.materialConsent ? 'Dinyatakan' : 'Belum'],
  ];
  const texts: [string, string][] = [
    ['Tujuan', input.purpose], ['Arahan bebas', input.direction], ['Adegan', input.scenes], ['Gerakan karakter', input.characterMotion], ['Gerakan kamera', input.cameraMotion],
    ['Visual', input.visual], ['Narasi', input.narration], ['Subtitle', input.subtitle], ['CTA', input.cta], ['Disclaimer', input.disclaimer ?? ''],
  ];
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Ringkasan konsep</div>
      <h2 className="font-display mt-1 text-3xl font-extrabold" data-testid="text-summary-title">{input.title || 'Tanpa judul'}</h2>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {meta.map(([k, v]) => <div key={k}><dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="text-sm font-medium">{v}</dd></div>)}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Format dan durasi hanya metadata target, bukan kemampuan provider yang sudah terbukti.</p>
      <div className="mt-6 space-y-3">
        {texts.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-background/60 p-3 ring-1 ring-border/60">
            <div className="flex items-center text-xs font-semibold">{k}{v && <Unvalidated />}</div>
            <p className={cn('mt-1 whitespace-pre-wrap break-words text-sm', !v && 'text-muted-foreground')}>{v || 'Kosong'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Issues({ warnings, blockers }: { warnings: string[]; blockers: string[] }) {
  if (!warnings.length && !blockers.length) return null;
  return (
    <div className="mt-4 space-y-2">
      {blockers.map((b, i) => <div key={`b${i}`} className="flex gap-2 rounded-xl bg-destructive/8 p-3 text-sm text-destructive" data-testid={`text-blocker-${i}`}><Ban className="mt-0.5 h-4 w-4 shrink-0" />{b}</div>)}
      {warnings.map((w, i) => <div key={`w${i}`} className="flex gap-2 rounded-xl bg-accent/25 p-3 text-sm" data-testid={`text-warning-${i}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</div>)}
      {blockers.length > 0 && <p className="text-xs text-muted-foreground">Draft tetap bisa disimpan, tetapi belum siap produksi.</p>}
    </div>
  );
}

function PromptPanel({ preview, concept, dirty, onRefresh, refreshing }: { preview: CreativePreview | null; concept: CreativeConcept | null; dirty: boolean; onRefresh: () => void; refreshing: boolean }) {
  const src = concept && !dirty ? concept : preview;
  return (
    <div className="rounded-[28px] bg-sidebar p-5 text-sidebar-foreground md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-sidebar-primary">Prompt akhir — deterministik</div>
          <p className="text-xs text-sidebar-foreground/60">{concept && !dirty ? 'Prompt dari versi tersimpan, termasuk bahan yang sudah difinalisasi.' : 'Pratinjau isian belum tersimpan; bahan terlampir hanya masuk prompt setelah Simpan Draft.'}</p>
        </div>
        <button onClick={onRefresh} disabled={refreshing} className="rounded-lg bg-sidebar-accent px-3 py-1.5 text-xs disabled:opacity-50" data-testid="button-refresh-prompt">{refreshing ? 'Menyusun...' : 'Susun ulang dari isian'}</button>
      </div>
      {src ? (
        <>
          <pre className="mt-4 max-h-[520px] overflow-auto rounded-2xl bg-black/25 p-4 font-mono text-[12px] leading-relaxed" data-testid="text-prompt">{prettyPrompt(src.prompt)}</pre>
          <div className="text-foreground"><Issues warnings={src.warnings} blockers={src.blockers} /></div>
        </>
      ) : <p className="mt-6 text-sm text-sidebar-foreground/70">Tekan "Susun ulang dari isian" untuk melihat prompt.</p>}
    </div>
  );
}

function StatusBlock({ c, dirty }: { c: CreativeConcept; dirty: boolean }) {
  return (
    <div className="mt-6 rounded-2xl bg-muted/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={conceptStatusTone[c.status]} data-testid="status-concept">{conceptStatusLabel[c.status]}</Pill>
        <span className="font-mono text-[11px] text-muted-foreground">v{c.version} · diperbarui {fmtDate(c.updatedAt)}</span>
        {c.status === 'APPROVED' && !c.stale && <span className="text-xs text-muted-foreground">Mengubah isi akan mengembalikan ke Draft.</span>}
      </div>
      {c.stale && (
        <div className="mt-3 rounded-xl bg-destructive/8 p-3 text-sm text-destructive" data-testid="status-stale">
          <div className="font-semibold">{c.status === 'APPROVED' ? 'Persetujuan usang — belum siap produksi' : 'Data acuan sudah berubah'}</div>
          <ul className="mt-1 list-inside list-disc">{c.staleReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {dirty && <p className="mt-2 text-xs text-primary">Ada perubahan yang belum disimpan.</p>}
      <Issues warnings={c.warnings} blockers={c.blockers} />
    </div>
  );
}

function OwnerReview({ c, form, setForm, dirty, pending, onSubmit, onRetract }: {
  c: CreativeConcept; form: CreativeConceptInput; setForm: React.Dispatch<React.SetStateAction<CreativeConceptInput>>; dirty: boolean; pending: boolean; onSubmit: () => void; onRetract: () => void;
}) {
  const canSubmit = (c.status === 'DRAFT' || c.status === 'REJECTED');
  const hasPending = c.attachments.some((a) => a.state === 'PENDING');
  return (
    <div className="mt-6 rounded-2xl ring-1 ring-border p-4">
      <div className="font-display text-lg font-bold">Pengajuan review</div>
      {canSubmit && (
        <>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={form.materialConsent} onChange={(e) => setForm((f) => ({ ...f, materialConsent: e.target.checked }))} className="mt-1" data-testid="checkbox-material-consent" />
            <span>{hasPending ? 'Ada unggahan tertunda; review diblokir. ' : ''}Segmen produk tanpa fakta publik yang disetujui dapat diblokir server; konsep Tidak terkait produk tetap bisa diajukan untuk review manual. Saya menyatakan bahan dan isi konsep ini boleh dipakai untuk publik. Reviewer tetap wajib memeriksa.</span>
          </label>
          {dirty && <p className="mt-2 text-xs text-muted-foreground">Simpan Draft dulu agar pernyataan dan perubahan tercatat sebelum diajukan.</p>}
          <button onClick={onSubmit} disabled={pending || dirty || hasPending || !c.materialConsent} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-submit-review">
            <Send className="h-4 w-4" /> Ajukan review
          </button>
        </>
      )}
      {c.status === 'READY_FOR_REVIEW' && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">Menunggu reviewer kepatuhan. Anda tidak dapat menyetujui konsep sendiri.</p>
          <button onClick={onRetract} disabled={pending} className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm disabled:opacity-50" data-testid="button-retract"><RotateCcw className="h-4 w-4" /> Tarik ke Draft</button>
        </div>
      )}
      {c.status === 'APPROVED' && <p className="mt-2 text-sm text-muted-foreground">Disetujui reviewer. Perubahan isi atau bahan akan membatalkan persetujuan.</p>}
    </div>
  );
}

function Reviews({ c }: { c: CreativeConcept }) {
  if (!c.reviews.length) return null;
  return (
    <div className="mt-6">
      <div className="font-display text-lg font-bold">Jejak review</div>
      <ol className="mt-2 space-y-2">
        {c.reviews.map((r) => (
          <li key={r.id} className="rounded-xl bg-background/60 px-3 py-2 text-sm ring-1 ring-border/60" data-testid={`row-review-${r.id}`}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] uppercase text-primary">{reviewActionLabel[r.action] ?? r.action}</span><span className="font-mono text-[10px] text-muted-foreground">v{r.version} · {fmtDate(r.createdAt)}</span></div>
            {r.note && <p className="mt-1 whitespace-pre-wrap">{r.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function AttachmentPreview({ a }: { a: ConceptAttachment }) {
  if (a.state === 'PENDING' || !a.url) return <div className="grid aspect-square w-full place-items-center rounded-xl bg-muted p-2 text-center text-[11px] text-muted-foreground" data-testid={`status-attachment-pending-${a.id}`}>Tertunda — belum selesai diunggah. Hapus lalu ulangi.</div>;
  if (a.contentType.startsWith('audio/')) return <div className="grid aspect-square w-full place-items-center rounded-xl bg-sidebar p-2"><audio src={a.url} controls preload="metadata" className="w-full" data-testid={`audio-attachment-${a.id}`} /></div>;
  return a.contentType.startsWith('video/')
    ? <video src={a.url} controls preload="metadata" className="aspect-[9/16] w-full rounded-xl bg-black/80 object-contain" data-testid={`video-attachment-${a.id}`} />
    : <img src={a.url} alt={a.name} className="aspect-square w-full rounded-xl object-cover" data-testid={`img-attachment-${a.id}`} />;
}

function Attachments({ concept, lib, dirty, onUpdated }: { concept: CreativeConcept; lib: CreativeLibrary; dirty: boolean; onUpdated: (c: CreativeConcept) => void }) {
  const { toast } = useToast();
  const reqUp = useRequestConceptUpload();
  const fin = useFinalizeConceptUpload();
  const delA = useDeleteConceptAttachment();
  const [busy, setBusy] = useState<{ name: string; size: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imgs = concept.attachments.filter((a) => a.contentType.startsWith('image/')).length;
  const vids = concept.attachments.filter((a) => a.contentType.startsWith('video/')).length;
  const auds = concept.attachments.filter((a) => a.contentType.startsWith('audio/')).length;
  const pendingCount = concept.attachments.filter((a) => a.state === 'PENDING').length;
  const total = concept.attachments.reduce((s, a) => s + a.size, 0) + (busy?.size ?? 0);

  const upload = async (file: File): Promise<void> => {
    const isImg = IMG_TYPES.includes(file.type);
    const isVid = file.type === 'video/mp4';
    const isAud = AUDIO_TYPES.includes(file.type);
    const fail = (d: string): void => { toast({ title: 'Bahan ditolak', description: d, variant: 'destructive' }); };
    if (!isImg && !isVid && !isAud) return fail('Hanya JPG, PNG, WebP, MP4, MP3, atau WAV.');
    if (isAud && auds >= 1) return fail('Maksimal 1 audio.');
    if (isAud && file.size > AUDIO_MAX) return fail(`Audio maksimal ${fmtBytes(AUDIO_MAX)}.`);
    if (isImg && imgs >= lib.maxImages) return fail(`Maksimal ${lib.maxImages} gambar.`);
    if (isVid && vids >= lib.maxVideos) return fail(`Maksimal ${lib.maxVideos} video.`);
    if (isImg && file.size > lib.maxImageBytes) return fail(`Gambar maksimal ${fmtBytes(lib.maxImageBytes)}.`);
    if (isVid && file.size > lib.maxVideoBytes) return fail(`Video maksimal ${fmtBytes(lib.maxVideoBytes)}.`);
    if (total + file.size > lib.maxTotalBytes) return fail(`Total bahan maksimal ${fmtBytes(lib.maxTotalBytes)}.`);
    setBusy({ name: file.name, size: file.size });
    try {
      const t = await reqUp.mutateAsync({ id: concept.id, data: { version: concept.version, name: file.name.slice(0, 200), size: file.size, contentType: file.type as ConceptUploadInputContentType } });
      const put = await fetch(t.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Unggahan ke penyimpanan gagal.');
      const c = await fin.mutateAsync({ id: concept.id, uploadId: t.uploadId, data: { version: concept.version } });
      onUpdated(c);
      toast({ title: 'Bahan ditautkan', description: 'Status kembali ke Draft dan izin bahan perlu dinyatakan ulang.' });
    } catch (e) {
      fail((errStatus(e) === 409 ? 'Konflik versi.' : errMsg(e)) + ' Gunakan Muat versi server untuk melihat dan menghapus reservasi tertunda sebelum mengulang.');
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = (a: ConceptAttachment) => {
    delA.mutate({ id: concept.id, uploadId: a.id, data: { version: concept.version } }, {
      onSuccess: (c) => { onUpdated(c); toast({ title: 'Bahan dihapus' }); },
      onError: (e) => toast({ title: 'Gagal menghapus bahan', description: errStatus(e) === 409 ? 'Konflik versi. Muat ulang konsep.' : errMsg(e), variant: 'destructive' }),
    });
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-lg font-bold">Bahan pendukung</div>
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-attachment-usage">{imgs}/{lib.maxImages} gambar · {vids}/{lib.maxVideos} video · {auds}/1 audio · {fmtBytes(total)} / {fmtBytes(lib.maxTotalBytes)}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Maks {lib.maxImages} JPG/PNG/WebP @ {fmtBytes(lib.maxImageBytes)} dan {lib.maxVideos} MP4 @ {fmtBytes(lib.maxVideoBytes)}, serta 1 audio MP3/WAV @ {fmtBytes(AUDIO_MAX)}. Audio wajib milik/berizin perusahaan; reviewer memeriksa ucapan secara manual karena tidak ada transkripsi. Bahan hanya dicatat dan dipratinjau browser — tanpa OCR, transkripsi, atau jaminan didukung provider. Mengunggah atau menghapus mengembalikan status ke Draft.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {concept.attachments.map((a) => (
          <div key={a.id} className="group relative rounded-2xl bg-background/60 p-2 ring-1 ring-border/60" data-testid={`card-attachment-${a.id}`}>
            <AttachmentPreview a={a} />
            <div className="mt-1.5 flex items-center gap-1 text-[11px]">
              {a.contentType.startsWith('video/') ? <Video className="h-3 w-3 shrink-0" /> : <ImageIcon className="h-3 w-3 shrink-0" />}
              <span className="truncate">{a.name}</span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground">{fmtBytes(a.size)}</div>
            <button onClick={() => remove(a)} disabled={delA.isPending || dirty} aria-label={`Hapus ${a.name}`} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-foreground/80 text-background disabled:opacity-40" data-testid={`button-remove-attachment-${a.id}`}><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {busy && <div className="grid aspect-square place-items-center rounded-2xl border border-dashed p-3 text-center text-xs text-muted-foreground"><span><Skeleton className="mx-auto mb-2 h-8 w-8 rounded-full" />Mengunggah {busy.name}</span></div>}
        <button onClick={() => inputRef.current?.click()} disabled={!!busy || dirty} className="grid aspect-square place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50" data-testid="button-upload-attachment">
          <span className="flex flex-col items-center gap-1"><Upload className="h-5 w-5" />Tambah bahan</span>
        </button>
      </div>
      {dirty && <p className="mt-2 text-xs text-primary">Simpan Draft dulu sebelum mengubah bahan.</p>}
      {pendingCount > 0 && <p className="mt-2 text-xs text-destructive" data-testid="text-pending-block">{pendingCount} unggahan tertunda. Hapus unggahan tertunda sebelum mengajukan review.</p>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/wav" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} data-testid="input-file-attachment" />
    </div>
  );
}

function ReadOnlyConcept({ c, me, onBack, onTransition, pending }: { c: CreativeConcept; me: Member; onBack: () => void; onTransition: (c: CreativeConcept, s: CreativeStatusInputStatus, note: string) => void; pending: boolean }) {
  const [note, setNote] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const canReview = (me.role === 'SUPER_ADMIN' || me.role === 'REVIEWER_COMPLIANCE') && c.ownerId !== me.id && c.status === 'READY_FOR_REVIEW';
  return (
    <div className="rise rounded-[28px] bg-card p-5 ring-1 ring-card-border md:p-7">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="button-back-new"><ArrowLeft className="h-4 w-4" /> Tutup</button>
        <span className="flex-1" />
        <Pill tone="ink"><Lock className="h-3 w-3" /> Baca saja · milik {c.ownerName}</Pill>
      </div>
      <SummaryGrid input={c} categoryName={c.categoryName} templateName={c.templateName ?? 'Tanpa template'} characterName={`${c.characterName} (foto pribadi tidak ditampilkan)`} attachments={c.attachments} />
      <StatusBlock c={c} dirty={false} />
      {c.attachments.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {c.attachments.map((a) => <div key={a.id} className="rounded-2xl bg-background/60 p-2 ring-1 ring-border/60"><AttachmentPreview a={a} /><div className="mt-1 truncate text-[11px]">{a.name}</div></div>)}
        </div>
      )}
      <button onClick={() => setShowPrompt((s) => !s)} className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm" data-testid="button-toggle-readonly-prompt"><FileText className="h-4 w-4" /> {showPrompt ? 'Sembunyikan prompt' : 'Lihat prompt akhir'}</button>
      {showPrompt && <pre className="rise mt-3 max-h-[480px] overflow-auto rounded-2xl bg-sidebar p-4 font-mono text-[12px] text-sidebar-foreground" data-testid="text-readonly-prompt">{prettyPrompt(c.prompt)}</pre>}
      {canReview && (
        <div className="mt-6 rounded-2xl bg-sidebar p-4 text-sidebar-foreground">
          <div className="font-display text-lg font-bold">Keputusan kepatuhan</div>
          <p className="text-xs text-sidebar-foreground/60">Periksa manual seluruh isi dan bahan. Tidak ada validasi otomatis.</p>
          <textarea value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Catatan reviewer (wajib)" className="mt-3 w-full rounded-xl bg-sidebar-accent px-3 py-2 text-sm outline-none" data-testid="input-review-note" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => onTransition(c, 'APPROVED', note.trim())} disabled={pending || !note.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-sidebar-primary px-4 py-2 text-sm font-semibold text-sidebar-primary-foreground disabled:opacity-50" data-testid="button-approve"><Check className="h-4 w-4" /> Setujui</button>
            <button onClick={() => onTransition(c, 'REJECTED', note.trim())} disabled={pending || !note.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50" data-testid="button-reject"><Ban className="h-4 w-4" /> Tolak</button>
          </div>
        </div>
      )}
      {me.role === 'ADMIN' && c.status === 'READY_FOR_REVIEW' && <p className="mt-4 text-xs text-muted-foreground">Admin mengelola pustaka tetapi bukan penyetuju kepatuhan.</p>}
      <Reviews c={c} />
    </div>
  );
}

function History({ list, me, selectedId, onSelect, onNew, canWrite, max, myCount }: {
  list: { data?: CreativeConcept[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }; me: Member; selectedId: string | null; onSelect: (id: string) => void; onNew: () => void; canWrite: boolean; max?: number; myCount: number;
}) {
  return (
    <aside aria-labelledby="h-history" className="lg:sticky lg:top-6 lg:self-start">
      <div className="flex items-center justify-between">
        <h2 id="h-history" className="font-display text-xl font-bold">Riwayat</h2>
        {canWrite && <button onClick={onNew} className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground" data-testid="button-new-concept"><Plus className="h-3.5 w-3.5" /> Baru</button>}
      </div>
      {max !== undefined && canWrite && <div className="mt-1 font-mono text-[11px] text-muted-foreground" data-testid="text-concept-quota">Milik Anda {myCount}/{max}</div>}
      {list.isLoading ? (
        <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : list.isError ? (
        <div className="mt-3"><ErrorBox message={errMsg(list.error)} onRetry={() => list.refetch()} /></div>
      ) : !list.data?.length ? (
        <p className="mt-3 rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">Belum ada konsep tersimpan.</p>
      ) : (
        <ul className="mt-3 max-h-[70dvh] space-y-2 overflow-y-auto pr-1">
          {[...list.data].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => (
            <li key={c.id}>
              <button onClick={() => onSelect(c.id)} aria-current={selectedId === c.id} data-testid={`row-concept-${c.id}`}
                className={cn('w-full rounded-2xl bg-card p-3 text-left ring-1 ring-card-border transition-transform hover:-translate-y-0.5', selectedId === c.id && 'ring-2 ring-primary')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-2 text-sm font-semibold">{c.title}</span>
                  <Pill tone={conceptStatusTone[c.status]} className="shrink-0">{conceptStatusLabel[c.status]}</Pill>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{c.ownerId === me.id ? 'Anda' : c.ownerName} · {fmtDate(c.updatedAt)}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{c.categoryName} · {c.segments.map((s) => segmentLabel[s]).join('/')} · {c.style === 'UGC' ? 'UGC' : 'Cinematic'} · {c.mode === 'HEMAT' ? 'Hemat' : 'AI'}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.templateName ?? 'Tanpa template'}{c.stale ? ' · usang' : ''}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
