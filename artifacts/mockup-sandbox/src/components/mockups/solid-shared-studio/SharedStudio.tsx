import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, AudioLines, Check, ChevronDown, Clapperboard, Clock3,
  FileImage, FileVideo, FolderOpen, ImagePlus, Info, LockKeyhole,
  Plus, ShieldCheck, Sparkles, UserRound, Users, X,
} from 'lucide-react';
import './_group.css';

type FolderItem = {
  id: string;
  name: string;
  character: string | null;
  initials: string;
  hue: string;
  used: number;
};

type View = 'entry' | 'folders' | 'create' | 'history';
type Attachment = { id: string; name: string; type: string; size: string };
type Draft = { instructions: string; duration: string; attachments: Attachment[]; resultVisible: boolean; selfChecked: boolean };

const emptyDraft: Draft = { instructions: '', duration: '12', attachments: [], resultVisible: false, selfChecked: false };

const initialFolders: FolderItem[] = [
  { id: 'member-01', name: 'Anggota 01', character: 'Raka', initials: 'A1', hue: 'rose', used: 1 },
  { id: 'member-02', name: 'Anggota 02', character: 'Maya', initials: 'A2', hue: 'gold', used: 0 },
  { id: 'member-03', name: 'Anggota 03', character: 'Dira', initials: 'A3', hue: 'plum', used: 2 },
];

const historySeed = [
  { id: 'h1', title: 'Contoh arahan video pendek', folder: 'Anggota 01', date: 'Hari ini, 09.40', status: 'Ilustrasi — belum dirender' },
  { id: 'h2', title: 'Draf pembuka untuk video', folder: 'Anggota 02', date: 'Kemarin, 14.10', status: 'Ilustrasi — belum dirender' },
  { id: 'h3', title: 'Cerita singkat untuk dicoba', folder: 'Anggota 03', date: 'Senin, 11.25', status: 'Ilustrasi — belum dirender' },
];

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#2a1430" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="#f5b82e" strokeWidth="5" />
      <path d="M24 38c2 3 5 4 8 4 4 0 7-2 7-5 0-7-14-4-14-11 0-3 3-5 7-5 3 0 5 1 7 3" fill="none" stroke="#e8462a" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <div className="ss-brand">
      <BrandMark className="ss-brand-mark" />
      <div>
        <div className="ss-brand-name">SOLID AI REMIX</div>
        <div className="ss-brand-sub">STUDIO SOLID GOLD</div>
      </div>
      {!small && <span className="ss-demo-tag">PRATINJAU</span>}
    </div>
  );
}

