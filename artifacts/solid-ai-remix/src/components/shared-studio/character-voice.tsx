import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Mic, Square, RotateCcw, Upload, Trash2 } from 'lucide-react';
import {
  getCharacterVoice, requestVoiceSampleUpload, saveCharacterVoice, deleteCharacterVoice,
  type CharacterVoice, type VoiceUploadInputContentType,
} from '@workspace/api-client-react';
import { errMsg } from '@/lib/labels';
import './studio.css';

const ALLOWED = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac'];
const MAX_BYTES = 10 * 1024 * 1024, MIN_S = 5, MAX_S = 60;
const AUTO_STOP_S = 59; // Leaves encoder headroom so a recording never exceeds the 60 s limit.
const PROBE_TIMEOUT_MS = 8000;
const RECORD_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const baseType = (t: string) => t.split(';')[0].trim().toLowerCase();
type Draft = { blob: Blob; type: string; seconds: number | null; label: string };
type Probe = { audio: HTMLAudioElement; url: string; timeout: number };

function is409(e: unknown) { return typeof e === 'object' && e !== null && (e as { status?: number }).status === 409; }
function micError(e: unknown) {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin mikrofon ditolak. Izinkan mikrofon di pengaturan browser, atau unggah file audio.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Mikrofon tidak ditemukan. Sambungkan mikrofon atau unggah file audio.';
  if (name === 'NotReadableError') return 'Mikrofon sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  return 'Mikrofon tidak bisa dibuka. Unggah file audio sebagai alternatif.';
}
function fmt(s: number) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

