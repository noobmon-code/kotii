// Onde uma parte da tela está dentro do conteúdo que rola, medido na hora: para rolar até ela numa tela que já está
// montada (onLayout não serve: no navegador ele só avisa quando a caixa muda de tamanho, não quando o que vem antes
// a empurra para baixo, e numa aba que já estava aberta nada é medido de novo). Mede em relação à caixa de dentro do
// ScrollView (getInnerViewRef, que existe no React Native e no react-native-web, mas não nos tipos), como os dois
// fazem para rolar até o campo com o teclado. Qualquer falta (sem a caixa, tamanho 0 de uma aba escondida no
// navegador, erro, nenhuma resposta) é null: quem chama espera e tenta de novo, ou desiste.

import type { ScrollView, View } from 'react-native';

/** Sem resposta nesse tempo, a medida não vem mais (o navegador não responde quando falta uma das caixas). */
export const MEASURE_TIMEOUT_MS = 1000;

type MeasureCallback = (x: number, y: number, width: number, height: number) => void;

interface Measurable {
  measure?: (callback: MeasureCallback) => void;
  measureLayout?: (relativeTo: unknown, onSuccess: MeasureCallback, onFail?: () => void) => void;
}

interface ScrollRefs {
  getInnerViewRef?: () => unknown;
  getNativeScrollRef?: () => unknown;
}

/** Espera uma resposta de medida; null se não vier em MEASURE_TIMEOUT_MS ou se o pedido falhar. */
function ask<T>(start: (done: (value: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => done(null), MEASURE_TIMEOUT_MS);
    function done(value: T | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }
    try {
      start(done);
    } catch {
      done(null);
    }
  });
}

const innerOf = (scroll: ScrollView | null) => (scroll as unknown as ScrollRefs | null)?.getInnerViewRef?.() ?? null;

/** O alto e a altura de `node` dentro do conteúdo que rola. */
export function measureInScroll(
  scroll: ScrollView | null,
  node: View | null,
): Promise<{ top: number; height: number } | null> {
  const inner = innerOf(scroll);
  const target = node as unknown as Measurable | null;
  if (!inner || !target?.measureLayout) return Promise.resolve(null);
  return ask((done) =>
    target.measureLayout!(
      inner,
      (_x, y, _width, height) => done(height > 0 && Number.isFinite(y) ? { top: y, height } : null),
      () => done(null),
    ),
  );
}

/** A altura da parte visível e a do conteúdo inteiro. */
export async function measureScrollArea(scroll: ScrollView | null): Promise<{ viewport: number; content: number } | null> {
  const outer = (scroll as unknown as ScrollRefs | null)?.getNativeScrollRef?.() as Measurable | null | undefined;
  const inner = innerOf(scroll) as Measurable | null;
  if (!outer?.measure || !inner?.measure) return null;
  const heightOf = (node: Measurable) =>
    ask<number>((done) => node.measure!((_x, _y, _width, height) => done(height > 0 ? height : null)));
  const [viewport, content] = await Promise.all([heightOf(outer), heightOf(inner)]);
  return viewport && content ? { viewport, content } : null;
}
