import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Pencil } from 'lucide-react';
import {
  useGetCreativeLibrary,
  getGetCreativeLibraryQueryKey,
  useCreateCreativeCategory,
  useUpdateCreativeCategory,
  useCreateCreativeTemplate,
  useUpdateCreativeTemplate,
} from '@workspace/api-client-react';
import type { Member, CreativeCategory, CreativeTemplate, CreativeTemplateInput, CreativeSegment } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { errMsg, errStatus } from '@/lib/labels';
import { segmentLabel } from '@/lib/creative';
import { cn } from '@/lib/utils';

const inputCls = 'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40';
const SEGS: CreativeSegment[] = ['MIKRO', 'MINI', 'REGULAR', 'NONE'];

function conflictMsg(e: unknown) {
  return errStatus(e) === 409 ? 'Data ini sudah diubah orang lain (konflik versi). Tutup, muat ulang daftar, lalu ulangi perubahan Anda.' : errMsg(e);
}

export default function CreativeLibrary({ me }: { me: Member }) {
  const allowed = me.role === 'SUPER_ADMIN' || me.role === 'ADMIN';
  const lib = useGetCreativeLibrary();
  const [cat, setCat] = useState<CreativeCategory | 'new' | null>(null);
  const [tpl, setTpl] = useState<CreativeTemplate | 'new' | null>(null);

  if (!allowed) {
    return (
      <>
        <PageHead eyebrow="Pustaka kreatif" title="Akses terbatas">Hanya Super Admin dan Admin yang dapat mengelola kategori dan template.</PageHead>
        <Link href="/creative" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm text-background" data-testid="link-back-creative"><ArrowLeft className="h-4 w-4" /> Kembali ke Kreatif</Link>
      </>
    );
  }

  const cats = lib.data?.categories ?? [];
  const catName = (id: string) => cats.find((c) => c.id === id)?.name ?? 'Kategori tidak dikenal';

  return (
    <>
      <Link href="/creative" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-creative"><ArrowLeft className="h-4 w-4" /> Penyusun konsep</Link>
      <PageHead eyebrow="Admin — pustaka kreatif" title="Kategori & template">
        Nonaktifkan alih-alih menghapus agar konsep lama tetap utuh. Setiap perubahan berversi; template harus netral tanpa spesifikasi, biaya, atau janji keuntungan.
      </PageHead>
      {lib.isError ? <ErrorBox message={errMsg(lib.error)} onRetry={() => lib.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <section aria-labelledby="h-cat">
            <div className="flex items-center justify-between">
              <h2 id="h-cat" className="font-display text-xl font-bold">Kategori</h2>
              <button onClick={() => setCat('new')} data-testid="button-add-category" className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Tambah</button>
            </div>
            {lib.isLoading ? <Skeleton className="mt-3 h-64 rounded-2xl" /> : (
              <ul className="mt-3 divide-y overflow-hidden rounded-2xl bg-card ring-1 ring-card-border">
                {cats.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3" data-testid={`row-category-${c.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate text-sm font-medium', !c.active && 'text-muted-foreground line-through')}>{c.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">v{c.version}</div>
                    </div>
                    {!c.active && <Pill>Nonaktif</Pill>}
                    <button onClick={() => setCat(c)} aria-label={`Ubah ${c.name}`} data-testid={`button-edit-category-${c.id}`} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"><Pencil className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
                {!cats.length && <li className="px-4 py-6 text-sm text-muted-foreground">Belum ada kategori.</li>}
              </ul>
            )}
          </section>
          <section aria-labelledby="h-tpl">
            <div className="flex items-center justify-between">
              <h2 id="h-tpl" className="font-display text-xl font-bold">Template</h2>
              <button onClick={() => setTpl('new')} disabled={!cats.length} data-testid="button-add-template" className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Tambah</button>
            </div>
            {lib.isLoading ? <Skeleton className="mt-3 h-64 rounded-2xl" /> : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {lib.data?.templates.map((t) => (
                  <button key={t.id} onClick={() => setTpl(t)} data-testid={`card-template-${t.id}`} className={cn('rounded-2xl bg-card p-4 text-left ring-1 ring-card-border transition-transform hover:-translate-y-0.5', !t.active && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-display text-base font-bold">{t.name}</div>
                      <span className="font-mono text-[10px] text-muted-foreground">v{t.version}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{catName(t.categoryId)} · {t.style === 'UGC' ? 'UGC' : 'Cinematic'}</div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{t.description || 'Tanpa deskripsi.'}</p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {t.segments.map((s) => <Pill key={s}>{segmentLabel[s]}</Pill>)}
                      {!t.active && <Pill tone="hot">Nonaktif</Pill>}
                    </div>
                  </button>
                ))}
                {!lib.data?.templates.length && <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground sm:col-span-2">Belum ada template.</p>}
              </div>
            )}
          </section>
        </div>
      )}
      {cat && <CategoryDialog value={cat} onClose={() => setCat(null)} />}
      {tpl && <TemplateDialog value={tpl} categories={cats} onClose={() => setTpl(null)} />}
    </>
  );
}

function CategoryDialog({ value, onClose }: { value: CreativeCategory | 'new'; onClose: () => void }) {
  const isNew = value === 'new';
  const [name, setName] = useState(isNew ? '' : value.name);
  const [active, setActive] = useState(isNew ? true : value.active);
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCreativeCategory();
  const update = useUpdateCreativeCategory();
  const err = create.error ?? update.error;
  const pending = create.isPending || update.isPending;
  const done = () => { void qc.invalidateQueries({ queryKey: getGetCreativeLibraryQueryKey() }); toast({ title: 'Kategori tersimpan' }); onClose(); };
  const submit = () => {
    if (!name.trim()) return;
    if (isNew) create.mutate({ data: { name: name.trim(), active } }, { onSuccess: done });
    else update.mutate({ id: value.id, data: { name: name.trim(), active, version: value.version } }, { onSuccess: done });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[24px]">
        <DialogHeader><DialogTitle className="font-display">{isNew ? 'Kategori baru' : 'Ubah kategori'}</DialogTitle><DialogDescription>{isNew ? 'Nama singkat yang mudah dikenali kreator.' : `Versi saat ini v${value.version}.`}</DialogDescription></DialogHeader>
        <label className="text-sm font-medium">Nama<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={cn(inputCls, 'mt-1')} data-testid="input-category-name" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="checkbox-category-active" /> Aktif (tidak dicentang = nonaktif)</label>
        {err && <p role="alert" className="text-sm text-destructive">{conflictMsg(err)}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm hover:bg-muted" data-testid="button-cancel-category">Batal</button>
          <button onClick={submit} disabled={pending || !name.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-category">{pending ? 'Menyimpan...' : 'Simpan'}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TEXT_FIELDS: { k: keyof CreativeTemplateInput; label: string; max: number; rows: number }[] = [
  { k: 'description', label: 'Deskripsi', max: 2000, rows: 2 },
  { k: 'scenes', label: 'Adegan', max: 4000, rows: 3 },
  { k: 'characterMotion', label: 'Gerakan karakter', max: 2000, rows: 2 },
  { k: 'cameraMotion', label: 'Gerakan kamera', max: 2000, rows: 2 },
  { k: 'visual', label: 'Visual', max: 2000, rows: 2 },
  { k: 'narration', label: 'Narasi', max: 4000, rows: 3 },
  { k: 'cta', label: 'CTA', max: 1000, rows: 1 },
];

function TemplateDialog({ value, categories, onClose }: { value: CreativeTemplate | 'new'; categories: CreativeCategory[]; onClose: () => void }) {
  const isNew = value === 'new';
  const [f, setF] = useState<CreativeTemplateInput>(isNew ? {
    name: '', categoryId: categories.find((c) => c.active)?.id ?? categories[0]?.id ?? '', segments: ['MIKRO'], style: 'UGC',
    description: '', scenes: '', characterMotion: '', cameraMotion: '', visual: '', narration: '', cta: '', active: true,
  } : {
    name: value.name, categoryId: value.categoryId, segments: [...value.segments], style: value.style, description: value.description,
    scenes: value.scenes, characterMotion: value.characterMotion, cameraMotion: value.cameraMotion, visual: value.visual,
    narration: value.narration, cta: value.cta, active: value.active,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateCreativeTemplate();
  const update = useUpdateCreativeTemplate();
  const err = create.error ?? update.error;
  const pending = create.isPending || update.isPending;
  const toggle = (s: CreativeSegment) => setF((p) => {
    const has = p.segments.includes(s);
    const next = has ? p.segments.filter((x) => x !== s) : [...p.segments, s];
    return { ...p, segments: next.length ? next : p.segments };
  });
  const done = () => { void qc.invalidateQueries({ queryKey: getGetCreativeLibraryQueryKey() }); toast({ title: 'Template tersimpan' }); onClose(); };
  const submit = () => {
    if (!f.name.trim() || !f.categoryId) return;
    const data = { ...f, name: f.name.trim() };
    if (isNew) create.mutate({ data }, { onSuccess: done });
    else update.mutate({ id: value.id, data: { ...data, version: value.version } }, { onSuccess: done });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-[24px] sm:max-w-2xl">
        <DialogHeader><DialogTitle className="font-display">{isNew ? 'Template baru' : 'Ubah template'}</DialogTitle><DialogDescription>{isNew ? 'Isi netral. Hindari klaim produk, harga, atau janji hasil.' : `Versi saat ini v${value.version}. Konsep lama tetap menyimpan snapshotnya.`}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">Nama<input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} className={cn(inputCls, 'mt-1')} data-testid="input-template-name" /></label>
          <label className="text-sm font-medium">Kategori
            <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} className={cn(inputCls, 'mt-1')} data-testid="select-template-category">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (nonaktif)'}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Gaya
            <select value={f.style} onChange={(e) => setF({ ...f, style: e.target.value as CreativeTemplateInput['style'] })} className={cn(inputCls, 'mt-1')} data-testid="select-template-style">
              <option value="UGC">UGC</option><option value="CINEMATIC">Cinematic</option>
            </select>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Segmen</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {SEGS.map((s) => (
                <button type="button" key={s} onClick={() => toggle(s)} aria-pressed={f.segments.includes(s)} data-testid={`toggle-template-segment-${s}`} className={cn('rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-border', f.segments.includes(s) ? 'bg-foreground text-background ring-foreground' : 'hover:bg-muted')}>{segmentLabel[s]}</button>
              ))}
            </div>
          </fieldset>
          {TEXT_FIELDS.map((t) => (
            <label key={t.k} className="text-sm font-medium sm:col-span-2">{t.label}
              <textarea rows={t.rows} maxLength={t.max} value={f[t.k] as string} onChange={(e) => setF({ ...f, [t.k]: e.target.value })} className={cn(inputCls, 'mt-1 resize-y')} data-testid={`input-template-${t.k}`} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} data-testid="checkbox-template-active" /> Aktif (tidak dicentang = nonaktif, tidak muncul untuk kreator)</label>
        </div>
        {err && <p role="alert" className="text-sm text-destructive">{conflictMsg(err)}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm hover:bg-muted" data-testid="button-cancel-template">Batal</button>
          <button onClick={submit} disabled={pending || !f.name.trim() || !f.categoryId} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-save-template">{pending ? 'Menyimpan...' : 'Simpan'}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
