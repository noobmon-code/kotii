import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

import * as server from '../../../supabase/functions/_shared/packageSize';
import { packageLabel, packageSize, samePackageSize, sharedPackageSize } from '../packageSize';

/** O tamanho como "unidade quantidade · rótulo", para comparar de uma vez. */
const read = (description: string) => {
  const size = packageSize(description);
  return size && `${size.unit} ${Math.round(size.amount * 1e6) / 1e6} · ${size.label}`;
};

describe('o tamanho da embalagem na descrição da nota', () => {
  it('lê peso e volume, colados ou não ao número', () => {
    expect(read('ARROZ TIO JOAO T1 5KG')).toBe('kg 5 · 5 kg');
    expect(read('ARROZ CAMIL 1KG')).toBe('kg 1 · 1 kg');
    expect(read('FEIJAO CARIOCA KICALDO 500 G')).toBe('kg 0.5 · 500 g');
    expect(read('PAO FORMA PULLMAN 500GR')).toBe('kg 0.5 · 500 g');
    expect(read('ACUCAR REFINADO UNIAO 5 KG')).toBe('kg 5 · 5 kg');
    expect(read('SABAO PO OMO 1,6KG')).toBe('kg 1.6 · 1,6 kg');
    expect(read('REFRIG COCA COLA PET 2L')).toBe('l 2 · 2 L');
    expect(read('CERV SKOL LT 350ML')).toBe('l 0.35 · 350 ml');
    expect(read('AGUA MIN CRYSTAL 1,5L')).toBe('l 1.5 · 1,5 L');
    expect(read('AGUA MIN CRYSTAL 1.5L')).toBe('l 1.5 · 1,5 L');
    expect(read('AZEITE GALLO EXTRA VIRGEM 500ML')).toBe('l 0.5 · 500 ml');
    expect(read('SUCO DEL VALLE UVA 1 LITRO')).toBe('l 1 · 1 L');
    expect(read('Café Pilão 500 g')).toBe('kg 0.5 · 500 g');
  });

  it('mil gramas com ponto de milhar são 1 kg', () => {
    expect(read('LEITE PO NINHO 1.000G')).toBe('kg 1 · 1 kg');
    expect(read('AMACIANTE COMFORT 1.500ML')).toBe('l 1.5 · 1,5 L');
  });

  it('o ponto depois de letra separa, como o espaço: "QJ.MUSS.2X200G" é 2 x 200 g, como no servidor', () => {
    expect(read('QJ.MUSS.2X200G')).toBe('kg 0.4 · 2 x 200 g');
  });

  it('o tamanho colado a um ponto depois de letra: "PTO.PERU SADIA.200G" é 200 g', () => {
    expect(read('PTO.PERU SADIA.200G')).toBe('kg 0.2 · 200 g');
  });

  it('a contagem colada a um ponto depois de letra também conta: "QJ 1.5KG.C/2" é 2 x 1,5 kg', () => {
    expect(read('QJ 1.5KG.C/2')).toBe('kg 3 · 2 x 1,5 kg');
  });

  it('o ponto entre dígitos é decimal: "ARROZ 1.5KG" é 1,5 kg, e "QJ 0.2X200G" é 200 g, porque 0,2 não é contagem', () => {
    expect(read('ARROZ 1.5KG')).toBe('kg 1.5 · 1,5 kg');
    expect(read('QJ 0.2X200G')).toBe('kg 0.2 · 200 g');
  });

  it('o ponto depois de dígito não separa, como no servidor: "QUEIJO 200.G" não tem tamanho e "QJ 2.X200G" é 200 g', () => {
    expect(read('QUEIJO 200.G')).toBeNull();
    expect(read('QJ 2.X200G')).toBe('kg 0.2 · 200 g');
  });

  it('multiplica o pacote com vários do mesmo tamanho', () => {
    expect(read('CERV BRAHMA 12X350ML')).toBe('l 4.2 · 12 x 350 ml');
    expect(read('CERV BRAHMA 12 X 350ML')).toBe('l 4.2 · 12 x 350 ml');
    expect(read('CERV BRAHMA 350MLX12')).toBe('l 4.2 · 12 x 350 ml');
    expect(read('CERV SKOL LT 350ML C/12')).toBe('l 4.2 · 12 x 350 ml');
    expect(read('LEITE UHT ITALAC INT 1L CX12')).toBe('l 12 · 12 x 1 L');
    expect(read('BISC RECHEADO TRAKINAS 3X126G')).toBe('kg 0.378 · 3 x 126 g');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "CX 12X350ML" é 4,2 L', () => {
    expect(read('CX 12X350ML')).toBe('l 4.2 · 12 x 350 ml');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "FD.6X350ML" é 2,1 L', () => {
    expect(read('FD.6X350ML')).toBe('l 2.1 · 6 x 350 ml');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "QJ.MUSS.2X200G.C/2" é 0,4 kg', () => {
    expect(read('QJ.MUSS.2X200G.C/2')).toBe('kg 0.4 · 2 x 200 g');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "QUEIJO 2X200G C/2" é 0,4 kg', () => {
    expect(read('QUEIJO 2X200G C/2')).toBe('kg 0.4 · 2 x 200 g');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "QJ 200G X 2 C/3" é 0,4 kg, como no servidor', () => {
    expect(read('QJ 200G X 2 C/3')).toBe('kg 0.4 · 2 x 200 g');
  });

  it('o tamanho sem contagem própria continua multiplicando: "CERV LT 350ML C/12" e "CERV LT 350ML FD 12" são 4,2 L', () => {
    expect(read('CERV LT 350ML C/12')).toBe('l 4.2 · 12 x 350 ml');
    expect(read('CERV LT 350ML FD 12')).toBe('l 4.2 · 12 x 350 ml');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "PAO CX 10X50G" é 0,5 kg', () => {
    expect(read('PAO CX 10X50G')).toBe('kg 0.5 · 10 x 50 g');
  });

  it('o tamanho com a própria contagem não multiplica de novo: "QJ CX 2X200G" é 0,4 kg', () => {
    expect(read('QJ CX 2X200G')).toBe('kg 0.4 · 2 x 200 g');
  });

  it('pacote só com a contagem: tantos itens', () => {
    expect(read('OVOS BRANCOS C/12')).toBe('un 12 · 12 un');
    expect(read('OVO VERMELHO GRANJA 30UN')).toBe('un 30 · 30 un');
    expect(read('IOGURTE BATAVO 6 UN')).toBe('un 6 · 6 un');
    expect(read('OVOS DZ')).toBe('un 12 · 12 un');
    expect(read('OVOS 2 DUZIAS')).toBe('un 24 · 24 un');
    expect(read('PAPEL HIG NEVE 30M C/4')).toBe('un 4 · 4 un');
    expect(read('PAPEL TOALHA SNOB FD 2')).toBe('un 2 · 2 un');
    expect(read('VIT C 500MG C/60')).toBe('un 60 · 60 un');
  });

  it('número que não é tamanho não vira tamanho', () => {
    expect(read('LEITE UHT 3 MARIAS 1L')).toBe('l 1 · 1 L');
    expect(read('CAFE 3 CORACOES 500G')).toBe('kg 0.5 · 500 g');
    expect(packageSize('LEITE UHT 3 MARIAS')).toBeNull();
    expect(packageSize('TOMATE 1A')).toBeNull();
    expect(packageSize('ARROZ TIPO 1')).toBeNull();
    // O tipo do arroz, e o tamanho não está escrito.
    expect(packageSize('ARROZ TIPO 1 KG')).toBeNull();
    expect(read('ARROZ TIPO 1 5KG')).toBe('kg 5 · 5 kg');
    expect(read('ARROZ TP1 1KG')).toBe('kg 1 · 1 kg');
    expect(read('DETERG LIMPOL N 500ML')).toBe('l 0.5 · 500 ml');
    expect(packageSize('BANANA PRATA KG')).toBeNull();
    expect(packageSize('LAMPADA LED 9W')).toBeNull();
    expect(packageSize('PILHA AA 1UN')).toBeNull();
    expect(packageSize('FRALDA PAMPERS G')).toBeNull();
    expect(packageSize('')).toBeNull();
  });

  it('na dúvida, não há tamanho', () => {
    // 1,5 L com a vírgula perdida, ou 5 L?
    expect(packageSize('AGUA MIN 1 5L')).toBeNull();
    // Dois produtos num item.
    expect(packageSize('SHAMPOO 350ML+COND 200ML')).toBeNull();
    // 480 g cada ou no total?
    expect(packageSize('LEITE FERM YAKULT 6UN 480G')).toBeNull();
    expect(packageSize('CERV HEINEKEN LN 330ML 6UN')).toBeNull();
    // Peso e volume juntos.
    expect(packageSize('DOCE LEITE 400G 1L')).toBeNull();
  });

  it('o mesmo tamanho repetido não é dúvida', () => {
    expect(read('LEITE 1L INTEGRAL 1L')).toBe('l 1 · 1 L');
  });
});

