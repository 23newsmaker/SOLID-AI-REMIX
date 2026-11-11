import type { CreativeConcept, VideoCue, VideoJob, VideoJobStatus, VideoRenderOptionsMotion } from '@workspace/api-client-react';

export const ACTIVE_STATUSES: VideoJobStatus[] = ['DRAFT', 'READY', 'QUEUED', 'SUBMITTED', 'PROCESSING'];
export const isActive = (j: VideoJob) => ACTIVE_STATUSES.includes(j.status);

export const jobStatusLabel: Record<VideoJobStatus, string> = {
  DRAFT: 'Draft', READY: 'Siap', QUEUED: 'Antre', SUBMITTED: 'Dikirim', PROCESSING: 'Diproses',
  COMPLETED: 'Selesai', FAILED: 'Gagal', CANCELLED: 'Dibatalkan', UNKNOWN: 'Tidak diketahui', SIMULATED: 'Simulasi',
};
export const jobStatusTone: Record<VideoJobStatus, 'muted' | 'sun' | 'ok' | 'hot' | 'ink'> = {
  DRAFT: 'muted', READY: 'muted', QUEUED: 'sun', SUBMITTED: 'sun', PROCESSING: 'sun',
  COMPLETED: 'ok', FAILED: 'hot', CANCELLED: 'muted', UNKNOWN: 'hot', SIMULATED: 'ink',
};
export const motionLabel: Record<VideoRenderOptionsMotion, string> = {
  ZOOM_IN: 'Zoom masuk', ZOOM_OUT: 'Zoom keluar', PAN_LEFT: 'Geser kiri', PAN_RIGHT: 'Geser kanan',
};

export const MAX_SUBTITLE_WORDS = 108;
export const MAX_CTA = 90;
export const MAX_DISCLAIMER = 220;
export const MAX_CUES = 12;

export function scriptSource(c: Pick<CreativeConcept, 'subtitle' | 'narration'>): string {
  return c.subtitle.trim() || c.narration.trim();
}
export function scriptWords(c: Pick<CreativeConcept, 'subtitle' | 'narration'>): string[] {
  return scriptSource(c).split(/\s+/).filter(Boolean);
}
export function chunkScript(c: Pick<CreativeConcept, 'subtitle' | 'narration'>): string[] {
  const w = scriptWords(c);
  const out: string[] = [];
  for (let i = 0; i < w.length; i += 9) out.push(w.slice(i, i + 9).join(' '));
  return out;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
export function defaultCues(n: number, duration: number): VideoCue[] {
  return Array.from({ length: n }, (_, i) => ({ start: r2((i * duration) / n), end: r2(((i + 1) * duration) / n) }));
}
export function cueErrors(cues: VideoCue[], duration: number): string[] {
  const m: string[] = [];
  cues.forEach((c, i) => {
    if (!(c.start >= 0 && c.end <= duration)) m.push(`Cue ${i + 1}: waktu harus 0–${duration} detik.`);
    if (!(c.end > c.start)) m.push(`Cue ${i + 1}: akhir harus setelah mulai.`);
    if (i > 0 && c.start < cues[i - 1].end) m.push(`Cue ${i + 1}: tumpang tindih dengan cue ${i}.`);
  });
  return m;
}

export function usd(n: number | null | undefined): string {
  return n === null || n === undefined ? 'Tidak diketahui' : `US$${n.toFixed(4)}`;
}
