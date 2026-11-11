import type { VideoRenderOptionsLogoPosition } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

export function SafeAreaPreview({ photoUrl, logoUrl, logoPosition, cue, cta, disclaimer }: {
  photoUrl?: string; logoUrl?: string; logoPosition: VideoRenderOptionsLogoPosition; cue?: string; cta: string; disclaimer: string;
}) {
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-[22px] bg-sidebar ring-1 ring-card-border" data-testid="preview-safe-area">
      {photoUrl ? <img src={photoUrl} alt="Foto karakter" className="absolute inset-0 h-full w-full object-contain" /> : <div className="absolute inset-0 grid place-items-center text-xs text-sidebar-foreground/60">Foto karakter tidak tersedia</div>}
      <div className="pointer-events-none absolute inset-[10%_14.5%_15.6%_6.7%] rounded-xl border border-dashed border-sidebar-primary/80" aria-hidden="true" />
      {logoUrl && (
        <img src={logoUrl} alt="Logo terpilih" className={cn('absolute top-[11%] h-[7.8%] max-w-[21%] object-contain', logoPosition === 'TOP_LEFT' ? 'left-[7%]' : 'right-[14.5%]')} data-testid="img-preview-logo" />
      )}
      <div className="absolute left-[6.7%] right-[14.5%] top-[53.75%] h-[30.6%] rounded-lg bg-sidebar/90" />
      {cue && <p className="absolute left-[10%] right-[18%] top-[57%] text-center text-[8.3px] leading-snug text-sidebar-foreground" data-testid="text-preview-cue">{cue}</p>}
      {cta && <p className="absolute left-[10%] right-[18%] top-[71.3%] text-center text-[8px] font-semibold leading-snug text-sidebar-primary">{cta}</p>}
      {disclaimer && <p className="absolute left-[10%] right-[18%] top-[77.2%] text-center text-[6px] leading-tight text-sidebar-foreground">{disclaimer}</p>}
      <span className="absolute left-2 top-2 rounded bg-sidebar/80 px-1.5 py-0.5 font-mono text-[8px] uppercase text-sidebar-primary">Perkiraan</span>
    </div>
  );
}
