// Home-screen install: is the app already installed, which device is this, and can the browser prompt?

import { useEffect, useState } from 'react';

export type InstallPlatform = 'ios' | 'android' | 'other';

/** Chrome's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function platformOf(userAgent: string, platform: string, maxTouchPoints: number): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

/** Running as an installed app (home-screen icon), without the browser's own bars. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = (q: string) => window.matchMedia?.(q).matches ?? false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || media('(display-mode: standalone)') || media('(display-mode: fullscreen)');
}

export interface Install {
  standalone: boolean;
  platform: InstallPlatform;
  /** The browser can show its own install dialog (Chrome / Edge / Android). */
  canPrompt: boolean;
  prompt: () => Promise<void>;
}

export function useInstall(): Install {
  const [standalone, setStandalone] = useState(isStandalone);
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  const [platform] = useState(() =>
    platformOf(navigator.userAgent, navigator.platform ?? '', navigator.maxTouchPoints ?? 0),
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setEvent(null);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return {
    standalone,
    platform,
    canPrompt: event !== null,
    prompt: async () => {
      if (!event) return;
      await event.prompt();
      await event.userChoice.catch(() => undefined);
      setEvent(null); // a prompt can only be used once
    },
  };
}
