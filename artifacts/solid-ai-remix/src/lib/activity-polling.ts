const IDLE_AFTER_MS = 60_000;
let lastInteraction = Date.now();

export function pollingInterval(ms: number, activeJob = false): number | false {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
  return activeJob || Date.now() - lastInteraction < IDLE_AFTER_MS ? ms : false;
}

/** Wake stale active queries on interaction or return from inactivity.
 * Polling itself never extends the human-activity window. */
export function installActivityRefresh(refresh: () => void) {
  const interact = () => {
    const wasIdle = Date.now() - lastInteraction >= IDLE_AFTER_MS;
    lastInteraction = Date.now();
    if (wasIdle && document.visibilityState === 'visible') refresh();
  };
  const visible = () => { if (document.visibilityState === 'visible') interact(); };
  window.addEventListener('pointerdown', interact, { passive: true });
  window.addEventListener('keydown', interact);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('focus', interact);
  return () => {
    window.removeEventListener('pointerdown', interact);
    window.removeEventListener('keydown', interact);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('focus', interact);
  };
}

export const ACTIVITY_REFRESH = {
  staleTime: 15_000,
  refetchOnWindowFocus: 'always',
  refetchIntervalInBackground: false,
  refetchInterval: () => pollingInterval(30_000),
} as const;