describe('dois tamanhos iguais', () => {
  it('compara a quantidade, não o jeito de escrever', () => {
    expect(samePackageSize(packageSize('ARROZ 1KG')!, packageSize('ARROZ 1000G')!)).toBe(true);
    expect(samePackageSize(packageSize('ARROZ 1KG')!, packageSize('ARROZ 5KG')!)).toBe(false);
    expect(samePackageSize(packageSize('AGUA 1L')!, packageSize('ARROZ 1KG')!)).toBe(false);
  });
});

/** Sorteio com semente (mulberry32): as mesmas descrições a cada rodada. */
function seeded(seed: number) {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T,>(values: readonly T[]) => values[int(0, values.length - 1)];
  return { random, int, pick };
}

const SWEEP_TOKENS = [
  'ARROZ', '5', 'KG', 'X', '12', 'C/12', '350ML', '1,5L', 'UN', 'DZ', 'FD', 'TIPO', '.', '200G', 'CX', '30M', '10,1KG', 'LT',
  '3', 'PC', 'SIXPACK', 'KIT', '6UN', '2X', 'G', 'ML', 'L', '1', '2', '6', '500', 'CERV', 'OVOS', 'T1', 'C', '/', 'LATAO', 'PCT',
];

/** 5000 descrições sorteadas, com os pedaços colados ou separados. */
const sweep = (() => {
  const { int, pick, random } = seeded(20261121);
  return Array.from({ length: 5000 }, () => {
    let text = '';
    for (let i = int(1, 7); i > 0; i--) text += (text && random() < 0.6 ? ' ' : '') + pick(SWEEP_TOKENS);
    return text;
  });
})();

