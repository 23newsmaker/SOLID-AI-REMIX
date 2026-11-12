import { useState, type FormEvent } from 'react';
import { Link, useRoute } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FolderOpen, LockKeyhole, Plus, LogOut } from 'lucide-react';
import {
  useGetStudioSession, useListStudioFolders, useCreateStudioFolder, enterStudio, leaveStudio,
} from '@workspace/api-client-react';
import { BrandMark } from '@/components/brand';
import { errMsg } from '@/lib/labels';
import { StudioWorkspace } from '@/components/shared-studio/workspace';
import '@/components/shared-studio/studio.css';

// Shared credentials and admin credentials are independent. A Clerk sign-in in
// another tab must not clear an in-progress shared folder's upload/form cache.
const studioQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } } });
export default function SharedStudioPage() {
  return <QueryClientProvider client={studioQueryClient}><StudioGateway /></QueryClientProvider>;
}
function StudioGateway() {
  const session = useGetStudioSession({ query: { retry: false, refetchOnWindowFocus: true } });
  const [inFolder, params] = useRoute('/studio/member/:folderId');
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  async function logout() {
    setLeaving(true); setError('');
    try { await leaveStudio(); qc.clear(); window.location.assign(`${import.meta.env.BASE_URL}studio`); }
    catch (e) { setError(errMsg(e)); setLeaving(false); }
  }
  return <div className="ss-root">
    <header className="ss-top"><div className="ss-frame ss-top-inner">
      <div className="ss-brand"><BrandMark className="ss-brand-mark" /><div>
        <div className="ss-brand-name">SOLID AI REMIX</div><div className="ss-brand-sub">STUDIO SOLID GOLD</div>
      </div></div>
      <nav className="ss-top-actions" aria-label="Akses studio">
        <Link href="/operations" target="_blank" rel="noopener noreferrer" className="ss-btn outline small">Admin</Link>
        {session.data?.authenticated && !inFolder && <button className="ss-btn subtle small" onClick={() => void logout()} disabled={leaving}><LogOut size={14} />Keluar</button>}
      </nav>
    </div></header>
    {error && <p className="ss-frame ss-alert" role="alert">{error}</p>}
    {session.isLoading ? <main className="ss-frame ss-main" role="status">Memuat studio...</main>
      : session.isError ? <main className="ss-frame ss-main"><p role="alert">{errMsg(session.error)}</p><button className="ss-btn" onClick={() => void session.refetch()}>Coba lagi</button></main>
      : !session.data?.authenticated ? <StudioEntry configured={session.data?.configured ?? false} onEntered={() => { void session.refetch(); }} />
      : <StudioContents folderId={inFolder ? params.folderId : null} />}
  </div>;
}

function StudioEntry({ configured, onEntered }: { configured: boolean; onEntered: () => void }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy || !configured) return;
    setBusy(true); setError('');
    try { await enterStudio({ password }); setPassword(''); onEntered(); }
    catch (failure) { setError(errMsg(failure)); }
    finally { setBusy(false); }
  }
  return <main className="ss-frame ss-entry-wrap"><section className="ss-entry-card">
    <LockKeyhole size={36} className="ss-entry-mark" />
    <p className="ss-eyebrow">Khusus tim internal</p><h1>Satu studio.<br />Berkarya bersama.</h1>
    <p className="ss-intro">Masukkan password studio, lalu pilih folder anggota. Tidak perlu akun atau persetujuan anggota satu per satu.</p>
    {!configured && <p className="ss-alert" role="status">Password studio belum siap. Pemilik perlu mengatur password minimal 12 karakter melalui Secrets. Akses admin lama tetap tersedia.</p>}
    <form onSubmit={e => void submit(e)} className="ss-field" style={{ marginTop: 24 }}>
      <input type="text" name="username" value="Studio SOLID AI REMIX" autoComplete="username" readOnly hidden />
      <label className="ss-label" htmlFor="studio-password">Password studio</label>
      <input id="studio-password" name="password" type="password" autoComplete="current-password" maxLength={256} value={password} onChange={e => setPassword(e.target.value)} disabled={!configured || busy} required data-testid="input-studio-password" />
      {error && <p className="ss-alert" role="alert">{error}</p>}
      <button className="ss-btn gold" style={{ width: '100%', marginTop: 16 }} disabled={!configured || busy || !password} data-testid="button-enter-studio">{busy ? 'Memeriksa...' : 'Buka studio'}<ArrowRight size={16} /></button>
    </form>
    <p className="ss-entry-caption">Sesi berlaku 12 jam. Akses admin memakai akun terpisah, bukan nama folder.</p>
  </section></main>;
}

