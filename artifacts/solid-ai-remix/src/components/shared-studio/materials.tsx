import { useState, useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import {
  requestConceptUpload, finalizeConceptUpload, deleteConceptAttachment,
  type CreativeConcept, type ConceptUploadInputContentType, type UploadTicket,
} from '@workspace/api-client-react';
import { errMsg } from '@/lib/labels';

type Pending = { id: string; file: File; failed: boolean; error?: string; ticket?: UploadTicket; conceptId?: string };
const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav'];
export function StudioMaterials({ folderId, concept, saveDraft, onUpdated, onPending }: {
  folderId: string; concept: CreativeConcept | null;
  saveDraft: () => Promise<CreativeConcept>; onUpdated: (value: CreativeConcept) => void;
  onPending: (pending: boolean) => void;
}) {
  const [queue, setQueue] = useState<Pending[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = queue.length > 0 || busy;
  useEffect(() => { onPending(pending); }, [pending, onPending]);
  const options = { headers: { 'X-Solid-Folder': folderId } };
  function pick(files: FileList | null) {
    setError('');
    const selected = Array.from(files ?? []);
    if (selected.some(f => !allowed.includes(f.type) || f.size < 1 || f.size > (f.type === 'video/mp4' ? 20 : 5) * 1024 * 1024)) {
      setError('Bahan: JPG/PNG/WebP/MP3/WAV maks. 5 MiB; MP4 maks. 20 MiB.'); return;
    }
    setQueue(old => [...old, ...selected.map(file => ({ id: crypto.randomUUID(), file, failed: false }))]);
    if (fileRef.current) fileRef.current.value = '';
  }
  async function upload() {
    if (busy || !queue.length) return;
    setBusy(true); setError('');
    try {
      let current = await saveDraft();
      for (const item of queue) {
        try {
          const ticket = item.ticket ?? await requestConceptUpload(current.id, {
            version: current.version, name: item.file.name.slice(0, 200),
            size: item.file.size, contentType: item.file.type as ConceptUploadInputContentType,
          }, options);
          setQueue(old => old.map(v => v.id === item.id ? { ...v, ticket, conceptId: current.id } : v));
          if (item.conceptId && item.conceptId !== current.id) throw new Error('Konsep berubah. Hapus bahan tertunda ini sebelum memilih ulang.');
          const put = await fetch(ticket.uploadURL, { method: 'PUT', body: item.file, headers: { 'Content-Type': item.file.type } });
          if (!put.ok) throw new Error('Pengiriman file gagal. Coba lagi sebelum tiket unggah kedaluwarsa.');
          current = await finalizeConceptUpload(current.id, ticket.uploadId, { version: current.version }, options);
          onUpdated(current);
          setQueue(old => old.filter(v => v.id !== item.id));
        } catch (failure) {
          setQueue(old => old.map(v => v.id === item.id ? { ...v, failed: true, error: errMsg(failure) } : v));
          throw failure;
        }
      }
    } catch (failure) { setError(errMsg(failure)); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const current = await saveDraft();
      onUpdated(await deleteConceptAttachment(current.id, id, { version: current.version }, options));
    } catch (failure) { setError(errMsg(failure)); }
    finally { setBusy(false); }
  }
  return <section className="ss-form-section">
    <div className="ss-step-head"><span className="ss-step-num">3</span><h2>Bahan pendukung</h2></div>
    <p className="ss-helper">Tambahkan bahan jika diperlukan. Konsep disimpan otomatis saat unggah.</p>
    <button className="ss-upload" onClick={() => fileRef.current?.click()} disabled={busy}><Plus size={20} />Foto, screenshot, video, atau rekaman suara</button>
    <input ref={fileRef} type="file" multiple accept={allowed.join(',')} hidden onChange={e => pick(e.target.files)} />
    {queue.length > 0 && <div className="ss-files">{queue.map(item => <div className="ss-file" key={item.id}>
      <span className="ss-file-name">{item.file.name}<small>{item.failed ? item.error : 'Belum diunggah'}</small></span>
      <button className="ss-remove" aria-label={`Batal memilih ${item.file.name}`} disabled={busy} onClick={() => setQueue(old => old.filter(v => v.id !== item.id))}><X size={14} /></button>
    </div>)}</div>}
    {queue.length > 0 && <button className="ss-btn small" disabled={busy} onClick={() => void upload()} data-testid="button-upload-studio-materials">{busy ? 'Mengunggah...' : 'Unggah bahan terpilih'}</button>}
    <div className="ss-files">{concept?.attachments.map(a => <div className="ss-file" key={a.id}>
      <span className="ss-file-name">{a.name}<small>{a.state === 'READY' ? 'Tersimpan' : 'Unggahan belum selesai'} · {(a.size / 1024 / 1024).toFixed(1)} MiB</small></span>
      <button className="ss-remove" aria-label={`Hapus bahan ${a.name}`} disabled={busy} onClick={() => { if (window.confirm('Hapus bahan ini dari konsep? Tanda pemeriksaan hasil lama bisa tidak berlaku lagi.')) void remove(a.id); }}><X size={14} /></button>
    </div>)}</div>
    <p className="ss-helper">Maks. 3 gambar, 1 MP4, 1 MP3/WAV; total 35 MiB. Bahan tidak dipahami oleh AI. Rekaman MP3/WAV di sini adalah narasi manual untuk video ini saja, terpisah dari sampel identitas suara karakter. Tidak ada TTS aktif.</p>
    {error && <p className="ss-alert" role="alert">{error}</p>}
  </section>;
}
