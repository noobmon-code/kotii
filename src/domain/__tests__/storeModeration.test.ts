import { describe, expect, it } from '@jest/globals';

import {
  canLookupAgain,
  cnpjSearchUrl,
  companyNameOptions,
  decisionLine,
  legalNameLine,
  mapsUrl,
  nicknamesLine,
  receitaLine,
  reviewCounts,
  reviewGroup,
  reviewRows,
  reviewSubtitle,
  reviewTitle,
  suggestedName,
  type ReceitaStatus,
  type StoreNameReview,
} from '../storeModeration';

const CBD = 'COMPANHIA BRASILEIRA DE DISTRIBUICAO';

const row = (cnpj: string, patch: Partial<StoreNameReview> = {}): StoreNameReview => ({
  cnpj,
  name: null,
  source: null,
  reviewed_at: null,
  receita_status: 'sem_fantasia',
  receita_name: null,
  receita_trade_name: null,
  receita_activity: null,
  note_name: null,
  address: null,
  households: 1,
  nicknames: [],
  company_names: [],
  ...patch,
});

describe('as abas da moderação', () => {
  it('com nome padrão, ou já revisado (também sem nome), "Com nome"; esperando a Receita, "Na Receita"; o resto, revisar', () => {
    expect(reviewGroup(row('1', { name: 'Assaí', source: 'receita', receita_status: 'ok' }))).toBe('decididos');
    expect(reviewGroup(row('1', { source: 'revisao', reviewed_at: '2026-10-23T10:00:00Z' }))).toBe('decididos');
    // Consultando de novo um CNPJ que já tem nome: continua com nome.
    expect(reviewGroup(row('1', { name: 'Assaí', source: 'revisao', receita_status: 'pendente' }))).toBe('decididos');
    expect(reviewGroup(row('1', { receita_status: 'pendente' }))).toBe('consultando');
    for (const status of ['sem_fantasia', 'pessoa', 'sem_dados', 'nao_achou', 'erro'] as ReceitaStatus[]) {
      expect(reviewGroup(row('1', { receita_status: status }))).toBe('revisar');
    }
  });

  it('cada aba, primeiro o que está em mais casas, depois pelo nome; e quantos há em cada uma', () => {
    const rows = [
      row('3', { note_name: 'MERCADINHO BOA VISTA' }),
      row('1', { note_name: CBD, households: 3 }),
      row('2', { note_name: 'ATACADAO S.A.' }),
      row('4', { name: 'Assaí', source: 'receita', receita_status: 'ok' }),
      row('5', { receita_status: 'pendente' }),
    ];
    expect(reviewRows(rows, 'revisar').map((r) => r.cnpj)).toEqual(['1', '2', '3']);
    expect(reviewCounts(rows)).toEqual({ revisar: 3, consultando: 1, decididos: 1 });
  });
});