function StudioContents({ folderId }: { folderId: string | null }) {
  const folders = useListStudioFolders({ query: { retry: false, refetchOnWindowFocus: true } });
  const add = useCreateStudioFolder();
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [error, setError] = useState('');
  async function create(e: FormEvent) {
    e.preventDefault(); if (add.isPending || !name.trim()) return;
    setError('');
    try { await add.mutateAsync({ data: { name: name.trim() } }); setName(''); setAdding(false); await folders.refetch(); }
    catch (failure) { setError(errMsg(failure)); }
  }
  if (folders.isLoading) return <main className="ss-frame ss-main" role="status">Memuat folder anggota...</main>;
  if (folders.isError) return <main className="ss-frame ss-main"><p role="alert">{errMsg(folders.error)}</p><a className="ss-btn" href={`${import.meta.env.BASE_URL}studio`}>Kembali ke pintu studio</a></main>;
  if (folderId) {
    const folder = folders.data?.find(f => f.id === folderId);
    return folder ? <StudioWorkspace key={folder.id} folder={folder} onUsageChange={() => { void folders.refetch(); }} />
      : <main className="ss-frame ss-main"><p>Folder tidak tersedia.</p><Link href="/studio" className="ss-btn"><ArrowLeft size={15} />Folder anggota</Link></main>;
  }
  return <main className="ss-frame ss-main">
    <div className="ss-title-row"><div><p className="ss-eyebrow">Ruang kerja bersama</p><h1 className="ss-title">Mau bikin apa hari ini?</h1>
      <p className="ss-intro">Buka folder anggota untuk memakai karakter, menyiapkan video, dan melihat hasilnya.</p></div>
      <button className="ss-btn gold" onClick={() => setAdding(!adding)} data-testid="button-add-studio-member"><Plus size={16} />Tambah anggota</button>
    </div>
    {adding && <form className="ss-panel ss-field" onSubmit={e => void create(e)} style={{ marginBottom: 20 }}>
      <label className="ss-label" htmlFor="new-member-name">Nama anggota</label>
      <input id="new-member-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={80} required disabled={add.isPending} data-testid="input-studio-member-name" />
      <div className="ss-modal-actions"><button type="button" className="ss-btn outline" onClick={() => setAdding(false)}>Batal</button><button className="ss-btn" disabled={add.isPending || !name.trim()}>{add.isPending ? 'Menambahkan...' : 'Buat folder anggota'}</button></div>
    </form>}
    {error && <p className="ss-alert" role="alert">{error}</p>}
    <div className="ss-grid"><section className="ss-folder-list" aria-label="Folder anggota">
      {!folders.data?.length && <div className="ss-panel"><h2>Belum ada folder anggota.</h2><p className="ss-helper">Tambahkan nama anggota untuk memulai. Data pribadi lama tidak otomatis dibagikan.</p></div>}
      {folders.data?.map(f => <Link href={`/studio/member/${encodeURIComponent(f.id)}`} className="ss-folder-card" key={f.id} data-testid={`studio-folder-${f.id}`}>
        <span className="ss-folder-icon"><FolderOpen size={22} /></span><div><h3>{f.name}</h3><p>{f.characterName ? `Karakter: ${f.characterName}` : 'Belum ada karakter tersimpan'}</p></div>
        <div className="ss-folder-meta"><span>{f.dailyUsed}/{f.dailyLimit} hari ini</span><ArrowRight size={16} /></div>
      </Link>)}
    </section><aside className="ss-aside">
      <section className="ss-quota"><div className="ss-quota-head">Foto → naskah → video</div><h2>Mode Hemat</h2><p>Foto bergerak dengan pan/zoom, subtitle, dan rekaman suara bila diunggah. Bukan AI Cast atau lip-sync.</p></section>
      <section className="ss-panel"><h2>Studio ini dipakai bersama</h2><p className="ss-helper">Pemegang password dapat melihat dan mengelola semua folder yang dibagikan. Nama folder bukan bukti identitas orang.</p><p className="ss-helper">Batas harian berlaku per folder. Menghapus video tidak mengembalikan kuota.</p></section>
      <section className="ss-help-card"><strong>Tetap ekonomis</strong>Tidak memanggil API video, TTS, atau chat AI berbayar. Komputasi rendering dan storage tetap dapat menimbulkan biaya.</section>
    </aside></div>
  </main>;
}
