import { useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';

import { gazeAt, gazeHoldMs, sameGaze, type Gaze } from '@/domain/nukeGaze';

/** A conversa rola até o fim quando a mensagem entra: só depois disso ela está onde vai ficar. */
const SETTLE_MS = 350;

/**
 * O olhar do Nuke do cabeçalho da conversa: quando entra uma mensagem (a de quem escreve ou a dele), ele vira os
 * olhos para ela pelo tempo de `gazeHoldMs` e depois volta a olhar em volta. `nukeRef` vai na View em volta do
 * Nuke e `messageRef` na bolha da última mensagem (`last`); as duas com `collapsable={false}`, para o Android
 * não as tirar da árvore. A mensagem que já estava na conversa ao abrir a tela não é novidade.
 */
export function useNukeGaze(last: { id: string; role: 'user' | 'assistant' } | undefined) {
  const nukeRef = useRef<View>(null);
  const messageRef = useRef<View>(null);
  const [gaze, setGaze] = useState<Gaze | null>(null);
  const lastId = last?.id;
  const holdMs = gazeHoldMs(last?.role ?? 'assistant');
  const opened = useRef({ pending: true, lastId });

  useEffect(() => {
    if (opened.current.pending && opened.current.lastId === lastId) return;
    opened.current.pending = false;
    let live = true;
    let release: ReturnType<typeof setTimeout> | undefined;
    const aim = setTimeout(() => {
      const nuke = nukeRef.current;
      const message = messageRef.current;
      if (!lastId || !nuke || !message) {
        setGaze(null);
        return;
      }
      nuke.measureInWindow((nx, ny, nw, nh) => {
        message.measureInWindow((mx, my, mw, mh) => {
          if (!live) return;
          const next = gazeAt({ x: nx, y: ny, width: nw, height: nh }, { x: mx, y: my, width: mw, height: mh });
          setGaze((shown) => (sameGaze(shown, next) ? shown : next));
          release = setTimeout(() => setGaze(null), holdMs);
        });
      });
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(aim);
      if (release) clearTimeout(release);
    };
  }, [lastId, holdMs]);

  return { nukeRef, messageRef, gaze };
}
