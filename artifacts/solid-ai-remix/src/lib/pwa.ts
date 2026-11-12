import { useEffect, useState } from 'react';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {
      console.warn('Fitur PWA offline belum berhasil didaftarkan. Studio tetap dapat digunakan saat online.');
    });
  });
}

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const done = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', on);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  return {
    canInstall: !!evt,
    install: async () => {
      if (!evt) return;
      await evt.prompt();
      await evt.userChoice.catch(() => undefined);
      setEvt(null);
    },
  };
}
