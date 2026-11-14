import { describe, expect, it } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { FEATURES } from '@/lib/features';

// As rotas de Finanças ficam atrás da chave (lib/features). Uma rota que o layout não declara entra no navegador
// sozinha (o Expo Router acrescenta as que faltam), sem guarda nenhuma: por isso cada tela de Finanças, o endereço
// antigo da aba inclusive (/financas, que hoje só leva à parte Finanças da aba Casa), tem de estar declarada dentro
// de um Protected cuja guarda consulta FEATURES.finance.

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
  it('Finanças não é mais uma aba: o endereço antigo, /financas, é uma rota do navegador de fora, atrás da chave', () => {
    expect(existsSync(join(APP, '(tabs)', 'financas.tsx'))).toBe(false);
    expect(read('(tabs)/_layout.tsx')).not.toContain('name="financas"');
    expect(existsSync(join(APP, 'financas.tsx'))).toBe(true);
    expect(guards(read('_layout.tsx')).get('financas')).toBe('inHousehold && FEATURES.finance');
    // Ela só redireciona (domain/tabs): não desenha tela nenhuma de Finanças.
    expect(read('financas.tsx')).toMatch(/<Redirect href=/);
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