describe('o cartão de um CNPJ', () => {
  it('o título: o nome padrão, o da nota ou o CNPJ; embaixo, o CNPJ e em quantas casas', () => {
    expect(reviewTitle(row('47508411000156', { name: 'Pão de Açúcar', note_name: CBD }))).toBe('Pão de Açúcar');
    expect(reviewTitle(row('47508411000156', { note_name: CBD }))).toBe(CBD);
    expect(reviewTitle(row('47508411000156'))).toBe('CNPJ 47.508.411/0001-56');
    expect(reviewSubtitle(row('47508411000156'))).toBe('CNPJ 47.508.411/0001-56 · em 1 casa');
    expect(reviewSubtitle(row('47508411000156', { households: 3 }))).toBe('CNPJ 47.508.411/0001-56 · em 3 casas');
  });

  it('o que a Receita disse, em palavras', () => {
    const line = (receita_status: ReceitaStatus, receita_trade_name: string | null = null) => receitaLine({ receita_status, receita_trade_name });
    expect(line('pendente')).toBe('Consultando a Receita…');
    expect(line('ok', 'ASSAI ATACADISTA')).toBe('Nome fantasia na Receita: ASSAI ATACADISTA');
    expect(line('sem_fantasia')).toBe('Sem nome fantasia na Receita.');
    expect(line('sem_fantasia', CBD)).toBe(`Nome fantasia na Receita: ${CBD} (igual à razão social ou longo demais)`);
    expect(line('pessoa')).toBe('Cadastro de pessoa (MEI ou individual): nada da Receita é guardado.');
    expect(line('sem_dados')).toBe('A Receita não disse se é empresa ou pessoa.');
    expect(line('nao_achou')).toBe('CNPJ não encontrado na Receita.');
    expect(line('erro')).toBe('A Receita não respondeu depois de 5 tentativas.');
  });

  it('a razão social só quando não é o nome da nota', () => {
    expect(legalNameLine({ receita_name: CBD, note_name: CBD })).toBeNull();
    expect(legalNameLine({ receita_name: CBD, note_name: 'CIA BRASILEIRA DE DISTRIB' })).toBe(`Razão social: ${CBD}`);
    expect(legalNameLine({ receita_name: null, note_name: CBD })).toBeNull();
  });

  it('os apelidos das casas, com quantas deram cada um quando é mais de uma', () => {
    expect(nicknamesLine({ nicknames: [] })).toBeNull();
    expect(
      nicknamesLine({
        nicknames: [
          { name: 'Pão de Açúcar', households: 2 },
          { name: 'Pão de Açúcar Miramar', households: 1 },
        ],
      }),
    ).toBe('Apelidos nas casas: Pão de Açúcar (2 casas), Pão de Açúcar Miramar');
  });

  it('a decisão de agora', () => {
    expect(decisionLine({ name: 'Assaí', source: 'receita', reviewed_at: null })).toBe('Nome padrão: Assaí (da Receita)');
    expect(decisionLine({ name: 'Assaí', source: 'revisao', reviewed_at: '2026-10-23T10:00:00Z' })).toBe('Nome padrão: Assaí (revisado)');
    expect(decisionLine({ name: null, source: 'revisao', reviewed_at: '2026-10-23T10:00:00Z' })).toBe('Revisado: fica o nome da nota.');
    expect(decisionLine({ name: null, source: null, reviewed_at: null })).toBeNull();
  });

  it('o campo já vem com o nome de agora, o apelido mais comum ou o nome fantasia que cabe', () => {
    const nick = [{ name: 'Pão de Açúcar', households: 2 }];
    expect(suggestedName(row('1', { name: 'Assaí', nicknames: nick }))).toBe('Assaí');
    expect(suggestedName(row('1', { nicknames: nick, receita_trade_name: 'PAO DE ACUCAR' }))).toBe('Pão de Açúcar');
    expect(suggestedName(row('1', { receita_trade_name: 'PAO DE ACUCAR' }))).toBe('PAO DE ACUCAR');
    expect(suggestedName(row('1', { receita_trade_name: 'M'.repeat(61) }))).toBe('');
    expect(suggestedName(row('1'))).toBe('');
  });

  it('consultar de novo só quando a Receita não deu o nome e não está consultando', () => {
    expect(canLookupAgain({ receita_status: 'ok' })).toBe(false);
    expect(canLookupAgain({ receita_status: 'pendente' })).toBe(false);
    for (const status of ['sem_fantasia', 'pessoa', 'sem_dados', 'nao_achou', 'erro'] as ReceitaStatus[]) {
      expect(canLookupAgain({ receita_status: status })).toBe(true);
    }
  });

  it('os nomes padrão das outras lojas da empresa, com quantas lojas quando é mais de uma', () => {
    expect(companyNameOptions(row('1'))).toEqual([]);
    expect(
      companyNameOptions(
        row('1', {
          company_names: [
            { name: 'Pão de Açúcar', stores: 3 },
            { name: 'Extra', stores: 1 },
          ],
        }),
      ),
    ).toEqual([
      { name: 'Pão de Açúcar', label: 'Pão de Açúcar (3 lojas)' },
      { name: 'Extra', label: 'Extra' },
    ]);
  });

  it('o mapa só com o endereço (o nome da nota de um MEI é o da pessoa); a busca do CNPJ formatado', () => {
    expect(mapsUrl({ address: null })).toBeNull();
    expect(mapsUrl({ address: 'Av. Epitácio Pessoa, 4200' })).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Av. Epitácio Pessoa, 4200')}`,
    );
    expect(cnpjSearchUrl({ cnpj: '47508411000156' })).toBe(`https://www.google.com/search?q=${encodeURIComponent('CNPJ 47.508.411/0001-56')}`);
  });
});
