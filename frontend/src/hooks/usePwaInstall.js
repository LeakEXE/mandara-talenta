import { useState, useEffect } from 'react';

// Captures the browser's PWA install prompt so the UI can offer an
// explicit "Install App" button. Fires on Chromium desktop/Android.
// iOS Safari never fires beforeinstallprompt (every iOS browser is WebKit
// under the hood), so iOS users install manually via Share > Add to Home
// Screen — the hook exposes isIos/isInstalled so the UI can show
// instructions instead of nothing.
function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iphone|ipod/i.test(ua)) return true;
  if (/ipad/i.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh; multi-touch distinguishes it.
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;
  return false;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS-specific installed flag.
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  return false;
}

export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [isIos] = useState(isIosDevice);
  const [isInstalled, setIsInstalled] = useState(isStandalone);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPromptEvent(e);
    };
    const installedHandler = () => {
      setPromptEvent(null);
      setIsInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return false;
    promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
    return true;
  };

  return { canInstall: !!promptEvent, install, isIos, isInstalled };
}
