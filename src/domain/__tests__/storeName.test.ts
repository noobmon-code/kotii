import { describe, expect, it } from '@jest/globals';

import {
  backToPrintedLabel,
  canRenameStore,
  cleanStoreName,
  formatCnpj,
  hasStandardName,
  printedNameLine,
  sameCompanyStores,
  storeCompany,
  storeNameError,
  storeRenameChange,
  storeRenameHint,
  storeRevertChange,
  standardNameLabel,
} from '../storeName';

const store = (id: string, name: string, cnpj: string | null, printed_name?: string | null) => ({ id, name, cnpj, address: null, printed_name });

describe('o nome do mercado', () => {
  it('é gravado sem espaços nas pontas nem repetidos', () => {
    expect(cleanStoreName('  Pão   de\tAçúcar \n')).toBe('Pão de Açúcar');
  });

  it('precisa de 1 a 60 letras (um emoji conta como uma)', () => {
    expect(storeNameError('   ')).toBe('Escreva o nome do mercado.');
    expect(storeNameError('a'.repeat(60))).toBeNull();
    expect(storeNameError('a'.repeat(61))).toBe('Use até 60 letras.');
    expect(storeNameError(`${'a'.repeat(59)}🛒`)).toBeNull();
    // Os espaços que saem não contam.
    expect(storeNameError(`  ${'a'.repeat(60)}  `)).toBeNull();
  });

  it('dá para renomear só quando a leitura trouxe a coluna do nome impresso', () => {
    expect(canRenameStore(store('s', 'Assaí', null, null))).toBe(true);
    expect(canRenameStore(store('s', 'Assaí', null, 'SENDAS DISTRIBUIDORA S/A'))).toBe(true);
    expect(canRenameStore(store('s', 'Assaí', null))).toBe(false);
  });

  it('o mercado de nota (com CNPJ) fala do nome da nota; o sem CNPJ, que pode ter sido digitado, do nome anterior', () => {
    const fromNote = store('s', 'Assaí', '06057223000171', 'SENDAS DISTRIBUIDORA S/A');
    const typed = store('t', 'Feira do bairro', null, 'Feira do bairo');
    expect(printedNameLine(fromNote)).toBe('Na nota: SENDAS DISTRIBUIDORA S/A');
    expect(backToPrintedLabel(fromNote)).toBe('Voltar ao nome da nota');
    expect(storeRenameHint(fromNote)).toBe('Vale para toda a casa. O nome que vem na nota fica guardado.');
    expect(printedNameLine(typed)).toBe('Nome anterior: Feira do bairo');
    expect(backToPrintedLabel(typed)).toBe('Voltar ao nome anterior');
    expect(storeRenameHint(typed)).toBe('Vale para toda a casa.');
    // Sem nome trocado (ou sem a coluna), nada.
    for (const plain of [store('s', 'Assaí', '06057223000171', null), store('s', 'Assaí', '06057223000171')]) {
      expect(printedNameLine(plain)).toBeNull();
      expect(backToPrintedLabel(plain)).toBeNull();
    }
  });

  it('o "CNPJ …" guardado (a nota sem nome) não aparece, nem se oferece voltar a ele', () => {
    const placeholder = store('s', 'Assaí', '06057223000171', 'CNPJ 06057223000171');
    expect(printedNameLine(placeholder)).toBeNull();
    expect(backToPrintedLabel(placeholder)).toBeNull();
    expect(storeRevertChange(placeholder)).toBeNull();
    // O mesmo texto num mercado de outro CNPJ (ou sem CNPJ) é um nome como outro.
    const other = store('t', 'Assaí', '06057223000252', 'CNPJ 06057223000171');
    expect(printedNameLine(other)).toBe('Na nota: CNPJ 06057223000171');
  });

  it('desfazer grava o nome guardado como está, sem a limpeza nem o limite do digitado', () => {
    const long = 'X'.repeat(80);
    expect(storeRevertChange(store('s', 'Padaria', null, long))).toEqual({ name: long, ids: ['s'] });
    expect(storeRevertChange(store('s', 'Padaria', null, 'PADARIA  SAO JOSE '))).toEqual({ name: 'PADARIA  SAO JOSE ', ids: ['s'] });
    expect(storeRevertChange(store('s', 'Padaria', null, null))).toBeNull();
  });
});

