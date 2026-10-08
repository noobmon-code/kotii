// Instalar o Kotii pelo navegador (PWA). Só existe na web: no Android/Chrome
// o navegador oferece o convite (beforeinstallprompt), guardado aqui para o
// botão do app; no iPhone é pelo menu Compartilhar do Safari.

import { useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISSED_KEY = 'kotii:install-dismissed';
const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (isWeb) {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se apresenta como Mac, mas tem toque.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * `prompt`: o navegador deixa instalar com um toque; `ios`: mostrar o passo a
 * passo do Safari; `hidden`: fora da web, já instalado ou dispensado.
 */
export function useInstallApp() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const [dismissed, setDismissed] = useState(() => (isWeb ? readDismissed() : true));

  let mode: 'hidden' | 'prompt' | 'ios' = 'hidden';
  if (isWeb && !dismissed && !isStandalone()) mode = prompt ? 'prompt' : isIOS() ? 'ios' : 'hidden';

  async function install() {
    if (!deferred) return;
    const event = deferred;
    deferred = null;
    notify();
    await event.prompt();
  }

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // sem armazenamento: some só nesta visita
    }
  }

  return { mode, install, dismiss };
}
