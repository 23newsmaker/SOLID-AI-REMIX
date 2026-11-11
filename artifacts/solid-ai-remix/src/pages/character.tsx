import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2, ShieldCheck } from 'lucide-react';
import {
  useGetCharacter,
  useRequestCharacterUpload,
  useSaveCharacter,
  useDeleteCharacter,
  getGetCharacterQueryKey,
  getGetOverviewQueryKey,
  getGetActivityQueryKey,
} from '@workspace/api-client-react';
import type { Member, UploadInputContentType } from '@workspace/api-client-react';
import { PageHead, ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { errMsg, fmtDate } from '@/lib/labels';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 5 * 1024 * 1024;

export default function CharacterPage({ me }: { me: Member }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const ch = useGetCharacter();
  const reqUpload = useRequestCharacterUpload();
  const save = useSaveCharacter();
  const del = useDeleteCharacter();
  const character = ch.data?.character ?? null;
  const readOnly = me.role === 'VIEWER';

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [fileErr, setFileErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'replace' | 'delete' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const reset = () => { setEditing(false); setFile(null); setConsent(false); setFileErr(''); setName(''); };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetCharacterQueryKey() });
    qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
    qc.invalidateQueries({ queryKey: getGetActivityQueryKey() });
  };

  const pick = (f?: File) => {
    setFileErr('');
    if (!f) return;
    if (!TYPES.includes(f.type)) { setFileErr('Format harus JPG, PNG, atau WebP.'); return; }
    if (f.size > MAX) { setFileErr('Ukuran maksimal 5 MB.'); return; }
    setFile(f);
  };

  const doSave = async () => {
    if (!file || !consent || !name.trim()) return;
    setBusy(true);
    try {
      const ticket = await reqUpload.mutateAsync({ data: { name: file.name.slice(0, 200), size: file.size, contentType: file.type as UploadInputContentType } });
      const put = await fetch(ticket.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Unggahan foto gagal. Coba lagi.');
      await save.mutateAsync({ data: { name: name.trim(), uploadId: ticket.uploadId, consent: true } });
      toast({ title: 'Karakter tersimpan' });
      reset();
      refresh();
    } catch (e) {
      toast({ title: 'Gagal menyimpan', description: errMsg(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const submit = () => (character ? setConfirm('replace') : void doSave());

  const doDelete = () => {
    del.mutate(undefined, {
      onSuccess: () => { toast({ title: 'Karakter dihapus' }); refresh(); },
      onError: (e) => toast({ title: 'Gagal menghapus', description: errMsg(e), variant: 'destructive' }),
    });
  };

  const startEdit = () => { setName(character?.name ?? me.name); setEditing(true); };
  const canSubmit = !!file && consent && name.trim().length > 0 && name.trim().length <= 80 && !busy;

  return (
    <>
      <PageHead eyebrow="Karakter pribadi" title="Wajah Anda, izin Anda.">
        Satu karakter per orang. Hanya Anda yang bisa melihatnya. Menyimpan foto di sini bukan pelatihan wajah.
      </PageHead>

      {ch.isLoading ? <Skeleton className="h-80 rounded-[28px]" /> : ch.isError ? (
        <ErrorBox message={errMsg(ch.error)} onRetry={() => ch.refetch()} />
      ) : !editing ? (
        <div className="grid gap-6 md:grid-cols-[300px_1fr]">
          <div className="aspect-[3/4] overflow-hidden rounded-[28px] bg-muted ring-1 ring-card-border">
            {character ? (
              <img src={character.photoUrl} alt={`Foto karakter ${character.name}`} className="h-full w-full object-cover" data-testid="img-character" />
            ) : (
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Belum ada foto karakter.</div>
            )}
          </div>
          <div className="flex flex-col">
            {character ? (
              <>
                <Pill tone="ok" className="w-fit">Siap dipakai nanti</Pill>
                <h2 className="font-display mt-4 text-4xl font-extrabold" data-testid="text-character-name">{character.name}</h2>
                <dl className="mt-4 space-y-1 font-mono text-xs text-muted-foreground">
                  <div>Diperbarui {fmtDate(character.updatedAt)}</div>
                  <div>Izin diberikan {fmtDate(character.consentAt)}</div>
                </dl>
              </>
            ) : (
              <>
                <h2 className="font-display text-3xl font-extrabold">Mulai dengan satu foto.</h2>
                <p className="mt-2 text-muted-foreground">Wajah jelas, menghadap depan, cahaya cukup. Foto harus milik Anda sendiri.</p>
              </>
            )}
            {readOnly ? (
              <p className="mt-6 rounded-xl bg-muted p-4 text-sm text-muted-foreground" data-testid="text-viewer-note">Peran Pengamat tidak dapat mengunggah karakter. Minta Super Admin mengubah peran Anda bila perlu.</p>
            ) : (
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={startEdit} data-testid="button-edit-character" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
                  <ImagePlus className="h-4 w-4" aria-hidden="true" /> {character ? 'Ganti foto' : 'Unggah foto'}
                </button>
                {character && (
                  <button onClick={() => setConfirm('delete')} disabled={del.isPending} data-testid="button-delete-character" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-destructive ring-1 ring-destructive/30 hover:bg-destructive/5 disabled:opacity-60">
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Hapus
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="grid gap-6 md:grid-cols-[300px_1fr]">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}
            data-testid="button-pick-photo"
            className="aspect-[3/4] overflow-hidden rounded-[28px] border-2 border-dashed border-input bg-card text-sm text-muted-foreground hover:border-primary"
          >
            {preview ? <img src={preview} alt="Pratinjau foto baru" className="h-full w-full object-cover" /> : (
              <span className="flex flex-col items-center gap-2 p-6"><ImagePlus className="h-7 w-7" aria-hidden="true" />Pilih atau tarik foto<span className="font-mono text-[10px] uppercase">JPG, PNG, WebP — maks 5 MB</span></span>
            )}
          </button>
          <input ref={inputRef} type="file" accept={TYPES.join(',')} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} data-testid="input-photo" aria-label="Pilih foto karakter" />
          <div className="space-y-5">
            {fileErr && <p role="alert" className="text-sm text-destructive">{fileErr}</p>}
            <label className="block">
              <span className="text-sm font-medium">Nama karakter</span>
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="input-character-name" className="mt-1.5 w-full rounded-xl bg-card px-4 py-3 ring-1 ring-input focus:outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="flex gap-3 rounded-2xl bg-accent/20 p-4 text-sm">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="checkbox-consent" className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(11_80%_50%)]" />
              <span>
                <ShieldCheck className="mr-1 inline h-4 w-4" aria-hidden="true" />
                Saya menyatakan foto ini adalah wajah saya sendiri atau saya memiliki hak dan izin dari orang yang difoto. Saya mengizinkan Solid Gold menggunakannya untuk membuat konten AI pemasaran yang dapat dipublikasikan. Penyimpanan ini bukan pelatihan wajah; pada Tahap A foto belum dikirim ke penyedia video. Saya bisa menghapus karakter tersimpan kapan saja.
              </span>
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={!canSubmit} data-testid="button-save-character" className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {busy ? 'Menyimpan...' : 'Simpan karakter'}
              </button>
              <button type="button" onClick={reset} disabled={busy} data-testid="button-cancel" className="rounded-xl px-6 py-3 text-sm ring-1 ring-border hover:bg-muted">Batal</button>
            </div>
          </div>
        </form>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'delete' ? 'Hapus karakter?' : 'Ganti foto karakter?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete' ? 'Foto dan karakter Anda akan dihapus permanen.' : 'Foto lama akan digantikan foto baru ini.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Batal</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-ok"
              className={confirm === 'delete' ? 'bg-destructive text-destructive-foreground' : ''}
              onClick={() => { const c = confirm; setConfirm(null); if (c === 'delete') doDelete(); else void doSave(); }}
            >
              {confirm === 'delete' ? 'Hapus' : 'Ganti'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
