import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { getVideoConfig, type StudioFolder, type CreativeSegment, type VideoRenderOptionsMotion } from '@workspace/api-client-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { StudioCharacter } from './character';
import { StudioMaterials } from './materials';
import { StudioHistory } from './history';
import { useWorkspace } from './use-workspace';
import { errMsg } from '@/lib/labels';
import { motionLabel } from '@/lib/video';

export function StudioWorkspace({ folder, onUsageChange }: { folder: StudioFolder; onUsageChange: () => void }) {
  const [, navigate] = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const cfg = useQuery({ queryKey: ['shared', folder.id, 'config', refreshKey], queryFn: () => getVideoConfig({ headers: { 'X-Solid-Folder': folder.id } }), retry: false, refetchOnWindowFocus: true });
  function refresh() { setRefreshKey(value => value + 1); onUsageChange(); }
  const w = useWorkspace(folder, refresh);
  async function back() {
    if (w.busy || w.saving) return;
    if (w.pendingFiles && !window.confirm('Ada bahan yang belum selesai diunggah. Tinggalkan pilihan file lokal dan kembali ke folder?')) return;
    try {
      if (w.dirty) {
        if (w.character) await w.saveDraft();
        else if (!window.confirm('Naskah belum tersimpan karena karakter belum disiapkan. Tetap kembali?')) return;
      }
      navigate('/studio');
    } catch (e) { w.setError(errMsg(e)); }
  }
  const remaining = Math.max(0, (cfg.data?.dailyLimit ?? folder.dailyLimit) - (cfg.data?.dailyUsed ?? folder.dailyUsed));
  if (w.loading) return <main className="ss-frame ss-main" role="status">Memuat ruang kerja {folder.name}...</main>;
  if (w.loadError) return <main className="ss-frame ss-main"><p role="alert">{errMsg(w.loadError)}</p><button className="ss-btn" onClick={() => navigate('/studio')}>Folder anggota</button></main>;
  return <main className="ss-frame ss-main">
    <button className="ss-text-btn ss-crumb" onClick={() => void back()} disabled={w.busy || w.saving}><ArrowLeft size={14} />Folder anggota / {folder.name}</button>
    <div className="ss-title-row"><div><p className="ss-eyebrow">Folder {folder.name}</p><h1 className="ss-title">Dari ide jadi video.</h1>
      <p className="ss-intro">Satu alur, memakai karakter tersimpan. Pembuat memeriksa hasilnya sendiri.</p></div><span className="ss-fixed-chip">Hemat · 9:16</span></div>
    <div className="ss-create-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}><div className="ss-form-card">
      <StudioCharacter folderId={folder.id} name={folder.name} character={w.character} onSaved={w.characterSaved} />
      <section className="ss-form-section">
        <div className="ss-step-head"><span className="ss-step-num">2</span><h2>Naskah & tampilan</h2></div>
        <label className="ss-field"><span className="ss-label">Naskah yang ditampilkan sebagai subtitle</span>
          <textarea className="ss-textarea" rows={5} maxLength={4000} value={w.form.narration} onChange={e => w.patch({ narration: e.target.value, subtitle: e.target.value })} disabled={w.busy} placeholder="Tulis naskah pendek milikmu. Naskah tidak diubah otomatis." data-testid="input-studio-script" />
        </label>
        <p className="ss-helper" role="status">{w.saving ? 'Menyimpan otomatis...' : w.dirty ? 'Ada perubahan belum tersimpan.' : w.concept ? 'Tersimpan otomatis.' : 'Karakter dan naskah akan disimpan bersama konsep.'}</p>
        {!!w.form.subtitle && w.form.subtitle !== w.form.narration && <p className="ss-warning">Konsep lama memiliki subtitle terpisah. Saat naskah diedit di sini, subtitle akan mengikuti naskah baru.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="ss-field"><span className="ss-label">Durasi</span><select value={w.form.durationSeconds} onChange={e => w.patch({ durationSeconds: Number(e.target.value) })} disabled={w.busy}>{[10, 11, 12, 13, 14, 15].map(n => <option value={n} key={n}>{n} detik</option>)}</select></label>
          <label className="ss-field"><span className="ss-label">Topik produk</span><select value={w.form.segments[0]} onChange={e => w.patch({ segments: [e.target.value as CreativeSegment] })} disabled={w.busy}>
            <option value="NONE">Umum / perusahaan</option><option value="MIKRO">Mikro</option><option value="MINI">Mini</option><option value="REGULAR">Regular</option>
          </select></label>
        </div>
        <details className="ss-tech">
          <summary>Referensi KB opsional</summary>
          <p className="ss-helper">Cocok berdasarkan topik/segmen, bukan pemahaman atau verifikasi naskah. Tidak perlu dipilih; hasil bukan persetujuan perusahaan.</p>
          {w.referenceError ? <p className="ss-helper">Referensi belum dapat dimuat. Pembuatan video tetap tersedia.</p>
            : w.referencesLoading ? <p className="ss-helper">Memuat referensi opsional...</p>
            : w.references.filter(s => s.segment === 'COMPANY' || w.form.segments.includes(s.segment as CreativeSegment)).slice(0, 3).map(s => <p className="ss-helper" key={s.id}>{s.title} · {s.sourceId} · {s.version}</p>)}
          {!w.referencesLoading && !w.referenceError && !w.references.some(s => s.segment === 'COMPANY' || w.form.segments.includes(s.segment as CreativeSegment)) && <p className="ss-helper">Belum ada rujukan yang cocok. Ini bukan verifikasi faktual berhasil dan tidak menghalangi video.</p>}
          {w.concept?.warnings.filter(message => message.startsWith('Rujukan KB tersimpan')).map(message => <p className="ss-helper" key={message}>{message}</p>)}
        </details>
        {showDetails && <details className="ss-tech"><summary>Pengaturan tambahan</summary><div className="ss-tech-content">
          <label className="ss-field"><span className="ss-label">Kategori konten</span><select value={w.form.categoryId} onChange={e => w.patch({ categoryId: e.target.value, templateId: null })}><option value="">Kategori aktif bawaan</option>{w.library?.categories.filter(c => c.active).map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
          {w.form.templateId && <button className="ss-text-btn" onClick={() => w.patch({ templateId: null })}>Lepaskan template lama, pakai naskah sendiri</button>}
          <label className="ss-field"><span className="ss-label">Gerakan kamera</span><select value={w.renderOptions.motion} onChange={e => w.setRenderOptions({ ...w.renderOptions, motion: e.target.value as VideoRenderOptionsMotion })}>{Object.entries(motionLabel).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          <label className="ss-field"><span className="ss-label">Arahan visual (catatan, bukan perintah ke model AI)</span><textarea rows={2} value={w.form.direction} maxLength={8000} onChange={e => w.patch({ direction: e.target.value })} /></label>
          <label className="ss-field"><span className="ss-label">Tujuan konten</span><input maxLength={2000} value={w.form.purpose} onChange={e => w.patch({ purpose: e.target.value })} /></label>
          <label className="ss-field"><span className="ss-label">Adegan</span><textarea rows={2} maxLength={4000} value={w.form.scenes} onChange={e => w.patch({ scenes: e.target.value })} /></label>
        </div></details>}
      </section>
      <StudioMaterials folderId={folder.id} concept={w.concept} saveDraft={w.saveDraft} onUpdated={w.acceptConcept} onPending={w.onPending} />
      <section className="ss-form-section">
        {w.error && <p className="ss-alert" role="alert">{w.error}</p>}
        {(w.error || showDetails) && <button type="button" className="ss-text-btn" onClick={() => setShowDetails(value => !value)}>{showDetails ? 'Tutup rincian' : 'Periksa rincian naskah'}</button>}
        {cfg.isError && <p className="ss-alert" role="alert">{errMsg(cfg.error)}</p>}
        <button className="ss-btn gold" onClick={() => void w.prepare()} disabled={w.busy || w.pendingFiles || !w.character || !remaining || !!cfg.data?.paused || !cfg.data} data-testid="button-studio-summary">{w.busy ? 'Memeriksa...' : 'Periksa ringkasan'}<ArrowRight size={16} /></button>
      </section>
    </div></div>
    <StudioHistory folderId={folder.id} refreshKey={refreshKey} currentVersion={w.concept?.version ?? 0} currentConceptId={w.concept?.id ?? null} dirty={w.dirty || w.saving}
      onNewVersion={id => { void w.versionFrom(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
    <AlertDialog open={w.summary} onOpenChange={w.setSummary}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Buat video untuk {folder.name}?</AlertDialogTitle>
        <AlertDialogDescription>Mode Hemat · 9:16 · {w.form.durationSeconds} detik. Foto karakter dan bahan diproses oleh compositor lokal; tidak dikirim ke provider AI. Video tanpa logo tempelan; caption, CTA, dan disclaimer ditambahkan manual sebelum posting. Proses ini memakai satu kuota harian, termasuk jika gagal atau dibatalkan. CPU/storage tetap dapat berbiaya; totalnya belum terukur.</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel><AlertDialogAction onClick={() => void w.render()} disabled={w.busy} data-testid="button-confirm-studio-render">Konfirmasi & buat video</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </main>;
}
