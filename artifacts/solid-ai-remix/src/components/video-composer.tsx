import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clapperboard, RotateCcw } from 'lucide-react';
import {
  useGetCreativeConcept, getGetCreativeConceptQueryKey, useCreateVideoJob, getListVideoJobsQueryKey, getGetVideoConfigQueryKey, getListCreativeConceptsQueryKey, getGetVideoJobQueryKey,
} from '@workspace/api-client-react';
import type {
  Character, CreativeConcept, VideoConfig, VideoCue, VideoJobInputMode, VideoRenderOptionsAiQuality, VideoRenderOptionsAiWorkflow, VideoRenderOptionsLogoPosition, VideoRenderOptionsMotion,
} from '@workspace/api-client-react';
import { ErrorBox } from '@/components/app-shell';
import { Pill } from '@/components/brand';
import { SafeAreaPreview } from '@/components/video-preview';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { errMsg, errStatus } from '@/lib/labels';
import { conceptStatusLabel, conceptStatusTone } from '@/lib/creative';
import { chunkScript, cueErrors, defaultCues, scriptWords, motionLabel, MAX_CTA, MAX_CUES, MAX_DISCLAIMER, MAX_SUBTITLE_WORDS } from '@/lib/video';
import { cn } from '@/lib/utils';

const AI_WORKFLOWS: { v: VideoRenderOptionsAiWorkflow; l: string; d: string }[] = [
  { v: 'I2V', l: 'Foto karakter (disarankan)', d: 'Foto karakter jadi frame pertama; wajah paling terjaga. Lampiran gambar tidak dipakai.' },
  { v: 'FIRST_LAST', l: 'Frame pertama + terakhir', d: 'Foto karakter di awal, gambar lampiran pertama di akhir.' },
  { v: 'REF2VA', l: 'Gambar referensi', d: 'Foto karakter + hingga 3 gambar lampiran (produk/UI) sebagai referensi. Kemiripan wajah bisa lebih rendah.' },
];
const MOTIONS: VideoRenderOptionsMotion[] = ['ZOOM_IN', 'ZOOM_OUT', 'PAN_LEFT', 'PAN_RIGHT'];
const inputCls = 'w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40';

export function VideoComposer({ conceptId, concepts, character, config, canWrite }: {
  conceptId: string; concepts: CreativeConcept[]; character: Character | null; config: VideoConfig; canWrite: boolean;
}) {
  const detail = useGetCreativeConcept(conceptId, { query: { enabled: !!conceptId, refetchOnWindowFocus: true, queryKey: getGetCreativeConceptQueryKey(conceptId) } });
  if (!conceptId) return <Empty title="Pilih konsep">Pilih konsep milik Anda yang sudah disetujui reviewer. {concepts.length === 0 && <><Link href="/creative" className="font-semibold text-primary underline">Susun dan ajukan konsep</Link> dulu.</>}</Empty>;
  if (detail.isLoading) return <Skeleton className="h-[520px] rounded-[28px]" />;
  if (detail.isError || !detail.data) return <ErrorBox message={errMsg(detail.error)} onRetry={() => detail.refetch()} />;
  return <Composer key={`${detail.data.id}-${detail.data.version}`} c={detail.data} character={character} config={config} canWrite={canWrite} refetch={() => detail.refetch()} refreshing={detail.isFetching} />;
}

