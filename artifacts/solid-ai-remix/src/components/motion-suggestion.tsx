import { useState } from 'react';
import type { CreativeConceptInput } from '@workspace/api-client-react';

const fields = ['scenes', 'characterMotion', 'cameraMotion', 'visual'] as const;
type Motion = Pick<CreativeConceptInput, typeof fields[number]>;
const labels = { scenes: 'Adegan', characterMotion: 'Gerakan karakter', cameraMotion: 'Gerakan kamera', visual: 'Visual' };
const values = (form: CreativeConceptInput): Motion => Object.fromEntries(fields.map(k => [k, form[k]])) as Motion;

export function MotionSuggestion({ form, setForm }: {
  form: CreativeConceptInput; setForm: React.Dispatch<React.SetStateAction<CreativeConceptInput>>;
}) {
  const [proposal, setProposal] = useState<{ before: Motion; after: Motion; applied: boolean } | null>(null);
  const suggest = () => {
    const hemat = form.mode === 'HEMAT', ugc = form.style === 'UGC';
    setProposal({ before: values(form), applied: false, after: {
      scenes: hemat ? 'Satu foto karakter; bahan produk/screenshot ditampilkan sebagai adegan terpisah tanpa mengubah isi gambar.'
        : 'Satu adegan utama. Bahan pendukung hanya dipakai bila provider mendukung dan pemilik menyetujui pengirimannya.',
      characterMotion: hemat ? 'Foto tetap; tidak ada gerakan tubuh atau lip-sync.' : 'Gerakan subjek sederhana dan natural; hindari perubahan wajah, tangan cepat atau pergantian pose ekstrem.',
      cameraMotion: ugc ? 'Satu zoom masuk perlahan; tanpa perpindahan kamera mendadak.' : 'Satu pan horizontal perlahan; tanpa beberapa gerakan kamera sekaligus.',
      visual: ugc ? 'Komposisi sederhana, pencahayaan merata, gaya natural. Logo, angka dan teks memakai aset resmi melalui compositing.'
        : 'Komposisi rapi dan pencahayaan terarah. Logo, angka dan teks memakai aset resmi melalui compositing.',
    } });
  };
  const current = values(form);
  const canApply = proposal && !proposal.applied && JSON.stringify(current) === JSON.stringify(proposal.before);
  const canUndo = proposal?.applied && JSON.stringify(current) === JSON.stringify(proposal.after);
  return <div className="rounded-xl bg-muted/50 p-3 text-xs" data-testid="motion-suggestion">
    <p className="font-semibold">Saran gerakan sederhana · aturan E-motion/1</p>
    <p className="mt-1 text-muted-foreground">Bukan hasil evaluasi AI. Belum terbukti lebih baik pada provider (NOT TESTED). Narasi, fakta, disclaimer dan arahan asli tidak diubah. Pilihan gerak render tetap ditentukan di halaman Video.</p>
    <button type="button" onClick={suggest} className="mt-2 rounded-lg bg-card px-3 py-2 ring-1 ring-border" data-testid="button-suggest-motion">Lihat saran {form.style === 'UGC' ? 'UGC' : 'Cinematic'} sebelum diterapkan</button>
    {proposal && <div className="mt-3 space-y-2">
      {fields.map(k => <div key={k} className="rounded-lg bg-background p-2"><strong>{labels[k]}</strong><p className="mt-1 whitespace-pre-wrap text-muted-foreground">Asli: {proposal.before[k] || '(kosong)'}</p><p className="mt-1 whitespace-pre-wrap">Saran: {proposal.after[k]}</p></div>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!canApply} onClick={() => { setForm(f => ({ ...f, ...proposal.after })); setProposal({ ...proposal, applied: true }); }} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-40" data-testid="button-apply-motion">Terapkan 4 perubahan ini</button>
        <button type="button" disabled={!canUndo} onClick={() => { setForm(f => ({ ...f, ...proposal.before })); setProposal({ ...proposal, applied: false }); }} className="rounded-lg bg-card px-3 py-2 disabled:opacity-40" data-testid="button-undo-motion">Kembalikan versi asli</button>
        <button type="button" onClick={() => setProposal(null)} className="rounded-lg px-3 py-2">Tutup saran</button>
      </div>
      <p className="text-muted-foreground">Perubahan belum tersimpan sampai Anda menyimpan konsep. Perubahan konsep yang disetujui tetap memerlukan review ulang. Jika isian sudah berubah, buat saran baru.</p>
    </div>}
  </div>;
}
