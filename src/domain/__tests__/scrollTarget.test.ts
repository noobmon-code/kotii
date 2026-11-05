import { describe, expect, it } from '@jest/globals';

import { SCROLL_TARGET_BOTTOM, SCROLL_TARGET_ROOM, SCROLL_TARGET_TOP, scrollTargetY } from '../scrollTarget';

// Até onde rolar a aba Família para mostrar o interruptor de um tipo de aviso: o título da seção no alto, com a linha
// abaixo dele e acima do botão do Nuke; senão a linha um pouco abaixo do alto; nunca além do fim.

describe('scrollTargetY', () => {
  it('as margens', () => {
    expect(SCROLL_TARGET_TOP).toBe(20);
    expect(SCROLL_TARGET_ROOM).toBe(64);
    expect(SCROLL_TARGET_BOTTOM).toBe(96);
  });

  it('a linha cabe com o título: para no título', () => {
    // 1390 - 1180 = 210, dentro dos 700 - 96 visíveis acima do Nuke.
    expect(scrollTargetY({ sectionTop: 1200, row: { top: 1300, height: 90 }, viewport: 700, content: 3000 })).toBe(1180);
  });

  it('a linha longe do título: o alto da linha, 64 abaixo do alto da tela', () => {
    expect(scrollTargetY({ sectionTop: 1200, row: { top: 1900, height: 90 }, viewport: 700, content: 3000 })).toBe(1836);
  });

  it('a linha mais alta que a tela: o alto dela, não o fim', () => {
    expect(scrollTargetY({ sectionTop: 1200, row: { top: 1300, height: 900 }, viewport: 700, content: 3000 })).toBe(1236);
  });

  it('nunca além do fim da página', () => {
    expect(scrollTargetY({ sectionTop: 1200, row: { top: 1900, height: 90 }, viewport: 700, content: 2000 })).toBe(1300);
  });

  it('conteúdo menor que a tela, seção no alto ou sem a linha', () => {
    expect(scrollTargetY({ sectionTop: 300, row: { top: 400, height: 90 }, viewport: 700, content: 600 })).toBe(0);
    expect(scrollTargetY({ sectionTop: 10, row: null, viewport: 700, content: 3000 })).toBe(0);
    expect(scrollTargetY({ sectionTop: 1200, row: null, viewport: 700, content: 3000 })).toBe(1180);
  });

  it('sempre um inteiro', () => {
    expect(scrollTargetY({ sectionTop: 1200.6, row: { top: 1300.2, height: 90.4 }, viewport: 700.5, content: 3000.3 })).toBe(1181);
  });
});
