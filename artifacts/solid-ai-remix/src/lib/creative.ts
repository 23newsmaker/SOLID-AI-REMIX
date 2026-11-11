import type { CreativeConcept, CreativeConceptInput, CreativeConceptStatus, CreativeSegment } from '@workspace/api-client-react';

export const segmentLabel: Record<CreativeSegment, string> = {
  MIKRO: 'Mikro',
  MINI: 'Mini',
  REGULAR: 'Regular',
  NONE: 'Tidak terkait produk',
};

export const conceptStatusLabel: Record<CreativeConceptStatus, string> = {
  DRAFT: 'Draft',
  READY_FOR_REVIEW: 'Siap ditinjau',
  UNDER_REVIEW: 'Sedang ditinjau',
  REVISED: 'Perlu revisi',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

export const conceptStatusTone: Record<CreativeConceptStatus, 'muted' | 'sun' | 'ok' | 'hot'> = {
  DRAFT: 'muted',
  READY_FOR_REVIEW: 'sun',
  UNDER_REVIEW: 'sun',
  REVISED: 'hot',
  APPROVED: 'ok',
  REJECTED: 'hot',
};

export const reviewActionLabel: Record<string, string> = {
  READY_FOR_REVIEW: 'Diajukan',
  DRAFT: 'Ditarik ke draft',
  UNDER_REVIEW: 'Mulai ditinjau',
  REVISED: 'Diminta revisi',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

export function emptyInput(characterId = ''): CreativeConceptInput {
  return {
    title: '',
    characterId,
    categoryId: '',
    segments: ['MIKRO'],
    style: 'UGC',
    mode: 'HEMAT',
    templateId: null,
    purpose: '',
    direction: '',
    scenes: '',
    characterMotion: '',
    cameraMotion: '',
    visual: '',
    narration: '',
    subtitle: '',
    cta: '',
    disclaimer: '',
    format: '9:16',
    durationSeconds: 12,
    sourceIds: [],
    publicMode: true,
    materialConsent: false,
    factIds: [],
    noFactualClaims: false,
  };
}

export function toInput(c: CreativeConcept): CreativeConceptInput {
  return {
    title: c.title,
    characterId: c.characterId,
    categoryId: c.categoryId,
    segments: [...c.segments],
    style: c.style,
    mode: c.mode,
    templateId: c.templateId,
    purpose: c.purpose,
    direction: c.direction,
    scenes: c.scenes,
    characterMotion: c.characterMotion,
    cameraMotion: c.cameraMotion,
    visual: c.visual,
    narration: c.narration,
    subtitle: c.subtitle,
    cta: c.cta,
    disclaimer: c.disclaimer ?? '',
    format: c.format,
    durationSeconds: c.durationSeconds,
    sourceIds: [...c.sourceIds],
    publicMode: c.publicMode,
    materialConsent: c.materialConsent,
    factIds: [...(c.factIds ?? [])],
    noFactualClaims: c.noFactualClaims ?? false,
  };
}

export function prettyPrompt(p: string): string {
  try {
    return JSON.stringify(JSON.parse(p), null, 2);
  } catch {
    return p;
  }
}

export function fmtBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}

export function toggleSegment(cur: CreativeSegment[], s: CreativeSegment): CreativeSegment[] {
  if (s === 'NONE') return cur.includes('NONE') ? ['MIKRO'] : ['NONE'];
  const base = cur.filter((x) => x !== 'NONE');
  const next = base.includes(s) ? base.filter((x) => x !== s) : [...base, s];
  return next.length ? next : base;
}
