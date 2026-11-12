import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import { requestCharacterUpload, saveCharacter, type Character, type UploadInputContentType } from '@workspace/api-client-react';
import { errMsg } from '@/lib/labels';

export function StudioCharacter({ folderId, name, character, onSaved }: {
  folderId: string; name: string; character: Character | null; onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false), [file, setFile] = useState<File | null>(null);
  const [characterName, setCharacterName] = useState(name);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cameraInput = useRef<HTMLInputElement>(null), galleryInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function selectPhoto(e: ChangeEvent<HTMLInputElement>) {
    const next = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // Allow retaking/reselecting the same filename.
    if (!next) return; // Cancelling the camera preserves the previous selection.
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size === 0 || next.size > 5 * 1024 * 1024) {
      setFile(null);
      setError('Gunakan foto JPG, PNG, atau WebP maksimal 5 MiB. Jika format kamera belum didukung, pilih foto JPG dari galeri.');
      return;
    }
    setFile(next);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || busy || !characterName.trim()) return;
    if (character && !window.confirm('Ganti foto karakter aktif? Foto aktif lama akan diganti. Video lama tidak dihapus, tetapi validasi dan tanda pemeriksaannya bisa tidak berlaku lagi.')) return;
    setBusy(true); setError('');
    try {
      const options = { headers: { 'X-Solid-Folder': folderId } };
      const ticket = await requestCharacterUpload({ name: file.name.slice(0, 200), size: file.size, contentType: file.type as UploadInputContentType }, options);
      const put = await fetch(ticket.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Unggahan belum berhasil. Pilih foto dan coba lagi.');
      // Shared-studio photo permission follows the owner's internal policy.
      await saveCharacter({ name: characterName.trim(), uploadId: ticket.uploadId, consent: true }, options);
      await onSaved(); setEditing(false); setFile(null);
    } catch (failure) { setError(errMsg(failure)); }
    finally { setBusy(false); }
  }
  return <section className="ss-form-section">
    <div className="ss-step-head"><span className="ss-step-num">1</span><h2>Karakter tersimpan</h2></div>
    {character && !editing ? <div className="ss-character">
      <img src={character.photoUrl} alt={`Karakter ${character.name}`} style={{ width: 64, height: 76, objectFit: 'cover', borderRadius: 12 }} />
      <div><strong>{character.name}</strong><p className="ss-helper">Dipakai kembali dari folder {name}.</p></div>
      <button className="ss-btn outline small" onClick={() => { setCharacterName(character.name); setEditing(true); }}>Ganti foto</button>
    </div> : <form onSubmit={e => void submit(e)} className="ss-field ss-character-setup">
      <label className="ss-label" htmlFor="character-name">Nama karakter</label>
      <input id="character-name" value={characterName} onChange={e => setCharacterName(e.target.value)} maxLength={80} required disabled={busy} />
      <span className="ss-label">Foto wajah · JPG, PNG, WebP · maks. 5 MiB</span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="ss-btn" disabled={busy} onClick={() => cameraInput.current?.click()} aria-describedby="character-camera-help" data-testid="button-take-character-photo"><Camera size={18} aria-hidden="true" />Ambil foto</button>
        <button type="button" className="ss-btn outline" disabled={busy} onClick={() => galleryInput.current?.click()} data-testid="button-choose-character-photo"><ImagePlus size={18} aria-hidden="true" />Pilih galeri</button>
        <button type="submit" className="ss-btn" disabled={busy || !file || !characterName.trim()} data-testid="button-save-studio-character">{busy ? 'Menyimpan...' : 'Simpan karakter'}</button>
      </div>
      <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="user" disabled={busy} onChange={selectPhoto} hidden aria-label="Ambil foto wajah dengan kamera" data-testid="input-studio-character-camera" />
      <input ref={galleryInput} id="character-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={selectPhoto} hidden aria-label="Pilih foto wajah dari galeri" data-testid="input-studio-character-photo" />
      <p id="character-camera-help" className="ss-helper">Di HP, Ambil foto meminta kamera depan jika didukung browser. Jika kamera tidak tersedia atau di laptop, gunakan Pilih galeri/file.</p>
      {file && <div className="ss-character" aria-live="polite">
        {preview && <img src={preview} alt="Pratinjau foto karakter yang dipilih" style={{ width: 80, height: 96, objectFit: 'cover', borderRadius: 12 }} />}
        <span className="ss-helper" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{file.name}</span>
      </div>}
      {error && <p className="ss-alert" role="alert">{error}</p>}
      {character && <div className="ss-modal-actions"><button type="button" className="ss-btn outline" onClick={() => { setEditing(false); setFile(null); setError(''); }} disabled={busy}>Batal</button></div>}
    </form>}
  </section>;
}
