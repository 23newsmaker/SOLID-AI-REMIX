import type { VideoRenderOptionsLogoPosition } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

export function SafeAreaPreview({ photoUrl, logoUrl, logoPosition, cue, cta, disclaimer }: {
  photoUrl?: string; logoUrl?: string; logoPosition: VideoRenderOptionsLogoPosition; cue?: string; cta: string; disclaimer: string;
}) {
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-[22px] bg-sidebar ring-1 ring-card-border" data-testid="preview-safe-area">
      {photoUrl ? <img src={photoUrl} alt="Foto karakter" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 grid place-items-center text-xs text-sidebar-foreground/60">Foto karakter tidak tersedia</div>}
      <div className="pointer-events-none absolute inset-[6%_7%_14%_7%] rounded-xl border border-dashed border-sidebar-primary/80" aria-hidden="true" />
      {logoUrl && (
        <img src={logoUrl} alt="Logo terpilih" className={cn('absolute top-[7%] h-[9%] max-w-[32%] object-contain', logoPosition === 'TOP_LEFT' ? 'left-[9%]' : 'right-[9%]')} data-testid="img-preview-logo" />
      )}
      <div className="absolute inset-x-[9%] bottom-[16%] space-y-1.5 text-center">
        {cue && <p className="rounded-lg bg-sidebar/80 px-2 py-1 text-[11px] font-semibold leading-snug text-sidebar-foreground" data-testid="text-preview-cue">{cue}</p>}
        {cta && <p className="rounded-lg bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">{cta}</p>}
      </div>
      {disclaimer && <p className="absolute inset-x-[7%] bottom-[4%] text-center text-[7.5px] leading-tight text-sidebar-foreground/90">{disclaimer}</p>}
      <span className="absolute left-2 top-2 rounded bg-sidebar/80 px-1.5 py-0.5 font-mono text-[8px] uppercase text-sidebar-primary">Perkiraan</span>
    </div>
  );
}