function Composer({ c, character, config, canWrite, refetch, refreshing }: {
  c: CreativeConcept; character: Character | null; config: VideoConfig; canWrite: boolean; refetch: () => unknown; refreshing: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateVideoJob();
  const chunks = useMemo(() => chunkScript(c), [c]);
  const duration = c.durationSeconds;
  const logos = c.attachments.filter((a) => a.state === 'READY' && a.contentType.startsWith('image/'));
  const [mode, setMode] = useState<VideoJobInputMode>('HEMAT');
  const [aiWorkflow, setAiWorkflow] = useState<VideoRenderOptionsAiWorkflow>('I2V');
  const [aiQuality, setAiQuality] = useState<VideoRenderOptionsAiQuality>('FAST');
  const [motion, setMotion] = useState<VideoRenderOptionsMotion>('ZOOM_IN');
  const [logoPosition, setLogoPosition] = useState<VideoRenderOptionsLogoPosition>('TOP_RIGHT');
  const [logoId, setLogoId] = useState('');
  const [cues, setCues] = useState<VideoCue[]>(() => defaultCues(Math.min(chunks.length, MAX_CUES), duration));
  const [activeCue, setActiveCue] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  useEffect(() => { setActiveCue(0); }, [c.id]);

  const logo = logos.find((l) => l.id === logoId);
  const scenes = c.attachments.filter((a) => a.state === 'READY' && a.id !== logoId && (a.contentType.startsWith('image/') || a.contentType.startsWith('video/')));
  const audio = c.attachments.find((a) => a.state === 'READY' && a.contentType.startsWith('audio/'));
  const disclaimer = (c.disclaimer ?? '').trim();
  const ai = mode === 'AI';
  const aiImages = c.attachments.filter((a) => a.state === 'READY' && a.contentType.startsWith('image/'));
  const aiIgnored = c.attachments.filter((a) => a.state === 'READY' && !a.contentType.startsWith('image/'));

  const blockers: { msg: string; fix: 'edit' | 'review' | null }[] = [];
  if (c.status !== 'APPROVED') blockers.push({ msg: `Konsep berstatus ${conceptStatusLabel[c.status]}; harus disetujui reviewer.`, fix: 'review' });
  if (c.stale) blockers.push({ msg: 'Persetujuan usang. Ajukan review ulang.', fix: 'review' });
  if (ai) {
    if (c.mode !== 'AI') blockers.push({ msg: 'Konsep ini bermode Hemat. Ubah mode konsep ke AI, simpan, lalu ajukan review ulang.', fix: 'edit' });
    if (duration < 5 || duration > 15) blockers.push({ msg: 'Durasi AI harus 5–15 detik.', fix: 'edit' });
    if (!c.narration.trim()) blockers.push({ msg: 'Narasi kosong; suara dibuat model dari narasi.', fix: 'edit' });
    if (!config.aiEnabled) blockers.push({ msg: config.aiUnavailableReason ?? 'Provider AI tidak tersedia.', fix: null });
    if (aiWorkflow !== 'I2V' && aiImages.length === 0) blockers.push({ msg: 'Workflow ini membutuhkan minimal satu lampiran gambar.', fix: 'edit' });
  }
  if (!ai && c.format !== '9:16') blockers.push({ msg: 'Format harus 9:16 vertikal.', fix: 'edit' });
  if (!ai && (duration < 10 || duration > 15)) blockers.push({ msg: 'Durasi harus 10–15 detik.', fix: 'edit' });
  if (!ai && !chunks.length) blockers.push({ msg: 'Subtitle atau narasi kosong.', fix: 'edit' });
  if (!ai && scriptWords(c).length > MAX_SUBTITLE_WORDS) blockers.push({ msg: `Naskah maksimal ${MAX_SUBTITLE_WORDS} kata.`, fix: 'edit' });
  if (!ai && chunks.length > MAX_CUES) blockers.push({ msg: `Naskah menghasilkan ${chunks.length} cue; maksimal ${MAX_CUES}.`, fix: 'edit' });
  if (!ai && c.cta.trim().length > MAX_CTA) blockers.push({ msg: `CTA maksimal ${MAX_CTA} karakter.`, fix: 'edit' });
  if (!ai && !disclaimer) blockers.push({ msg: 'Disclaimer wajib diisi.', fix: 'edit' });
  if (!ai && disclaimer.length > MAX_DISCLAIMER) blockers.push({ msg: `Disclaimer maksimal ${MAX_DISCLAIMER} karakter.`, fix: 'edit' });
  if (ai) { /* logo and cues are Hemat-only */ }
  else if (!logos.length) blockers.push({ msg: 'Unggah logo resmi (gambar) sebagai bahan konsep, lalu ajukan review ulang.', fix: 'edit' });
  else if (!logo) blockers.push({ msg: 'Pilih logo dari bahan yang disetujui.', fix: null });
  if (!character) blockers.push({ msg: 'Karakter Anda tidak tersedia.', fix: null });
  if (config.paused) blockers.push({ msg: 'Produksi video sedang dijeda Admin.', fix: null });
  if (config.dailyUsed >= config.dailyLimit) blockers.push({ msg: `Kuota harian ${config.dailyLimit} sudah habis (${config.timezone}).`, fix: null });
  const cueErr = !ai && cues.length === chunks.length ? cueErrors(cues, duration) : [];
  const ready = canWrite && blockers.length === 0 && cueErr.length === 0;

  // AI jobs ignore motion/logo/cues (required by the shared schema only), so send neutral values.
  const input = ai
    ? { conceptId: c.id, version: c.version, mode, confirmed: true, options: { motion: 'ZOOM_IN' as const, logoPosition: 'TOP_RIGHT' as const, cues: [{ start: 0, end: duration }], aiWorkflow, aiQuality } }
    : { conceptId: c.id, version: c.version, mode, confirmed: true, options: { motion, logoPosition, logoAttachmentId: logoId, cues } };
  const sig = JSON.stringify(input);

  const setCue = (i: number, k: 'start' | 'end', v: string) => setCues((cs) => cs.map((x, j) => (j === i ? { ...x, [k]: Number(v) } : x)));

  const submit = () => {
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: crypto.randomUUID() };
    create.mutate({ data: { ...input, requestKey: keyRef.current.key } }, {
      onSuccess: (job) => {
        keyRef.current = null;
        setConfirmOpen(false); setAck(false);
        qc.setQueryData(getGetVideoJobQueryKey(job.id), job);
        void qc.invalidateQueries({ queryKey: getListVideoJobsQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetVideoConfigQueryKey() });
        void qc.invalidateQueries({ queryKey: getListCreativeConceptsQueryKey() });
        void refetch();
        toast({ title: 'Job video masuk antrean', description: 'Status diperbarui otomatis.' });
      },
      onError: (e) => {
        void refetch();
        toast({ title: errStatus(e) === 409 ? 'Konsep berubah' : 'Gagal membuat job', description: `${errMsg(e)} Coba lagi akan memakai kunci permintaan yang sama.`, variant: 'destructive' });
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-[24px] bg-card p-4 ring-1 ring-card-border">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xl font-bold" data-testid="text-video-concept">{c.title}</div>
          <div className="font-mono text-[10px] text-muted-foreground">v{c.version} · {c.format} · {duration} dtk</div>
        </div>
        <Pill tone={c.stale ? 'hot' : conceptStatusTone[c.status]}>{c.stale ? 'Usang' : conceptStatusLabel[c.status]}</Pill>
        <button onClick={() => refetch()} disabled={refreshing} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 text-xs disabled:opacity-50" data-testid="button-refresh-concept-status"><RotateCcw className="h-3.5 w-3.5" /> {refreshing ? 'Memuat...' : 'Cek status review'}</button>
      </div>

      {blockers.length > 0 && (
        <ul className="space-y-1.5" data-testid="list-video-blockers">
          {blockers.map((b) => (
            <li key={b.msg} className="flex flex-wrap items-center gap-2 rounded-xl bg-destructive/8 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" /> <span className="flex-1">{b.msg}</span>
              {b.fix && <Link href="/creative" className="text-xs font-semibold underline">{b.fix === 'edit' ? 'Edit konsep' : 'Buka review'}</Link>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="space-y-4 rounded-[28px] bg-card p-5 ring-1 ring-card-border">
          <Block label="Mode" hint={!config.aiEnabled && config.aiUnavailableReason ? `AI: ${config.aiUnavailableReason}` : undefined}>
            <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
              <button onClick={() => setMode('HEMAT')} aria-pressed={mode === 'HEMAT'} className={cn('rounded-lg py-1.5 text-sm font-medium', mode === 'HEMAT' && 'bg-card ring-1 ring-card-border')} data-testid="toggle-video-mode-HEMAT">Hemat (template)</button>
              <button onClick={() => setMode('AI')} aria-pressed={mode === 'AI'} disabled={!config.aiEnabled} title={config.aiEnabled ? 'Render AI di GPU (ComfyUI)' : (config.aiUnavailableReason ?? 'AI belum aktif')} className={cn('rounded-lg py-1.5 text-sm font-medium', mode === 'AI' && 'bg-card ring-1 ring-card-border', !config.aiEnabled && 'cursor-not-allowed font-normal text-muted-foreground/60')} data-testid="toggle-video-mode-AI">{config.aiEnabled ? 'ComfyUI (AI)' : 'ComfyUI (AI) · nonaktif'}</button>
            </div>
          </Block>
          {ai && (
            <Block label="Workflow AI" hint="Video dan suara dibuat model MiniMax H3 di GPU milik tim lewat ComfyUI. Render bisa memakan beberapa menit.">
              <div className="space-y-2" role="radiogroup" aria-label="Workflow AI">
                {AI_WORKFLOWS.map((w) => (
                  <label key={w.v} className={cn('flex cursor-pointer items-start gap-2 rounded-xl p-2 ring-1 ring-border', aiWorkflow === w.v && 'ring-2 ring-primary')}>
                    <input type="radio" name="ai-workflow" checked={aiWorkflow === w.v} onChange={() => setAiWorkflow(w.v)} className="mt-1" data-testid={`radio-ai-workflow-${w.v}`} />
                    <span className="text-sm"><span className="font-medium">{w.l}</span><span className="block text-xs text-muted-foreground">{w.d}</span></span>
                  </label>
                ))}
                <div className="grid grid-cols-2 rounded-xl bg-muted p-1 sm:max-w-xs">
                  {(['FAST', 'QUALITY'] as const).map((q) => <button key={q} onClick={() => setAiQuality(q)} aria-pressed={aiQuality === q} className={cn('rounded-lg py-1 text-xs', aiQuality === q && 'bg-card ring-1 ring-card-border')} data-testid={`toggle-ai-quality-${q}`}>{q === 'FAST' ? 'Cepat' : 'Kualitas (lebih lama)'}</button>)}
                </div>
                <p className="rounded-xl bg-accent/25 p-2 text-xs">Dikirim ke GPU: foto karakter{aiWorkflow !== 'I2V' ? ` dan ${aiWorkflow === 'FIRST_LAST' ? 1 : Math.min(aiImages.length, 3)} gambar lampiran` : ''}. Narasi dikirim sebagai teks ucapan bahasa Indonesia. {aiIgnored.length > 0 && `Tidak dipakai: ${aiIgnored.map((a) => a.name).join(', ')} (MP4/audio tidak didukung workflow).`} Hasil tetap wajib lewat review final; wajah, suara, dan klaim harus diperiksa manusia.</p>
              </div>
            </Block>
          )}
          {!ai && <>
          <Block label="Gerak kamera">
            <div className="flex flex-wrap gap-2">{MOTIONS.map((m) => <button key={m} onClick={() => setMotion(m)} aria-pressed={motion === m} className={cn('rounded-full px-3 py-1.5 text-sm ring-1 ring-border', motion === m ? 'bg-foreground text-background' : 'hover:bg-muted')} data-testid={`chip-motion-${m}`}>{motionLabel[m]}</button>)}</div>
          </Block>
          <Block label="Logo" hint="Hanya gambar bahan konsep yang sudah disetujui. Tidak ada logo bawaan.">
            {logos.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada gambar siap.</p> : (
              <div className="flex flex-wrap gap-2">
                {logos.map((l) => (
                  <button key={l.id} onClick={() => setLogoId(l.id)} aria-pressed={logoId === l.id} className={cn('h-16 w-16 overflow-hidden rounded-xl bg-muted ring-1 ring-border', logoId === l.id && 'ring-2 ring-primary')} data-testid={`button-logo-${l.id}`}>
                    <img src={l.url} alt={l.name} className="h-full w-full object-contain" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 rounded-xl bg-muted p-1 sm:max-w-xs">
              {(['TOP_LEFT', 'TOP_RIGHT'] as const).map((p) => <button key={p} onClick={() => setLogoPosition(p)} aria-pressed={logoPosition === p} className={cn('rounded-lg py-1 text-xs', logoPosition === p && 'bg-card ring-1 ring-card-border')} data-testid={`toggle-logo-${p}`}>{p === 'TOP_LEFT' ? 'Kiri atas' : 'Kanan atas'}</button>)}
            </div>
          </Block>
          <Block label="Urutan adegan" hint="Karakter selalu pertama, lalu bahan gambar/video lainnya.">
            <ol className="flex flex-wrap gap-1.5 text-xs">
              <li className="rounded-lg bg-sidebar px-2 py-1 text-sidebar-foreground">1. Karakter {character?.name ?? ''}</li>
              {scenes.map((s, i) => <li key={s.id} className="rounded-lg bg-muted px-2 py-1">{i + 2}. {s.name}</li>)}
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">Audio: {audio ? audio.name : 'tidak ada (opsional)'}. {config.narrationNote}</p>
          </Block>
          <Block label="Waktu cue" hint={`Naskah tetap, dipotong per 9 kata. Atur waktu 0–${duration} detik tanpa tumpang tindih.`}>
            <div className="space-y-2">
              {chunks.slice(0, MAX_CUES).map((t, i) => (
                <div key={i} className={cn('rounded-xl p-2 ring-1 ring-border', activeCue === i && 'ring-primary')} onFocus={() => setActiveCue(i)} data-testid={`row-cue-${i}`}>
                  <p className="text-sm">{t}</p>
                  <div className="mt-1.5 flex items-center gap-2 font-mono text-xs">
                    <input type="number" step="0.1" min={0} max={duration} value={cues[i]?.start ?? 0} onChange={(e) => setCue(i, 'start', e.target.value)} className={cn(inputCls, 'w-20 py-1')} aria-label={`Mulai cue ${i + 1}`} data-testid={`input-cue-start-${i}`} />
                    <span>→</span>
                    <input type="number" step="0.1" min={0} max={duration} value={cues[i]?.end ?? 0} onChange={(e) => setCue(i, 'end', e.target.value)} className={cn(inputCls, 'w-20 py-1')} aria-label={`Akhir cue ${i + 1}`} data-testid={`input-cue-end-${i}`} />
                    <span className="text-muted-foreground">dtk</span>
                  </div>
                </div>
              ))}
              {chunks.length > 0 && <button onClick={() => setCues(defaultCues(Math.min(chunks.length, MAX_CUES), duration))} className="text-xs underline" data-testid="button-reset-cues">Bagi rata ulang</button>}
              {cueErr.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
            </div>
          </Block>
          </>}
        </div>
        <div className="space-y-2">
          {!ai && <SafeAreaPreview photoUrl={character?.photoUrl} logoUrl={logo?.url} logoPosition={logoPosition} cue={chunks[activeCue]} cta={c.cta.trim()} disclaimer={disclaimer} />}
          {!ai && <p className="text-center text-[11px] text-muted-foreground">Perkiraan penempatan area aman, bukan hasil render.</p>}
          {ai && character?.photoUrl && <img src={character.photoUrl} alt="Foto karakter yang dikirim sebagai frame pertama" className="w-full rounded-2xl object-cover ring-1 ring-border" />}
        </div>
      </div>

      <button onClick={() => { setAck(false); setConfirmOpen(true); }} disabled={!ready || create.isPending} className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-open-confirm">
        {create.isPending ? 'Mengirim...' : 'Tinjau ringkasan dan antrekan'}
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Konfirmasi render</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <dl className="grid grid-cols-2 gap-2">
                  <dt>Konsep</dt><dd className="font-medium">{c.title} (v{c.version})</dd>
                  <dt>Mode</dt><dd>{ai ? `AI · ComfyUI (${aiWorkflow})` : `Hemat · ${config.provider}`}</dd>
                  <dt>Format</dt><dd>9:16 · {duration} dtk</dd>
                  {!ai && <><dt>Gerak</dt><dd>{motionLabel[motion]}</dd>
                  <dt>Logo</dt><dd>{logo?.name} · {logoPosition === 'TOP_LEFT' ? 'kiri atas' : 'kanan atas'}</dd>
                  <dt>Cue</dt><dd>{cues.length}</dd></>}
                  <dt>Kuota</dt><dd>{config.dailyUsed}/{config.dailyLimit} hari ini</dd>
                </dl>
                {ai && <p className="rounded-xl bg-accent/25 p-2 text-xs">Foto karakter dan gambar terpilih dikirim ke GPU milik tim lewat Cloudflare. Tidak ada tagihan provider; biaya listrik/GPU belum diukur (tidak diketahui, bukan nol).</p>}
                {!ai && <p className="rounded-xl bg-accent/25 p-2 text-xs">{config.costNote} Biaya yang tidak tercatat ditampilkan sebagai tidak diketahui, bukan nol.</p>}
                <p className="text-xs">{config.retentionNote} Hasil akhir tidak kedaluwarsa otomatis; hapus manual bila tidak dipakai. File sementara dibersihkan server.</p>
                <label className="flex items-start gap-2 text-xs text-foreground"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" data-testid="checkbox-confirm-cost" /> Saya sudah memeriksa ringkasan, biaya, dan naskah ini.</label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-confirm">Batal</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); submit(); }} disabled={!ack || create.isPending} data-testid="button-confirm-queue">{create.isPending ? 'Mengirim...' : 'Antrekan render'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Block({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}<div className="mt-1.5">{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[28px] border border-dashed bg-card/60 p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sidebar text-sidebar-primary"><Clapperboard className="h-5 w-5" /></div>
      <div className="font-display mt-4 text-2xl font-extrabold">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
