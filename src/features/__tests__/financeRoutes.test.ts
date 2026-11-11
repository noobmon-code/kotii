import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { FEATURES } from '@/lib/features';

// As rotas de Finanças ficam atrás da chave (lib/features) nos dois navegadores. Uma rota que o layout não declara
// entra no navegador sozinha (o Expo Router acrescenta as que faltam), sem guarda nenhuma: por isso cada tela de
// Finanças, a aba inclusive, tem de estar declarada dentro de um Protected cuja guarda consulta FEATURES.finance.

const APP = join(__dirname, '..', '..', 'app');
const read = (file: string) => readFileSync(join(APP, file), 'utf8');

/** A guarda de cada tela declarada num Protected do layout (as de fora não aparecem). */
function guards(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of source.matchAll(/<(Stack|Tabs)\.Protected guard=\{([^}]*)\}>([\s\S]*?)<\/\1\.Protected>/g)) {
    for (const screen of block[3].matchAll(/<\w+\.Screen name="([^"]+)"/g)) out.set(screen[1], block[2]);
  }
  return out;
}

describe('as rotas de Finanças', () => {
  it('a aba só entra com a chave', () => {
    expect(guards(read('(tabs)/_layout.tsx')).get('financas')).toBe('FEATURES.finance');
  });

  it('as telas de Finanças só abrem numa casa e com a chave, o consultor inteiro inclusive', () => {
    const consultor = readdirSync(join(APP, 'consultor'))
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => `consultor/${file.replace(/\.tsx$/, '')}`);
    const screens = ['orcamento', 'conta/[id]', 'gasto/[id]', 'imposto-de-renda', ...consultor];
    expect(consultor).toEqual(expect.arrayContaining(['consultor/index', 'consultor/lancamentos', 'consultor/conversa']));
    const declared = guards(read('_layout.tsx'));
    for (const screen of screens) expect([screen, declared.get(screen)]).toEqual([screen, 'inHousehold && FEATURES.finance']);
  });

  it('a chave sai ligada nesta versão', () => {
    expect(FEATURES.finance).toBe(true);
  });
});