/** O que shared_prices guarda, como normalize_alias deixa a descrição (tudo o que não é letra nem número vira espaço). */
const asKey = (description: string) => description.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** As descrições da tabela da leitura estrita: o que packageSize lê e o que vai para a base comum. */
const STRICT_CORPUS: [string, string | null, string | null][] = [
  ['CERV SKOL LT 350ML C/12', '12 x 350 ml', '12 x 350 ml'],
  ['CERV SKOL LT 350ML', '350 ml', '350 ml'],
  ['CX 12X350ML', '12 x 350 ml', '12 x 350 ml'],
  ['CERV BRAHMA 350ML LT C12', '350 ml', null],
  ['REFRI COCA 2L C6', '2 L', null],
  ['AGUA MIN 500ML PC 12', '500 ml', null],
  ['IOGURTE 170G C 6', '170 g', null],
  ['CERV 473ML LATAO 12', '473 ml', null],
  ['CERV HEINEKEN LN 330ML SIXPACK', '330 ml', null],
  ['CERV SKOL FD 350ML', '350 ml', null],
  ['KIT SHAMPOO 350ML', '350 ml', null],
  ['LEITE UHT PIRACANJUBA INT CX 1L', '1 L', null],
  ['LEITE UHT ITALAC INT 1L CX12', '12 x 1 L', '12 x 1 L'],
  ['PAPEL HIG NEVE FD 12X30M', '12 un', '12 un'],
  ['CHA MATTE LEAO CX 10 SACHES', '10 un', '10 un'],
  ['ARROZ CAMIL T1 5KG', '5 kg', '5 kg'],
  ['ARROZ TIPO 1 5KG', '5 kg', '5 kg'],
  ['OVOS BRANCOS C/12', '12 un', '12 un'],
  ['OVOS BRANCOS DZ', '12 un', '12 un'],
  ['RACAO GOLDEN 10,1KG', '10,1 kg', '10,1 kg'],
  ['RACAO GOLDEN 10 1KG', '1 kg', null],
  ['CAFE 3 CORACOES 500G', '500 g', null],
  ['LEITE 3 MARIAS 1L', '1 L', null],
  ['CACHACA 51 965ML', '965 ml', null],
  ['NESCAU 2.0 400G', '400 g', '400 g'],
  ['SABAO OMO 1,6KG', '1,6 kg', '1,6 kg'],
  ['MACARRAO ADRIA 500G PCT', '500 g', '500 g'],
];