function Avatar({ initials, hue, className = '' }: { initials: string; hue: string; className?: string }) {
  return <span className={`ss-avatar ${hue} ${className}`} aria-hidden="true">{initials}</span>;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharedStudio() {
  const requestedScreen = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('screen');
  const initialScreen: View = requestedScreen === 'entry' || requestedScreen === 'create' || requestedScreen === 'history' ? requestedScreen : 'folders';
  const [view, setView] = useState<View>(initialScreen);
  const [folders, setFolders] = useState(initialFolders);
  const [activeId, setActiveId] = useState('member-01');
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({
    'member-01': { ...emptyDraft, instructions: 'Buka dengan sapaan hangat, lalu jelaskan satu manfaat utama secara singkat.' },
    'member-02': { ...emptyDraft },
    'member-03': { ...emptyDraft, instructions: 'Ceritakan satu hal sederhana yang bisa dicoba hari ini.' },
  });
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [showCharacterSetup, setShowCharacterSetup] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeFolder = folders.find((item) => item.id === activeId) ?? folders[0];
  const draft = drafts[activeId] ?? emptyDraft;
  const { instructions, duration, attachments, resultVisible, selfChecked } = draft;
  const canCreate = !!activeFolder.character && Number(duration) >= 10 && Number(duration) <= 15 && !!instructions.trim() && activeFolder.used < 3;
  const remaining = Math.max(0, 3 - activeFolder.used);
  const currentHistory = useMemo(() => historySeed, []);

  function updateDraft(patch: Partial<Draft>) {
    setDrafts((old) => ({ ...old, [activeId]: { ...(old[activeId] ?? emptyDraft), ...patch } }));
  }

  function goToCreate(id = activeId) {
    setActiveId(id);
    setView('create');
    setNotice('');
    setShowCharacterSetup(false);
  }

  function addMember() {
    const name = memberName.trim();
    if (!name) return;
    if (folders.some((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setNotice(`${name} sudah memiliki folder contoh.`);
      setMemberName('');
      setShowAddMember(false);
      return;
    }
    const id = `member-${Date.now()}`;
    const initials = name.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase();
    setFolders((old) => [...old, {
      id, name, character: null, initials: initials || 'A', hue: 'plum', used: 0,
    }]);
    setDrafts((old) => ({ ...old, [id]: { ...emptyDraft, attachments: [] } }));
    setMemberName('');
    setShowAddMember(false);
    setNotice(`Folder untuk ${name} ditambahkan. Karakter tersimpan perlu disiapkan sebelum alur produksi dapat disimulasikan.`);
  }

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = Array.from(files).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
      name: file.name,
      type: file.type || 'Berkas lokal',
      size: formatSize(file.size),
    }));
    updateDraft({ attachments: [...attachments, ...next], selfChecked: false, resultVisible: false });
    setNotice('Berkas hanya ditampilkan di pratinjau ini; tidak diunggah atau disimpan.');
    if (fileRef.current) fileRef.current.value = '';
  }

  function editInstructions(value: string) {
    updateDraft({ instructions: value, selfChecked: false, resultVisible: false });
  }

  function simulateCreation() {
    if (!canCreate) return;
    setFolders((old) => old.map((folder) => folder.id === activeId ? { ...folder, used: folder.used + 1 } : folder));
    updateDraft({ resultVisible: true, selfChecked: false });
    setNotice('Simulasi dibuat. Tidak ada video atau berkas hasil yang diproduksi.');
  }

  return (
    <div className="ss-root">
      <style>{`
        .ss-root{--ink:#321d32;--muted:#756978;--line:#e5d9c8;--paper:#fbf6e9;--card:#fffdf6;--plum:#2a1430;--gold:#f5b82e;--tomato:#e8462a;min-height:100dvh;background:var(--paper);color:var(--ink);font-family:'Instrument Sans',sans-serif}
        .ss-root *{box-sizing:border-box}.ss-frame{max-width:1200px;margin:auto;padding:0 34px}
        .ss-top{height:74px;border-bottom:1px solid var(--line);display:flex;align-items:center;background:rgba(251,246,233,.94)}
        .ss-top-inner{display:flex;align-items:center;justify-content:space-between;width:100%}
        .ss-brand{display:flex;align-items:center;gap:11px;min-width:0}.ss-brand-mark{width:39px;height:39px;flex:none}
        .ss-brand-name{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:14px;letter-spacing:-.03em;white-space:nowrap}
        .ss-brand-sub{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.15em;margin-top:4px;color:#887b87}
        .ss-demo-tag{font:500 9px 'JetBrains Mono',monospace;letter-spacing:.12em;color:#6b4e00;background:#f6e4ab;border-radius:999px;padding:6px 8px;margin-left:5px}
        .ss-top-actions{display:flex;align-items:center;gap:12px}.ss-user{display:flex;align-items:center;gap:9px;padding-left:14px;border-left:1px solid var(--line);font-size:12px}
        .ss-user small{display:block;color:var(--muted);font-size:10px;margin-top:2px}
        .ss-avatar{width:36px;height:36px;display:inline-grid;place-items:center;border-radius:50%;font:700 11px 'JetBrains Mono',monospace;flex:none}
        .ss-avatar.rose{background:#f8d5cd;color:#8d382d}.ss-avatar.gold{background:#f5e1a2;color:#715317}.ss-avatar.plum{background:#e8d9e7;color:#543951}
        .ss-main{padding:35px 0 84px}.ss-demo-note{display:flex;gap:10px;align-items:flex-start;border:1px solid #ead49e;background:#fff5d5;padding:12px 15px;border-radius:14px;font-size:12px;color:#695322;line-height:1.55;margin-bottom:27px}
        .ss-demo-note svg{flex:none;margin-top:1px}.ss-eyebrow{font:500 10px 'JetBrains Mono',monospace;letter-spacing:.17em;text-transform:uppercase;color:var(--tomato)}
        .ss-title{font:800 clamp(32px,4vw,47px)/1.02 'Bricolage Grotesque',sans-serif;letter-spacing:-.045em;margin:10px 0 10px}
        .ss-intro{font-size:14px;color:var(--muted);max-width:620px;line-height:1.65;margin:0}
        .ss-title-row{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:24px}
        .ss-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;border:0;border-radius:12px;padding:11px 16px;background:var(--plum);color:#fff8e7;font:600 13px 'Instrument Sans',sans-serif;cursor:pointer;transition:transform .16s,opacity .16s}
        .ss-btn:hover{transform:translateY(-1px)}.ss-btn:disabled{opacity:.42;cursor:not-allowed;transform:none}
        .ss-btn.gold{background:var(--gold);color:var(--plum)}.ss-btn.outline{background:transparent;border:1px solid var(--line);color:var(--ink)}
        .ss-btn.subtle{background:#f1e8d9;color:var(--ink)}.ss-btn.small{padding:8px 11px;font-size:12px;border-radius:10px}
        .ss-text-btn{background:none;border:0;padding:5px 0;color:#8e3e2e;text-decoration:underline;text-underline-offset:3px;font:600 12px 'Instrument Sans',sans-serif;cursor:pointer}
        .ss-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(250px,.8fr);gap:24px;align-items:start}
        .ss-folder-list{display:grid;gap:11px}.ss-folder-card{width:100%;display:grid;grid-template-columns:45px 1fr auto;align-items:center;text-align:left;gap:14px;border:1px solid var(--line);border-radius:17px;background:var(--card);padding:16px;cursor:pointer;color:inherit;transition:transform .16s,border-color .16s,box-shadow .16s}
        .ss-folder-card:hover{transform:translateY(-2px);border-color:#d4a84b;box-shadow:0 8px 20px #50344b0d}
        .ss-folder-icon{width:44px;height:44px;border-radius:14px;background:#f5e9c8;display:grid;place-items:center;color:#76572a}
        .ss-folder-card h3{font:700 17px 'Bricolage Grotesque',sans-serif;letter-spacing:-.02em;margin:0 0 4px}.ss-folder-card p{margin:0;color:var(--muted);font-size:12px}
        .ss-folder-meta{display:flex;align-items:center;gap:8px;color:var(--muted);font:10px 'JetBrains Mono',monospace}
        .ss-aside{display:grid;gap:14px}.ss-panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:19px}
        .ss-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.ss-panel h2{font:700 17px 'Bricolage Grotesque',sans-serif;margin:0}
        .ss-member-list{display:grid;gap:12px;margin:16px 0}.ss-member{display:flex;align-items:center;gap:9px;font-size:12px}.ss-member .ss-avatar{width:29px;height:29px;font-size:9px}
        .ss-quota{background:var(--plum);border-radius:18px;color:#fbf2df;padding:19px}.ss-quota-head{display:flex;align-items:center;gap:8px;color:#f5c552;font:500 10px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase}
        .ss-quota strong{display:block;font:700 26px 'Bricolage Grotesque',sans-serif;margin:12px 0 3px}.ss-quota p{font-size:11px;color:#ded2dc;margin:0;line-height:1.5}
        .ss-bar{height:5px;border-radius:99px;background:#523b55;margin-top:14px;overflow:hidden}.ss-bar i{display:block;height:100%;background:var(--gold);border-radius:99px}
        .ss-footer-note{margin:21px 0 0;color:#827582;font-size:11px;line-height:1.55;display:flex;align-items:flex-start;gap:8px}
        .ss-crumb{display:inline-flex;align-items:center;gap:7px;color:var(--muted);font-size:12px;background:none;border:0;padding:0;cursor:pointer;margin-bottom:22px}
        .ss-create-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:25px;align-items:start}
        .ss-form-card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:24px}
        .ss-step-head{display:flex;align-items:center;gap:11px;margin-bottom:21px}.ss-step-num{width:29px;height:29px;border-radius:50%;display:grid;place-items:center;background:#f5e6bb;color:#6c5014;font:500 11px 'JetBrains Mono',monospace}
        .ss-step-head h2{font:700 18px 'Bricolage Grotesque',sans-serif;margin:0}.ss-step-head p{margin:3px 0 0;font-size:11px;color:var(--muted)}
        .ss-character{display:flex;align-items:center;gap:12px;padding:12px;background:#f7f0e2;border-radius:14px;margin-bottom:23px}
        .ss-character-missing{display:flex;gap:12px;align-items:flex-start;padding:15px;background:#fff1da;border:1px solid #ead4a2;border-radius:14px;margin-bottom:22px;color:#664e26}
        .ss-character-missing-icon{width:39px;height:39px;flex:none;border-radius:12px;background:#f5e1af;display:grid;place-items:center}
        .ss-character-missing strong,.ss-character-setup strong{font:700 14px 'Bricolage Grotesque',sans-serif}
        .ss-character-missing p,.ss-character-setup p{font-size:11px;line-height:1.55;color:#796744;margin:5px 0 7px}
        .ss-character-setup{border:1px solid #e4d4b4;border-radius:15px;background:#fbf4e4;padding:17px;margin-top:18px}
        .ss-character .ss-avatar{width:43px;height:43px;font-size:12px}.ss-character strong{font:700 15px 'Bricolage Grotesque',sans-serif}.ss-character small{display:block;color:var(--muted);font-size:11px;margin-top:3px}
        .ss-fixed-chip{margin-left:auto;font:500 9px 'JetBrains Mono',monospace;text-transform:uppercase;color:#5e713a;background:#e6eddc;border-radius:99px;padding:6px 8px}
        .ss-label{display:block;font-size:12px;font-weight:600;margin:0 0 8px}.ss-field{width:100%;border:1px solid #daccba;border-radius:12px;background:#fffdf8;padding:12px 13px;color:var(--ink);font:13px 'Instrument Sans',sans-serif;outline:none}
        .ss-field:focus{border-color:#bf8126;box-shadow:0 0 0 3px #f5b82e28}.ss-textarea{min-height:151px;resize:vertical;line-height:1.6}
        .ss-helper{margin:7px 0 0;font-size:11px;color:var(--muted);line-height:1.5}.ss-warning{display:flex;gap:8px;padding:10px 12px;border-radius:11px;background:#fff4dc;color:#715626;font-size:11px;line-height:1.5;margin-top:11px}
        .ss-warning svg{flex:none}.ss-form-section{margin-top:24px}.ss-upload{display:flex;align-items:center;gap:12px;padding:14px;border:1px dashed #cdbda8;border-radius:13px;cursor:pointer;background:#fcf8ee}
        .ss-upload-icon{width:37px;height:37px;border-radius:11px;display:grid;place-items:center;color:#80562a;background:#f4e6c5}.ss-upload strong{font-size:12px}.ss-upload small{display:block;color:var(--muted);font-size:10px;margin-top:3px}
        .ss-files{display:grid;gap:8px;margin-top:10px}.ss-file{display:flex;align-items:center;gap:9px;background:#f6f0e5;border-radius:10px;padding:9px 11px;font-size:11px}.ss-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.ss-file small{color:var(--muted)}
        .ss-remove{border:0;background:none;color:#867987;cursor:pointer;padding:4px;display:grid;place-items:center}.ss-format{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
        .ss-format span{border:1px solid var(--line);border-radius:9px;padding:7px 9px;font:10px 'JetBrains Mono',monospace;color:#594c5a}
        .ss-tech{margin-top:16px;border-top:1px solid var(--line);padding-top:15px}.ss-tech-toggle{border:0;background:none;padding:0;display:flex;align-items:center;gap:8px;color:#695b6b;font-size:12px;font-weight:600;cursor:pointer}
        .ss-tech-content{padding:12px 0 0 25px;font-size:11px;color:var(--muted);line-height:1.65}
        .ss-side-preview{position:sticky;top:16px;display:grid;gap:13px}.ss-preview-box{background:var(--plum);color:#fff6e3;border-radius:19px;padding:18px}
        .ss-preview-box h3{font:700 16px 'Bricolage Grotesque',sans-serif;margin:0 0 13px}.ss-summary-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid #563f58;font-size:11px}.ss-summary-row span:first-child{color:#cbbdcc}.ss-summary-row strong{text-align:right;font-size:11px}
        .ss-help-card{background:#f6e6b9;border-radius:16px;padding:15px;color:#594719;font-size:11px;line-height:1.55}.ss-help-card strong{display:block;font-size:12px;margin-bottom:4px}
        .ss-result{margin-top:19px;border:1px solid #e5cf91;border-radius:18px;background:#fff8df;padding:18px;display:grid;grid-template-columns:74px 1fr;gap:14px}
        .ss-result-art{aspect-ratio:9/16;border-radius:12px;background:linear-gradient(155deg,#efd28d,#b78e52 48%,#56334e);display:flex;align-items:flex-end;padding:8px;color:#fff;font:700 9px 'Bricolage Grotesque',sans-serif;text-align:center}
        .ss-result h3{font:700 16px 'Bricolage Grotesque',sans-serif;margin:1px 0 5px}.ss-result p{margin:0;color:#6f5d3e;font-size:11px;line-height:1.5}
        .ss-result-label{font:500 9px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.1em;color:#8a611b;margin-bottom:7px}
        .ss-check-row{display:flex;align-items:center;gap:9px;margin-top:14px;font-size:11px;color:#514334}.ss-check-row input{accent-color:#61435e;width:15px;height:15px}
        .ss-status-line{display:flex;gap:8px;align-items:center;margin-top:12px;padding-top:11px;border-top:1px solid #ead9ae;font-size:10px;color:#705c3b}
        .ss-history{display:grid;gap:10px}.ss-history-row{display:grid;grid-template-columns:38px 1fr auto;gap:13px;align-items:center;border:1px solid var(--line);background:var(--card);padding:14px;border-radius:15px}
        .ss-history-icon{width:38px;height:38px;border-radius:12px;background:#eee1eb;display:grid;place-items:center;color:#654e65}
        .ss-history-row strong{font:700 14px 'Bricolage Grotesque',sans-serif}.ss-history-row p{font-size:11px;color:var(--muted);margin:4px 0 0}
        .ss-history-state{font:10px 'JetBrains Mono',monospace;color:#806329;text-align:right}
        .ss-modal-backdrop{position:fixed;inset:0;z-index:30;background:#24162680;display:grid;place-items:center;padding:20px}
        .ss-modal{width:min(100%,430px);border:1px solid var(--line);background:var(--card);border-radius:20px;padding:23px;box-shadow:0 20px 60px #24162630}
        .ss-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ss-modal h2{font:800 23px 'Bricolage Grotesque',sans-serif;margin:0}.ss-modal p{font-size:12px;color:var(--muted);line-height:1.55;margin:7px 0 18px}
        .ss-close{border:0;background:#f2eadc;border-radius:50%;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;color:var(--ink)}
        .ss-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.ss-entry-wrap{min-height:calc(100dvh - 74px);display:grid;place-items:center;padding:38px 0}
        .ss-entry-card{width:min(100%,500px);border:1px solid var(--line);background:var(--card);border-radius:24px;padding:32px;box-shadow:0 18px 45px #4b354510}
        .ss-entry-mark{width:58px;height:58px;margin-bottom:22px}.ss-entry-card h1{font:800 34px/1.02 'Bricolage Grotesque',sans-serif;letter-spacing:-.04em;margin:10px 0}
        .ss-entry-card p{font-size:13px;line-height:1.65;color:var(--muted);margin:0 0 19px}.ss-entry-info{display:flex;gap:9px;padding:11px 12px;border-radius:12px;background:#f6edda;color:#6c572b;font-size:11px;line-height:1.5;margin-bottom:18px}
        .ss-entry-info svg{flex:none}.ss-entry-card .ss-btn{width:100%;padding:13px}
        .ss-entry-caption{text-align:center!important;font-size:10px!important;margin:13px 0 0!important}
        .ss-alert{margin:12px 0 0;padding:10px 12px;border-radius:11px;background:#ecf0e2;color:#52613c;font-size:11px;line-height:1.5}
        @media(max-width:800px){.ss-frame{padding:0 20px}.ss-top{height:66px}.ss-top-actions .ss-user{display:none}.ss-main{padding-top:24px}.ss-grid,.ss-create-grid{grid-template-columns:1fr}.ss-aside{grid-template-columns:1fr 1fr}.ss-side-preview{position:static;grid-template-columns:1fr 1fr}.ss-title-row{align-items:flex-start;flex-direction:column}.ss-title-row .ss-btn{width:100%}}
        @media(max-width:560px){.ss-frame{padding:0 16px}.ss-brand-mark{width:34px;height:34px}.ss-brand-name{font-size:12px}.ss-brand-sub{font-size:8px}.ss-demo-tag{font-size:8px;padding:5px 6px}.ss-main{padding-top:18px}.ss-demo-note{font-size:11px;margin-bottom:21px}.ss-title{font-size:35px}.ss-intro{font-size:13px}.ss-folder-card{grid-template-columns:40px 1fr auto;gap:10px;padding:13px}.ss-folder-icon{width:39px;height:39px}.ss-folder-card h3{font-size:15px}.ss-folder-card p{font-size:10px}.ss-folder-meta{font-size:9px;gap:5px}.ss-aside,.ss-side-preview{grid-template-columns:1fr}.ss-form-card{padding:17px}.ss-history-row{grid-template-columns:34px 1fr;gap:10px}.ss-history-state{grid-column:2;text-align:left}.ss-entry-card{padding:24px}.ss-entry-card h1{font-size:30px}.ss-result{grid-template-columns:62px 1fr;padding:13px}.ss-title-row{margin-bottom:19px}}
      `}</style>

      <header className="ss-top">
        <div className="ss-frame ss-top-inner">
          <Wordmark />
          {view !== 'entry' && (
            <div className="ss-top-actions">
              <button className="ss-btn outline small" onClick={() => setView(view === 'history' ? 'folders' : 'history')} data-testid="button-open-history">
                <Clock3 size={14} /> {view === 'history' ? 'Studio' : 'Riwayat'}
              </button>
              <div className="ss-user"><Avatar initials="A1" hue="rose" /><div>Anggota 01<small>Pratinjau studio</small></div></div>
            </div>
          )}
        </div>
      </header>

      {view === 'entry' ? (
        <main className="ss-frame ss-entry-wrap">
          <section className="ss-entry-card">
            <BrandMark className="ss-entry-mark" />
            <div className="ss-eyebrow">Ruang kerja tim Solid Gold</div>
            <h1>Selamat datang di studio bersama.</h1>
            <p>Pilih folder milik anggota, gunakan karakter yang sudah tersimpan, lalu susun arahan video. Semua folder terlihat oleh anggota tim setelah masuk.</p>
            <div className="ss-entry-info"><LockKeyhole size={16} />Aksi ini hanya membuka simulasi pratinjau. Perlindungan kata sandi bersama yang sesungguhnya belum diterapkan.</div>
            <button className="ss-btn gold" onClick={() => setView('folders')} data-testid="button-simulate-entry">Simulasikan masuk studio <ArrowRight size={16} /></button>
            <p className="ss-entry-caption">Tidak meminta atau memeriksa kata sandi.</p>
            <div className="ss-footer-note"><ShieldCheck size={14} />Akses admin tetap terpisah dan memerlukan autentikasi tersendiri. Memilih folder tidak memberikan akses admin.</div>
          </section>
        </main>
      ) : (
        <main className="ss-frame ss-main">
          <div className="ss-demo-note"><Info size={15} /><span>Pratinjau interaktif dengan data ilustratif. Perubahan hanya tersimpan sementara di halaman ini; tidak ada akun, data tim, atau hasil produksi yang disimpan.</span></div>

          {view === 'folders' && (
            <>
              <div className="ss-title-row">
                <div><div className="ss-eyebrow">Studio bersama · Semua folder tim</div><h1 className="ss-title">Folder anggota</h1><p className="ss-intro">Satu anggota memiliki satu folder. Pilih nama untuk mulai; karakter yang tersedia sudah tersimpan di dalam folder.</p></div>
                <button className="ss-btn" onClick={() => setShowAddMember(true)} data-testid="button-add-member"><Plus size={16} /> Tambah anggota</button>
              </div>
              {notice && <div className="ss-alert" role="status">{notice}</div>}
              <div className="ss-grid">
                <section>
                  <div className="ss-folder-list">
                    {folders.map((folder) => (
                      <button key={folder.id} className="ss-folder-card" onClick={() => goToCreate(folder.id)} data-testid={`card-folder-${folder.id}`}>
                        <span className="ss-folder-icon"><FolderOpen size={21} /></span>
                        <span><h3>{folder.name}</h3><p>{folder.character ? `Karakter tersimpan · ${folder.character}` : 'Karakter perlu disiapkan sebelum membuat video'}</p></span>
                        <span className="ss-folder-meta">{folder.used}/3 hari ini<ArrowRight size={15} /></span>
                      </button>
                    ))}
                  </div>
                  <p className="ss-footer-note"><LockKeyhole size={14} />Seluruh anggota studio dapat melihat semua folder setelah masuk. Admin bukan pilihan folder dan dikelola melalui akses terpisah.</p>
                  <button className="ss-text-btn" style={{ marginTop: 11 }} onClick={() => setView('entry')} data-testid="button-preview-entry">Lihat ilustrasi layar masuk</button>
                </section>
                <aside className="ss-aside">
                  <div className="ss-panel">
                    <div className="ss-panel-head"><h2>Satu folder per anggota</h2><Users size={17} /></div>
                    <p className="ss-helper">Nama anggota menjadi nama folder pribadinya. Semua folder terlihat oleh tim setelah masuk studio.</p>
                    <div className="ss-helper" style={{ marginTop: 11 }}>Penambahan nama hanya berlaku di pratinjau. Tidak membuat akun, login, atau persetujuan.</div>
                  </div>
                  <div className="ss-quota">
                    <div className="ss-quota-head"><Clapperboard size={15} /> Mode Hemat</div>
                    <strong>Maks. 3 per folder</strong>
                    <p>Batas harian dihitung per folder, bukan per orang. Angka yang terlihat hanya contoh lokal.</p>
                  </div>
                </aside>
              </div>
            </>
          )}

          {view === 'create' && activeFolder && (
            <>
              <button className="ss-crumb" onClick={() => setView('folders')} data-testid="button-back-folders"><ArrowLeft size={14} /> Semua folder</button>
              <div className="ss-title-row">
                <div><div className="ss-eyebrow">{activeFolder.name} · Folder anggota</div><h1 className="ss-title">Susun video Anda.</h1><p className="ss-intro">Arahan dan bahan contoh tersimpan terpisah per folder selama halaman ini terbuka.</p></div>
              </div>
              <div className="ss-create-grid">
                <section className="ss-form-card">
                  <div className="ss-step-head"><span className="ss-step-num">01</span><div><h2>Karakter folder</h2><p>Satu identitas karakter yang tersimpan untuk folder ini.</p></div></div>
                  {activeFolder.character ? <div className="ss-character">
                    <Avatar initials={activeFolder.initials} hue={activeFolder.hue} />
                    <div><strong>{activeFolder.character}</strong><small>Karakter tersimpan di {activeFolder.name}</small></div>
                    <span className="ss-fixed-chip">Identitas tetap</span>
                  </div> : <div className="ss-character-missing">
                    <div className="ss-character-missing-icon"><UserRound size={18} /></div>
                    <div><strong>Karakter perlu disiapkan</strong><p>Folder ini belum memiliki karakter tersimpan. Alur produksi tidak tersedia sampai karakter disiapkan.</p>
                      <button className="ss-text-btn" onClick={() => setShowCharacterSetup((shown) => !shown)} aria-expanded={showCharacterSetup} data-testid="button-character-setup-preview">{showCharacterSetup ? 'Tutup pratinjau' : 'Lihat contoh penyiapan lokal'}</button>
                    </div>
                  </div>}
                  {activeFolder.character ? <>

                  <div className="ss-step-head"><span className="ss-step-num">02</span><div><h2>Apa yang ingin disampaikan?</h2><p>Masukkan arahan atau draf naskah. Teks ini belum dipahami otomatis oleh model.</p></div></div>
                  <label className="ss-label" htmlFor="ss-instructions">Arahan atau naskah</label>
                  <textarea id="ss-instructions" className="ss-field ss-textarea" value={instructions} onChange={(event) => editInstructions(event.target.value)} placeholder="Contoh: Ajak penonton mengenal tiga manfaat produk. Gunakan kalimat singkat dan nada yang ramah." data-testid="input-instructions" />
                  <div className="ss-helper">{instructions.length} karakter · Tulis ide, urutan adegan, atau naskah yang ingin dicoba.</div>
                  <div className="ss-warning"><Info size={15} />Teks bebas tidak otomatis dipahami atau diubah menjadi video oleh AI. Pembuatan AI Motion dan sinkronisasi bibir belum aktif.</div>

                  <div className="ss-form-section">
                    <div className="ss-step-head"><span className="ss-step-num">03</span><div><h2>Bahan pendukung</h2><p>Pilih berkas lokal untuk ditampilkan di pratinjau saja.</p></div></div>
                    <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(event) => handleFiles(event.target.files)} data-testid="input-local-files" />
                    <button className="ss-upload" onClick={() => fileRef.current?.click()} data-testid="button-attach-files">
                      <span className="ss-upload-icon"><ImagePlus size={19} /></span><span><strong>Pilih gambar, video, atau audio</strong><small>Berkas tetap di perangkat; tidak diunggah ke mana pun</small></span>
                    </button>
                    {attachments.length > 0 && <div className="ss-files">
                      {attachments.map((file) => {
                        const Icon = file.type.startsWith('video/') ? FileVideo : file.type.startsWith('audio/') ? AudioLines : FileImage;
                        return <div className="ss-file" key={file.id}><Icon size={15} /><span className="ss-file-name">{file.name}</span><small>{file.size}</small><button className="ss-remove" aria-label={`Hapus ${file.name}`} onClick={() => { updateDraft({ attachments: attachments.filter((item) => item.id !== file.id), selfChecked: false, resultVisible: false }); }} data-testid={`button-remove-file-${file.id}`}><X size={14} /></button></div>;
                      })}
                    </div>}
                    <div className="ss-helper">Lampiran tidak diproses. Memilih berkas hanya menampilkan nama dan ukuran di layar ini.</div>
                  </div>

                  <div className="ss-form-section">
                    <div className="ss-step-head"><span className="ss-step-num">04</span><div><h2>Format video</h2><p>Pilihan Hemat yang tersedia untuk simulasi.</p></div></div>
                    <label className="ss-label" htmlFor="ss-duration">Durasi</label>
                    <select id="ss-duration" className="ss-field" value={duration} onChange={(event) => updateDraft({ duration: event.target.value, selfChecked: false, resultVisible: false })} data-testid="select-duration">
                      {[10, 11, 12, 13, 14, 15].map((seconds) => <option value={seconds} key={seconds}>{seconds} detik</option>)}
                    </select>
                    <div className="ss-format"><span>HEMAT</span><span>PORTRAIT 9:16</span><span>FOTO + KOMPOSITING</span></div>
                  </div>

                  <div className="ss-tech">
                    <button className="ss-tech-toggle" onClick={() => setTechnicalOpen((open) => !open)} aria-expanded={technicalOpen} data-testid="button-toggle-technical"><ChevronDown size={15} style={{ transform: technicalOpen ? 'rotate(180deg)' : undefined }} /> Opsi teknis (opsional)</button>
                    {technicalOpen && <div className="ss-tech-content">Mode Hemat menyusun foto menjadi komposisi video sederhana. AI Motion dan lip-sync belum aktif. Tidak ada pengaturan model atau provider pada pratinjau ini.</div>}
                  </div>
                  {notice && <div className="ss-alert" role="status">{notice}</div>}
                  <div className="ss-form-section"><button className="ss-btn gold" disabled={!canCreate} onClick={simulateCreation} data-testid="button-simulate-creation"><Sparkles size={16} /> Simulasikan alur produksi</button>
                    <div className="ss-helper">{remaining ? `${remaining} dari 3 simulasi tersisa untuk folder ini hari ini.` : 'Batas contoh 3 simulasi per folder hari ini telah tercapai.'} Tidak ada MP4 atau render yang dibuat.</div>
                  </div>
                  {resultVisible && (
                    <div className="ss-result" aria-live="polite">
                      <div className="ss-result-art">CONTOH<br />TAMPILAN</div>
                      <div><div className="ss-result-label">Mock result ilustratif · bukan hasil video</div><h3>Alur produksi tersimulasikan</h3><p>Ini hanya ilustrasi langkah berikutnya, bukan render, pemutaran video, atau berkas MP4. Naskah Anda tetap berupa teks contoh di layar.</p>
                        <label className="ss-check-row"><input type="checkbox" checked={selfChecked} onChange={(event) => updateDraft({ selfChecked: event.target.checked })} data-testid="checkbox-self-check" />Sudah saya periksa</label>
                        <div className="ss-status-line"><Check size={13} />Status produksi: simulasi saja <span>·</span> Pemeriksaan mandiri: {selfChecked ? 'Sudah diperiksa' : 'Belum diperiksa'}</div>
                      </div>
                    </div>
                  )}
                  </> : showCharacterSetup && <div className="ss-character-setup">
                    <div className="ss-result-label">Ilustrasi penyiapan · lokal saja</div>
                    <strong>Karakter baru perlu disimpan melalui proses studio yang sesungguhnya.</strong>
                    <p>Pratinjau ini tidak membuat atau mengunggah karakter. Setelah karakter tersedia untuk folder ini, identitasnya akan tampil di bagian atas perjalanan video.</p>
                    <div className="ss-format"><span>1 IDENTITAS</span><span>KHUSUS FOLDER INI</span></div>
                  </div>}
                </section>
                <aside className="ss-side-preview">
                  <div className="ss-preview-box">
                    <h3>Ringkasan video</h3>
                    <div className="ss-summary-row"><span>Folder</span><strong>{activeFolder.name}</strong></div>
                    <div className="ss-summary-row"><span>Karakter</span><strong>{activeFolder.character ?? 'Belum disiapkan'}</strong></div>
                    <div className="ss-summary-row"><span>Durasi</span><strong>{duration} detik</strong></div>
                    <div className="ss-summary-row"><span>Format</span><strong>Portrait 9:16</strong></div>
                    <div className="ss-summary-row"><span>Bahan lokal</span><strong>{attachments.length} berkas</strong></div>
                    <div className="ss-summary-row"><span>Kuota folder</span><strong>{activeFolder.used}/3 hari ini</strong></div>
                  </div>
                  <div className="ss-help-card"><strong>Mode Hemat, tanpa jargon.</strong>Mode ini memakai foto dan kompositing. AI Motion, lip-sync, dan pemahaman otomatis atas naskah belum tersedia.</div>
                  <div className="ss-panel">
                    <div className="ss-panel-head"><h2>Folder milik anggota</h2><Users size={16} /></div>
                    <p className="ss-helper">{activeFolder.character ? 'Folder ini memiliki satu karakter tersimpan' : 'Karakter untuk folder ini belum disiapkan'} dan kuota hariannya sendiri. Tidak ada folder proyek di dalamnya.</p>
                  </div>
                </aside>
              </div>
            </>
          )}

          {view === 'history' && (
            <>
              <button className="ss-crumb" onClick={() => setView('folders')} data-testid="button-history-back"><ArrowLeft size={14} /> Kembali ke folder</button>
              <div className="ss-title-row"><div><div className="ss-eyebrow">Contoh saja · Tidak ada render</div><h1 className="ss-title">Riwayat studio</h1><p className="ss-intro">Daftar ini ilustratif. Tidak ada proyek atau hasil video yang tersimpan.</p></div></div>
              <div className="ss-history">
                {currentHistory.map((item) => <div className="ss-history-row" key={item.id}><span className="ss-history-icon"><Clapperboard size={17} /></span><div><strong>{item.title}</strong><p>{item.folder} · {item.date}</p></div><div className="ss-history-state">{item.status}</div></div>)}
              </div>
              <p className="ss-footer-note"><Info size={14} />Status produksi dan pemeriksaan mandiri adalah hal terpisah. Tidak ada review admin atau persetujuan yang disimulasikan.</p>
            </>
          )}
        </main>
      )}

      {showAddMember && (
        <div className="ss-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowAddMember(false); setMemberName(''); } }}>
          <section className="ss-modal" role="dialog" aria-modal="true" aria-labelledby="ss-modal-title">
            <div className="ss-modal-head"><div><div className="ss-eyebrow">Ruang kerja tim</div><h2 id="ss-modal-title">Tambah anggota</h2></div><button className="ss-close" onClick={() => { setShowAddMember(false); setMemberName(''); }} aria-label="Tutup dialog" data-testid="button-close-modal"><X size={16} /></button></div>
            <p>Nama ini menjadi nama folder anggota baru. Perubahan hanya contoh lokal; tidak membuat akun atau akses masuk. Karakter perlu disiapkan terpisah sebelum simulasi produksi.</p>
            <label className="ss-label" htmlFor="ss-modal-input">Nama anggota</label>
            <input id="ss-modal-input" className="ss-field" autoFocus value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Contoh: Anggota 04" onKeyDown={(event) => { if (event.key === 'Enter') addMember(); }} data-testid="input-member-name" />
            <div className="ss-modal-actions"><button className="ss-btn outline small" onClick={() => { setShowAddMember(false); setMemberName(''); }}>Batal</button><button className="ss-btn gold small" disabled={!memberName.trim()} onClick={addMember} data-testid="button-confirm-member"><Check size={14} />Buat folder anggota</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

export default SharedStudio;
