import { useState, useEffect } from 'react';

// Captures the browser's PWA install prompt so the UI can offer an
// explicit "Install App" button. Fires on Chromium desktop/Android;
// absent on iOS (users install via Share > Add to Home Screen) and when
// the app is already installed.
export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!promptEvent) return false;
    promptEvent.prompt();
    await promptEvent.userChoice;
    setPromptEvent(null);
    return true;
  };

  return { canInstall: !!promptEvent, install };
}