export function CharacterVoicePanel({ characterId, folderId, readOnly = false }: { characterId: string; folderId?: string; readOnly?: boolean }) {
  const [voice, setVoice] = useState<CharacterVoice | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<Draft | null>(null), [preview, setPreview] = useState('');
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'probing'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), lock = useRef(false), abort = useRef<AbortController | null>(null);
  const stream = useRef<MediaStream | null>(null), recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]), timer = useRef<number | null>(null), startedAt = useRef(0);
  const discard = useRef(false), micToken = useRef(0), probeSeq = useRef(0), probe = useRef<Probe | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const options = useCallback((signal?: AbortSignal) => ({ signal, ...(folderId ? { headers: { 'X-Solid-Folder': folderId } } : {}) }), [folderId]);

  const releaseMic = useCallback(() => {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
  }, []);
  const releaseProbe = useCallback(() => {
    const p = probe.current; probe.current = null;
    if (!p) return;
    window.clearTimeout(p.timeout);
    p.audio.onloadedmetadata = null; p.audio.onerror = null;
    p.audio.removeAttribute('src'); p.audio.load();
    URL.revokeObjectURL(p.url);
  }, []);

  const load = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      const next = await getCharacterVoice(options(ctrl.signal));
      if (!alive.current || ctrl.signal.aborted) return;
      setVoice(next); setLoadState('ready');
    } catch (e) {
      if (!alive.current || ctrl.signal.aborted) return;
      setError(errMsg(e)); setLoadState(s => (s === 'ready' ? s : 'error'));
    }
  }, [options]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false; micToken.current++; probeSeq.current++; discard.current = true;
      abort.current?.abort();
      const rec = recorder.current;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* already stopped */ } }
      releaseMic(); releaseProbe();
    };
  }, [load, releaseMic, releaseProbe]);

  useEffect(() => {
    const refresh = () => {
      if (!lock.current && !busy && phase === 'idle') void load();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load, busy, phase]);

  useEffect(() => {
    if (!draft) { setPreview(''); return; }
    const url = URL.createObjectURL(draft.blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);

  function stopRecording() {
    if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; }
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* ignore */ } }
    releaseMic(); // Release tracks now; onstop may fire later.
  }

  async function startRecording() {
    if (readOnly || lock.current || phase !== 'idle' || busy || recorder.current?.state === 'recording') return;
    setError(''); setNotice('');
    if (!window.isSecureContext) { setError('Perekaman butuh koneksi aman (HTTPS). Unggah file audio sebagai alternatif.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Browser ini belum mendukung perekaman. Unggah file audio sebagai alternatif.'); return; }
    const token = ++micToken.current;
    lock.current = true;
    setPhase('requesting');
    let s: MediaStream;
    try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      if (alive.current && token === micToken.current) { lock.current = false; setError(micError(e)); setPhase('idle'); }
      return;
    }
    if (!alive.current || token !== micToken.current) { s.getTracks().forEach(t => t.stop()); return; }
    lock.current = false;
    stream.current = s;
    try {
      const mime = RECORD_TYPES.find(t => MediaRecorder.isTypeSupported?.(t));
      const rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      chunks.current = []; discard.current = false;
      rec.ondataavailable = ev => { if (ev.data.size && token === micToken.current) chunks.current.push(ev.data); };
      rec.onerror = () => {
        if (token !== micToken.current) return;
        discard.current = true; chunks.current = [];
        stopRecording();
        if (alive.current) { setPhase('idle'); setError('Perekaman berhenti karena kesalahan browser. Rekaman sebagian dibuang; coba lagi atau unggah file.'); }
      };
      rec.onstop = () => {
        // Late callbacks from a cancelled recording must not close a newer mic
        // or mix the old recording's chunks into a replacement draft.
        s.getTracks().forEach(t => t.stop());
        if (token !== micToken.current) return;
        const seconds = Math.min((performance.now() - startedAt.current) / 1000, AUTO_STOP_S);
        releaseMic(); recorder.current = null;
        if (!alive.current) return;
        setPhase(p => (p === 'recording' ? 'idle' : p));
        if (discard.current) { chunks.current = []; return; }
        const type = baseType(rec.mimeType || mime || 'audio/webm');
        const blob = new Blob(chunks.current, { type }); chunks.current = [];
        if (!blob.size) { setError('Rekaman kosong. Coba rekam ulang.'); return; }
        if (seconds < MIN_S) { setError(`Rekaman ${fmt(seconds)} terlalu pendek. Rekam minimal 5 detik.`); return; }
        if (blob.size > MAX_BYTES) { setError('Rekaman melebihi 10 MiB. Rekam lebih singkat.'); return; }
        setDraft({ blob, type, seconds, label: `Rekaman ${fmt(seconds)}` });
      };
      recorder.current = rec;
      rec.start(1000);
      startedAt.current = performance.now(); setElapsed(0); setDraft(null); setConsent(false); setPhase('recording');
      timer.current = window.setInterval(() => {
        const sec = (performance.now() - startedAt.current) / 1000;
        setElapsed(Math.min(sec, AUTO_STOP_S));
        if (sec >= AUTO_STOP_S) stopRecording();
      }, 250);
    } catch {
      releaseMic(); recorder.current = null;
      if (alive.current) { setPhase('idle'); setError('Browser tidak bisa memulai perekaman. Unggah file audio sebagai alternatif.'); }
    }
  }
  function cancelMic() {
    discard.current = true; micToken.current++; lock.current = false;
    stopRecording(); setPhase('idle'); setElapsed(0);
  }
  function clearDraft() { setDraft(null); setConsent(false); setError(''); }

  function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.currentTarget.files?.[0]; e.currentTarget.value = '';
    if (!f || readOnly || phase === 'requesting' || phase === 'recording' || busy) return;
    setError(''); setNotice('');
    const type = baseType(f.type);
    if (!ALLOWED.includes(type) || f.size < 1 || f.size > MAX_BYTES) { setError('Gunakan audio WebM, OGG, M4A/MP4, MP3, WAV, atau AAC maksimal 10 MiB.'); return; }
    releaseProbe();
    const seq = ++probeSeq.current;
    const audio = new Audio(), url = URL.createObjectURL(f);
    const done = (sec: number | null) => {
      if (seq !== probeSeq.current) return; // A newer selection or unmount superseded this probe.
      releaseProbe();
      if (!alive.current) return;
      setPhase('idle');
      if (sec !== null && (sec < MIN_S || sec > MAX_S)) { setError(`Durasi sampel ${fmt(sec)}. Gunakan audio 5–60 detik.`); return; }
      setDraft({ blob: f, type, seconds: sec, label: f.name }); setConsent(false);
    };
    probe.current = { audio, url, timeout: window.setTimeout(() => done(null), PROBE_TIMEOUT_MS) };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null); // Server still validates duration and normalizes the file.
    setPhase('probing');
    audio.src = url;
  }

  async function save() {
    if (readOnly || lock.current || busy || phase !== 'idle' || !draft || !consent || !voice) return;
    if (draft.seconds !== null && (draft.seconds < MIN_S || draft.seconds > MAX_S)) { setError('Durasi sampel harus 5–60 detik.'); return; }
    if (voice.sampleUrl && !window.confirm('Ganti sampel suara yang tersimpan? Sampel lama akan dihapus.')) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      const opts = options(ctrl.signal);
      const ticket = await requestVoiceSampleUpload({ characterId, expectedVersion: voice.version, size: draft.blob.size, contentType: draft.type as VoiceUploadInputContentType }, opts);
      const put = await fetch(ticket.uploadURL, { method: 'PUT', body: draft.blob, headers: { 'Content-Type': draft.type }, signal: ctrl.signal });
      if (!put.ok) throw new Error('Pengiriman audio gagal. Coba simpan lagi.');
      const next = await saveCharacterVoice({ characterId, expectedVersion: voice.version, uploadId: ticket.uploadId, consent: true }, opts);
      if (!alive.current) return;
      setVoice(next); setDraft(null); setConsent(false); setNotice('Sampel tersimpan — suara otomatis belum aktif.');
      await load();
    } catch (e) {
      if (!alive.current || ctrl.signal.aborted) return;
      if (is409(e)) { setError('Sampel suara diubah di tempat lain. Status terbaru dimuat; periksa lalu simpan lagi jika perlu.'); await load(); }
      else setError(errMsg(e));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  async function remove() {
    if (readOnly || lock.current || busy || phase !== 'idle' || !voice?.sampleUrl) return;
    if (!window.confirm('Hapus sampel suara karakter ini? Video yang sudah ada tetap bisa dipakai.')) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      const next = await deleteCharacterVoice({ characterId, expectedVersion: voice.version }, options(ctrl.signal));
      if (!alive.current) return;
      setVoice(next); setNotice('Akses sampel dihapus. Pembersihan file diproses otomatis.');
      await load();
    } catch (e) {
      if (!alive.current || ctrl.signal.aborted) return;
      if (is409(e)) { setError('Sampel suara diubah di tempat lain. Status terbaru dimuat sebelum menghapus.'); await load(); }
      else setError(errMsg(e));
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  const idle = phase === 'idle' && !busy;
  const saved = voice?.status === 'SAMPLE_SAVED_AUTOMATION_DISABLED' && voice.sampleUrl && voice.characterId === characterId;
  return <div className="ss-field ss-voice-panel" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(97,67,94,.15)' }} aria-labelledby="voice-title" data-testid="section-character-voice">
    <span className="ss-label" id="voice-title">Suara karakter · opsional</span>
    <p className="ss-helper">Sampel 5–60 detik ini hanya menjadi identitas suara karakter. Ini bukan narasi video — narasi tetap diisi manual per video. Video tetap bisa dibuat tanpa sampel suara.</p>
    <p className="ss-helper">Maks. 10 MiB. Batas ini hanya batas penyimpanan, bukan jaminan sampel cukup untuk kloning suara. Pemeriksaan lokal di server tidak dapat memastikan siapa pemilik suara atau kualitas ucapannya.</p>

    {loadState === 'loading' && <p className="ss-helper" role="status">Memuat status suara...</p>}
    {loadState === 'error' && <div><p className="ss-alert" role="alert">{error || 'Status suara gagal dimuat.'}</p>
      <button type="button" className="ss-btn outline small" onClick={() => { setError(''); setLoadState('loading'); void load(); }} data-testid="button-retry-voice">Coba lagi</button></div>}

    {loadState === 'ready' && voice && <>
      {saved ? <div className="ss-character" data-testid="status-voice-saved">
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>Sampel tersimpan — suara otomatis belum aktif</strong>
          <p className="ss-helper">{voice.durationSeconds ? `${fmt(voice.durationSeconds)} · ` : ''}Belum ada TTS atau pengisi suara otomatis yang menyala.</p>
          <audio controls preload="none" src={voice.sampleUrl ?? undefined} style={{ width: '100%', marginTop: 6 }} aria-label="Dengarkan sampel suara tersimpan" />
        </div>
        {!readOnly && <button type="button" className="ss-btn outline small" disabled={!idle} onClick={() => void remove()} data-testid="button-delete-voice"><Trash2 size={14} aria-hidden="true" />Hapus</button>}
      </div> : <p className="ss-helper" data-testid="status-voice-empty">Belum ada sampel suara.</p>}

      {readOnly ? <p className="ss-helper" data-testid="text-voice-readonly">Peran Pengamat hanya dapat melihat status sampel suara.</p> : <>
        {phase === 'requesting' && <div className="ss-character" role="status" aria-live="polite">
          <span>Menunggu izin mikrofon dari browser...</span>
          <button type="button" className="ss-btn outline small" onClick={cancelMic} data-testid="button-cancel-mic-request">Batal</button>
        </div>}
        {phase === 'recording' && <div className="ss-character" aria-live="polite">
          <span role="timer" aria-label="Durasi rekaman" data-testid="text-voice-elapsed"><strong>Merekam {fmt(elapsed)}</strong> / maks. {fmt(MAX_S)}</span>
          <button type="button" className="ss-btn small" onClick={stopRecording} data-testid="button-stop-voice"><Square size={14} aria-hidden="true" />Berhenti</button>
          <button type="button" className="ss-btn outline small" onClick={cancelMic} data-testid="button-cancel-voice">Batal</button>
        </div>}
        {phase === 'probing' && <p className="ss-helper" role="status">Memeriksa durasi file...</p>}
        {(phase === 'idle' || phase === 'probing') && !draft && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="ss-btn small" disabled={!idle} onClick={() => void startRecording()} data-testid="button-record-voice"><Mic size={14} aria-hidden="true" />{saved ? 'Rekam pengganti' : 'Rekam suara'}</button>
          <button type="button" className="ss-btn outline small" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="button-upload-voice"><Upload size={14} aria-hidden="true" />Unggah audio</button>
          <input ref={fileRef} type="file" hidden accept={ALLOWED.join(',')} onChange={pickFile} aria-label="Pilih file sampel suara" data-testid="input-voice-file" />
        </div>}

        {draft && phase === 'idle' && <div className="ss-field" aria-live="polite">
          <span className="ss-helper" style={{ overflowWrap: 'anywhere' }}>{draft.label} · belum disimpan</span>
          {preview && <audio controls src={preview} style={{ width: '100%' }} aria-label="Dengarkan sampel sebelum disimpan" />}
          <label className="ss-check-row"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} data-testid="checkbox-voice-consent" />
            Ini suara saya sendiri, atau saya memiliki izin eksplisit dari pemilik suara untuk menyimpannya.</label>
          <div className="ss-modal-actions">
            <button type="button" className="ss-btn outline small" disabled={busy} onClick={clearDraft} data-testid="button-discard-voice"><RotateCcw size={14} aria-hidden="true" />Ulangi</button>
            <button type="button" className="ss-btn small" disabled={busy || !consent} onClick={() => void save()} data-testid="button-save-voice">{busy ? 'Menyimpan...' : 'Simpan sampel'}</button>
          </div>
        </div>}
      </>}
      {error && <p className="ss-alert" role="alert">{error}</p>}
      {notice && <p className="ss-helper" role="status" data-testid="text-voice-notice">{notice}</p>}
    </>}
  </div>;
}
