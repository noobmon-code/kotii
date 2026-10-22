// O tema escolhido em Configurações, para o app inteiro: lido uma vez do aparelho ao abrir (lib/themeChoice) e
// dado pelo ThemeChoiceContext, que o useScheme (ui/theme) junta com o tema do celular. Enquanto a leitura não
// termina, vale o do celular, e o _layout segura a abertura (`ready`) para não piscar o tema errado.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';

import type { Scheme, ThemeChoice } from '@/domain/appearance';
import { readThemeChoice, saveThemeChoice } from '@/lib/themeChoice';

import { ThemeChoiceContext, useColors, useScheme } from './theme';

export function ThemeChoiceProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>('auto');
  const [ready, setReady] = useState(false);
  // Uma escolha feita antes de a leitura terminar vale mais que a que estava guardada.
  const chosen = useRef(false);

  useEffect(() => {
    let active = true;
    readThemeChoice().then((stored) => {
      if (!active) return;
      if (!chosen.current) setChoiceState(stored);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // No celular, os avisos, o teclado e os seletores do próprio sistema seguem a escolha também (o React só pinta o
  // que é do app). "Automático" devolve o tema do celular. A web não tem isso: lá vale o PageScheme.
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(choice === 'auto' ? 'unspecified' : choice);
  }, [choice]);

  const setChoice = (next: ThemeChoice) => {
    chosen.current = true;
    setChoiceState(next);
    void saveThemeChoice(next);
  };

  return (
    <ThemeChoiceContext.Provider value={{ choice, ready, setChoice }}>
      {Platform.OS === 'web' ? <PageScheme /> : null}
      {children}
    </ThemeChoiceContext.Provider>
  );
}

/** No navegador, a página acompanha o tema do app: os controles do navegador e o fundo atrás do app. */
function PageScheme() {
  const scheme = useScheme();
  const { background } = useColors();
  useEffect(() => {
    if (typeof document !== 'undefined') applyPageScheme(document, scheme, background);
  }, [scheme, background]);
  return null;
}

/**
 * O `color-scheme` da página (barras de rolagem, campos e calendário do navegador), a cor do fundo (o que
 * aparece atrás do app ao puxar a tela) e a cor da barra do navegador (`theme-color`, que no index.html
 * segue o celular).
 */
export function applyPageScheme(doc: Document, scheme: Scheme, background: string) {
  doc.documentElement.style.colorScheme = scheme;
  doc.body.style.backgroundColor = background;
  doc.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', background));
}