describe('o nome padrão do CNPJ', () => {
  const withStandard = (name: string, standard: string | null | undefined) => ({ id: 's', name, standard_name: standard });

  it('com o nome padrão, a tela diz que é ele e não oferece voltar a ele', () => {
    expect(hasStandardName(withStandard('Pão de Açúcar', 'Pão de Açúcar'))).toBe(true);
    expect(standardNameLabel(withStandard('Pão de Açúcar', 'Pão de Açúcar'))).toBeNull();
  });

  it('com outro nome, oferece o padrão', () => {
    const store = withStandard('Pão de Açúcar Miramar', 'Pão de Açúcar');
    expect(hasStandardName(store)).toBe(false);
    expect(standardNameLabel(store)).toBe('Usar o nome padrão: Pão de Açúcar');
  });

  it('sem nome padrão, ou sem a coluna, nada', () => {
    for (const standard of [null, undefined, '']) {
      const store = withStandard('Assaí', standard);
      expect(hasStandardName(store)).toBe(false);
      expect(standardNameLabel(store)).toBeNull();
    }
  });

  it('o CNPJ com pontos, barra e traço; o que não tem 14 dígitos fica como veio', () => {
    expect(formatCnpj('47508411000156')).toBe('47.508.411/0001-56');
    expect(formatCnpj('4750841100015')).toBe('4750841100015');
  });
});

describe('as lojas da mesma empresa', () => {
  it('a empresa é a raiz do CNPJ (8 dígitos); CNPJ que não tem 14 dígitos não tem empresa', () => {
    expect(storeCompany('47508411114402')).toBe('47508411');
    expect(storeCompany(null)).toBeNull();
    expect(storeCompany('4750841111440')).toBeNull();
    expect(storeCompany('47.508.411/1144-02')).toBeNull();
  });

  it('são as outras da casa com a mesma raiz, pelo nome; sem CNPJ, nenhuma', () => {
    const stores = [
      store('a', 'Pão de Açúcar', '47508411114402'),
      store('b', 'Extra', '47508411000999'),
      store('c', 'COMPANHIA BRASILEIRA DE DISTRIBUICAO', '47508411000888'),
      store('d', 'Manaíra', '09143892000154'),
      store('e', 'Feira', null),
    ];
    expect(sameCompanyStores(stores, stores[0]).map((s) => s.id)).toEqual(['c', 'b']);
    expect(sameCompanyStores(stores, stores[3])).toEqual([]);
    expect(sameCompanyStores(stores, stores[4])).toEqual([]);
  });
});

describe('a troca a gravar', () => {
  const cbd = store('a', 'COMPANHIA BRASILEIRA DE DISTRIBUICAO', '47508411114402');

  it('o nome limpo, para o mercado e as lojas marcadas que ainda não se chamam assim', () => {
    const extra = store('b', 'Extra', '47508411000999');
    const already = store('c', 'Pão de Açúcar', '47508411000888');
    expect(storeRenameChange(cbd, ' Pão de  Açúcar ', [extra, already])).toEqual({ name: 'Pão de Açúcar', ids: ['a', 'b'] });
  });

  it('nada quando o nome não serve ou já é esse', () => {
    expect(storeRenameChange(cbd, '  ')).toBeNull();
    expect(storeRenameChange(cbd, 'COMPANHIA BRASILEIRA DE DISTRIBUICAO ')).toBeNull();
  });

  it('o mesmo nome no mercado, mas não numa loja marcada: só ela', () => {
    expect(storeRenameChange(store('a', 'Pão de Açúcar', null), 'Pão de Açúcar', [store('b', 'Extra', null)])).toEqual({
      name: 'Pão de Açúcar',
      ids: ['b'],
    });
  });
});