describe('quantas embalagens iguais (of) e o rótulo refeito (packageLabel)', () => {
  it('of é a contagem do "N x …", em kg e l; ausente com uma só e em un', () => {
    expect(packageSize('CERV SKOL LT 350ML C/12')?.of).toBe(12);
    expect(packageSize('CX 12X350ML')?.of).toBe(12);
    expect(packageSize('LEITE UHT ITALAC INT 1L CX12')?.of).toBe(12);
    expect(packageSize('QJ 200G X 2 C/3')).toEqual({ unit: 'kg', amount: 0.4, label: '2 x 200 g', of: 2 });
    expect(packageSize('ARROZ 5KG')).toEqual({ unit: 'kg', amount: 5, label: '5 kg' });
    expect(packageSize('OVOS C/12')).toEqual({ unit: 'un', amount: 12, label: '12 un' });
  });

  it('o rótulo refeito de unidade, quantidade e of é o que packageSize escreve, em 5000 descrições sorteadas', () => {
    let sized = 0;
    for (const description of sweep) {
      const size = packageSize(description);
      if (!size) continue;
      sized++;
      expect([description, packageLabel(size)]).toEqual([description, size.label]);
    }
    // O sorteio tem tamanhos de verdade, não só nulos.
    expect(sized).toBeGreaterThan(500);
  });

  it('todo tamanho por contagem se escreve "N un" (packSizeText conta com isso)', () => {
    for (const description of sweep) {
      const size = packageSize(description);
      if (size?.unit === 'un') expect(size.label).toMatch(/^\d+ un$/);
    }
    expect(packageLabel({ unit: 'un', amount: 30 })).toBe('30 un');
  });
});

describe('o tamanho que vai para a base comum (sharedPackageSize)', () => {
  it.each(STRICT_CORPUS)('%s: packageSize %s, sharedPackageSize %s', (description, lenient, strict) => {
    expect(packageSize(description)?.label ?? null).toBe(lenient);
    expect(sharedPackageSize(description)?.label ?? null).toBe(strict);
  });

  it('é sempre o de packageSize ou nada, em 5000 descrições sorteadas', () => {
    let strictSized = 0;
    for (const description of sweep) {
      const strict = sharedPackageSize(description);
      if (!strict) continue;
      strictSized++;
      expect([description, strict]).toEqual([description, packageSize(description)]);
    }
    expect(strictSized).toBeGreaterThan(100);
  });

  it('a chave normalizada (normalize_alias) perde o tamanho: por isso o servidor lê a descrição impressa', () => {
    expect(packageSize(asKey('CERV SKOL LT 350ML C/12'))?.label).toBe('350 ml');
    expect(packageSize(asKey('RACAO GOLDEN 10,1KG'))?.label).toBe('1 kg');
    expect(sharedPackageSize(asKey('RACAO GOLDEN 10,1KG'))).toBeNull();
    expect(packageSize(asKey('OVOS BRANCOS C/12'))).toBeNull();
  });
});

/** A mesma descrição com acentos nas vogais e cedilha no C ("DUZIA" vira "DÚZIA"): a Sefaz e a foto escrevem assim. */
const ACCENTED: Record<string, string> = { A: 'Á', E: 'Ê', I: 'Í', O: 'Õ', U: 'Ú', C: 'Ç', a: 'ã', e: 'é', i: 'í', o: 'ô', u: 'ü', c: 'ç' };
const accented = (description: string) => description.replace(/[AEIOUCaeiouc]/g, (letter) => ACCENTED[letter]);

