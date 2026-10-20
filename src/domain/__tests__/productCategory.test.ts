import { describe, expect, it } from '@jest/globals';

import { categoryMergeWarning, PRODUCT_CATEGORY_NOTE } from '../productCategory';

describe('a categoria do produto vale também para o passado', () => {
  it('o seletor de categoria diz isso antes da escolha', () => {
    expect(PRODUCT_CATEGORY_NOTE).toBe(
      'A categoria vale para todas as compras deste produto, também as dos meses passados: o Mercado do mês e os gastos em Finanças mudam junto.',
    );
  });

  it('ao juntar dois produtos de categorias diferentes, diz qual fica (a do nome que fica) e que o passado muda junto', () => {
    expect(categoryMergeWarning({ name: 'Arroz Tio João 5 kg', category: 'graos' }, { name: 'ARROZ 5KG', category: 'outros' })).toBe(
      'Os dois estão em categorias diferentes: "Arroz Tio João 5 kg" em Grãos, massas e cereais, "ARROZ 5KG" em Outros. ' +
        'Fica Grãos, massas e cereais: as compras de "ARROZ 5KG", também as dos meses passados, passam para essa categoria no Mercado do mês e em Finanças.',
    );
    // Trocar qual fica troca o aviso.
    expect(categoryMergeWarning({ name: 'ARROZ 5KG', category: 'outros' }, { name: 'Arroz Tio João 5 kg', category: 'graos' })).toContain('Fica Outros:');
  });

  it('a mesma categoria não avisa; categoria que não existe conta como "Outros", como em toda a tela', () => {
    expect(categoryMergeWarning({ name: 'A', category: 'graos' }, { name: 'B', category: 'graos' })).toBeNull();
    expect(categoryMergeWarning({ name: 'A', category: 'qualquer' }, { name: 'B', category: 'outros' })).toBeNull();
  });
});
