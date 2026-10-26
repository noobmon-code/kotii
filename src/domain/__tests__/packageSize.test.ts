import { describe, expect, it } from '@jest/globals';

import { packageSize, samePackageSize } from '../packageSize';

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