/** Descrições com acento que têm tamanho só porque o acento sai: o espelho precisa tirar como o app. */
const ACCENT_CORPUS: [string, string | null][] = [
  ['OVOS BRANCOS 1 DÚZIA', '12 un'],
  ['OVOS 2 DÚZIAS', '24 un'],
  ['OVOS BRANCOS DÚZIA', '12 un'],
  ['SUCO UVA 1 LÍTRO', '1 L'],
  ['ÁGUA MINERAL 2 LÍTROS', '2 L'],
  ['CAFÉ PILÃO 250 GRÁMAS', '250 g'],
  ['Café Pilão 500 g', '500 g'],
  // Já decomposta (o acento como marca à parte, U+0301), como vem de alguns teclados.
  ['OVOS BRANCOS 1 DU\u0301ZIA', '12 un'],
];

describe('o espelho do servidor (supabase/functions/_shared/packageSize.ts)', () => {
  const plain = [...STRICT_CORPUS.map(([description]) => description), ...sweep, ...STRICT_CORPUS.map(([description]) => asKey(description))];
  const descriptions = [...plain, ...plain.map(accented), ...ACCENT_CORPUS.map(([description]) => description)];

  it.each(ACCENT_CORPUS)('%s: o app tira o acento e lê %s', (description, label) => {
    expect(packageSize(description)?.label ?? null).toBe(label);
    expect(server.packageSize(description)?.label ?? null).toBe(label);
  });

  it('com acento, o app lê o mesmo que sem (a comparação com o espelho abaixo não é só de nulos)', () => {
    let sized = 0;
    for (const description of plain) {
      const size = packageSize(description);
      if (size) sized++;
      expect([description, JSON.stringify(packageSize(accented(description)))]).toEqual([description, JSON.stringify(size)]);
    }
    expect(sized).toBeGreaterThan(500);
  });

  it('lê igual ao app: packageSize e sharedPackageSize, nas mesmas descrições, com e sem acento', () => {
    for (const description of descriptions) {
      expect([description, JSON.stringify(server.packageSize(description))]).toEqual([description, JSON.stringify(packageSize(description))]);
      expect([description, JSON.stringify(server.sharedPackageSize(description))]).toEqual([description, JSON.stringify(sharedPackageSize(description))]);
    }
  });

  it('o mesmo rótulo e a mesma comparação de tamanhos', () => {
    expect(server.packageLabel({ unit: 'l', amount: 4.2, of: 12 })).toBe(packageLabel({ unit: 'l', amount: 4.2, of: 12 }));
    expect(server.samePackageSize(server.packageSize('ARROZ 1KG')!, server.packageSize('ARROZ 1000G')!)).toBe(true);
  });

  describe('o texto dos dois arquivos', () => {
    const MARKER = '/** O tamanho de uma embalagem, na unidade em que os preços se comparam. */';
    const app = readFileSync(path.resolve(__dirname, '../packageSize.ts'), 'utf8');
    const mirror = readFileSync(path.resolve(__dirname, '../../../supabase/functions/_shared/packageSize.ts'), 'utf8');
    const search = readFileSync(path.resolve(__dirname, '../search.ts'), 'utf8');
    /** O começo do arquivo, até o marcador, sem os comentários: o que de código vem antes do corpo comum. */
    const head = (source: string) =>
      source
        .slice(0, source.indexOf(MARKER))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .trim();
    const normalizeSearchOf = (source: string) => source.match(/(?:export )?function normalizeSearch\([\s\S]*?\n\}/)?.[0].replace(/^export /, '');

    it('os dois têm o marcador, uma vez só, onde o corpo comum começa', () => {
      for (const source of [app, mirror]) {
        expect(source.indexOf(MARKER)).toBeGreaterThan(0);
        expect(source.indexOf(MARKER)).toBe(source.lastIndexOf(MARKER));
      }
    });

    it('é o mesmo arquivo do marcador em diante', () => {
      expect(mirror.slice(mirror.indexOf(MARKER))).toBe(app.slice(app.indexOf(MARKER)));
      expect(app.length - app.indexOf(MARKER)).toBeGreaterThan(5000);
    });

    it('antes dele, o app só importa o normalizeSearch, e o espelho só o copia, com o mesmo corpo do de search.ts', () => {
      expect(head(app)).toBe("import { normalizeSearch } from './search';");
      const original = normalizeSearchOf(search);
      expect(original).toContain(".replace(/[\\u0300-\\u036f]/g, '')");
      expect(head(mirror)).toBe(original);
    });
  });
});
