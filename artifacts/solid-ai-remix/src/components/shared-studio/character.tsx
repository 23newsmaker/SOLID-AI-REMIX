import { useState, type FormEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import { requestCharacterUpload, saveCharacter, type Character, type UploadInputContentType } from '@workspace/api-client-react';
import { errMsg } from '@/lib/labels';

export function StudioCharacter({ folderId, name, character, onSaved }: {
  folderId: string; name: string; character: Character | null; onSaved: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false), [file, setFile] = useState<File | null>(null);
  const [characterName, setCharacterName] = useState(name), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !consent || busy || !characterName.trim()) return;
    if (character && !window.confirm('Ganti foto karakter aktif? Foto aktif lama akan diganti. Video lama tidak dihapus, tetapi validasi dan tanda pemeriksaannya bisa tidak berlaku lagi.')) return;
    setBusy(true); setError('');
    try {
      const options = { headers: { 'X-Solid-Folder': folderId } };
      const ticket = await requestCharacterUpload({ name: file.name.slice(0, 200), size: file.size, contentType: file.type as UploadInputContentType }, options);
      const put = await fetch(ticket.uploadURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('Unggahan belum berhasil. Pilih foto dan coba lagi.');
      await saveCharacter({ name: characterName.trim(), uploadId: ticket.uploadId, consent: true }, options);
      await onSaved(); setEditing(false); setFile(null); setConsent(false);
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
      <label className="ss-upload" htmlFor="character-photo"><ImagePlus size={24} />{file ? file.name : 'Pilih foto wajah · JPG, PNG, WebP · maks. 5 MiB'}</label>
      <input id="character-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => {
        const next = e.target.files?.[0]; setError('');
        if (!next) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 5 * 1024 * 1024) {
          setError('Gunakan JPG, PNG, atau WebP maksimal 5 MiB.'); e.target.value = ''; return;
        }
        setFile(next);
      }} data-testid="input-studio-character-photo" />
      <label className="ss-check-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />Saya berizin memakai foto ini dan membagikannya dalam studio internal.</label>
      <p className="ss-helper">Satu karakter utama per folder. Tidak melatih model wajah atau mengirim foto ke provider AI.</p>
      {error && <p className="ss-alert" role="alert">{error}</p>}
      <div className="ss-modal-actions">{character && <button type="button" className="ss-btn outline" onClick={() => setEditing(false)} disabled={busy}>Batal</button>}
        <button className="ss-btn" disabled={busy || !file || !consent || !characterName.trim()} data-testid="button-save-studio-character">{busy ? 'Menyimpan...' : 'Simpan karakter'}</button></div>
    </form>}
  </section>;
}
