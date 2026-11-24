import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { Unit } from '@/lib/types';
import { CATEGORIES } from '../categories';
import { APP_MAX_DATE, APP_MIN_DATE } from '../dates';
import { matchItemArt } from '../itemArt';
import { termRegex, termText } from '../itemTerms';
import {
  describeLongCycle,
  LONG_CYCLE_ACTIONS,
  LONG_CYCLE_BADGES,
  LONG_CYCLE_ERROR_TITLE,
  LONG_CYCLE_FOOTNOTE,
  LONG_CYCLE_GIVE_UP_FACTOR,
  LONG_CYCLE_HISTORY_FAILED,
  LONG_CYCLE_HISTORY_MONTHS,
  LONG_CYCLE_INTRO,
  LONG_CYCLE_ITEMS,
  LONG_CYCLE_KEY_PATTERN,
  LONG_CYCLE_MAX_MONTHS,
  LONG_CYCLE_MIN_MONTHS,
  LONG_CYCLE_NOT_READY,
  LONG_CYCLE_OFFLINE,
  LONG_CYCLE_PERIOD_CHOICES,
  LONG_CYCLE_PERIOD_QUESTION,
  LONG_CYCLE_ROW_SUBTITLE,
  LONG_CYCLE_SHEET,
  LONG_CYCLE_TITLE,
  LONG_CYCLE_UNDO,
  longCycleAddLabel,
  longCycleChoreKey,
  longCycleDayError,
  longCycleDefaultChipLabel,
  longCycleDefaultLine,
  longCycleEvery,
  longCycleFirstWords,
  longCycleItem,
  longCycleKeyOf,
  longCycleListName,
  longCycleMonthsText,
  longCycleNotice,
  longCycleOffNotice,
  longCycleOnList,
  longCycleOptionsLabel,
  longCyclePeriodChoices,
  longCyclePeriodNotice,
  longCycleReplacedNotice,
  longCycleRowSubtitle,
  longCycleRowText,
  longCycleSaveMonths,
  longCycleScreenOrder,
  longCycleSeeMore,
  longCycleSeeMoreLabel,
  longCycleSkipKeys,
  longCycleStates,
  longCycleSuggestion,
  longCycleSuggestions,
  longCycleUndo,
  longCycleUndoLabel,
  longCycleWhen,
  wordForms,
  type LongCycleSetting,
  type LongCycleState,
} from '../longCycle';
import { listExclusion, type PurchaseRecord } from '../recentPurchases';
import { itemIdentity } from '../sameItem';
import { SUGGESTION_TITLES } from '../today';

const TODAY = '2026-11-22';

function record(name: string, at: string, extra: Partial<PurchaseRecord> = {}): PurchaseRecord {
  return {
    name,
    category: 'higiene',
    productId: null,
    quantity: 1,
    unit: 'un' as Unit,
    at: at.length === 10 ? `${at}T12:00:00` : at,
    source: 'list',
    ...extra,
  };
}

const setting = (item_key: string, extra: Partial<LongCycleSetting> = {}): LongCycleSetting => ({
  item_key,
  every_months: null,
  off: false,
  replaced_on: null,
  ...extra,
});

function stateOf(key: string, records: PurchaseRecord[], settings: LongCycleSetting[] | null = [], today = TODAY): LongCycleState {
  return longCycleStates({ records, settings, today }).find((s) => s.item.key === key)!;
}

const NO_LISTS = listExclusion([]);

describe('a tabela', () => {
  it('chaves únicas, no formato do banco, prazos entre as escolhas e categorias que existem', () => {
    const keys = LONG_CYCLE_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    const categories = new Set(CATEGORIES.map((c) => c.key));
    for (const item of LONG_CYCLE_ITEMS) {
      expect(item.key).toMatch(LONG_CYCLE_KEY_PATTERN);
      expect(LONG_CYCLE_PERIOD_CHOICES).toContain(item.months);
      expect(categories.has(item.category)).toBe(true);
      for (const category of item.categories) expect(categories.has(category)).toBe(true);
      expect(longCycleItem(item.key)).toBe(item);
    }
  });

  it('o nome de cada item é reconhecido como ele mesmo', () => {
    for (const item of LONG_CYCLE_ITEMS) expect(longCycleKeyOf(item.name, item.category)).toBe(item.key);
  });

  it('a única chave que o vocabulário de sameItem também conhece concorda', () => {
    expect(itemIdentity('Escova de dente', 'higiene')?.key).toBe('escova_dente');
  });

  it('noArt é exatamente o item cujo nome daria o desenho de outro item', () => {
    for (const item of LONG_CYCLE_ITEMS) {
      const art = matchItemArt(item.name, item.category);
      expect([item.key, Boolean(item.noArt)]).toEqual([item.key, art !== null && art !== item.key]);
    }
    expect(LONG_CYCLE_ITEMS.filter((i) => i.noArt).map((i) => i.key)).toEqual(['esponja_banho', 'esponja_maquiagem']);
  });

  it('os prazos do app', () => {
    expect(Object.fromEntries(LONG_CYCLE_ITEMS.map((i) => [i.key, i.months]))).toEqual({
      chupeta: 2,
      escova_dente: 3,
      bico_mamadeira: 3,
      esponja_banho: 3,
      esponja_maquiagem: 3,
      coador_pano: 3,
      refil_filtro_agua: 6,
      refil_mop: 6,
      escova_sanitaria: 12,
      vassoura: 12,
      travesseiro: 24,
    });
  });
});

// O nome, a categoria e o item que ele é (null: não é nenhum).
const RECOGNITION: [string, string | null, string | null][] = [
  ['ESC DENT COLGATE CLAS', null, 'escova_dente'],
  ['ESC DENTAL ORAL B', null, 'escova_dente'],
  ['Escova dentes', null, 'escova_dente'],
  ['Escovas de dentes infantil', 'higiene', 'escova_dente'],
  ['Escova Dental Colgate Kids', 'higiene', 'escova_dente'],
  ['Kit escova de dente', null, null],
  ['Pasta de dente e escova', null, null],
  ['Escova Dental Elétrica Oral-B', null, null],
  ['Escova de dente para cachorro', null, null],
  ['Escova de dente', 'pet', null],
  ['Escova de dente', 'hortifruti', null],
  ['Escova de dente', 'outros', 'escova_dente'],
  ['Capa de travesseiro', null, null],
  ['Travesseiro de pescoço', null, null],
  ['Travesseiros', null, 'travesseiro'],
  ['Travesseiro Nasa', 'outros', 'travesseiro'],
  ['Travesseiro infantil', 'bebe', 'travesseiro'],
  ['Prendedor de chupeta', null, null],
  ['Chupetas NUK', 'bebe', 'chupeta'],
  ['Chupeta NUK Fase 2', 'bebe', 'chupeta'],
  ['Bico mamadeira fluxo', 'bebe', 'bico_mamadeira'],
  ['ESPO BANHO', null, 'esponja_banho'],
  ['ESPONJ BANHO', null, 'esponja_banho'],
  ['Esponja de banho infantil', 'higiene', 'esponja_banho'],
  ['Esponja de maquiagem', 'higiene', 'esponja_maquiagem'],
  ['Bucha vegetal banho', null, null],
  ['Esponja', null, null],
  ['Vassourinha', null, null],
  ['Vassoura elétrica', null, null],
  ['Vassoura Mágica', null, null],
  ['Vassoura de piaçava', 'limpeza', 'vassoura'],
  ['Refil filtro Europa', null, 'refil_filtro_agua'],
  ['REFIL DO FILTRO', null, 'refil_filtro_agua'],
  ['Vela filtro São João', null, 'refil_filtro_agua'],
  ['Vela filtro de barro', null, 'refil_filtro_agua'],
  ['Elemento filtrante Fortlev', null, 'refil_filtro_agua'],
  ['Refil do filtro de água', 'bebidas', 'refil_filtro_agua'],
  ['Refil filtro de café', null, null],
  ['Refil filtro ar condicionado', null, null],
  ['Escova sanitária refil', null, null],
  ['Escova sanitária', 'limpeza', 'escova_sanitaria'],
  ['Filtro de pano', 'cafe_cha', 'coador_pano'],
  ['Coador de café de pano', null, 'coador_pano'],
  ['Refil Mop Giratório', 'limpeza', 'refil_mop'],
];

describe('reconhecer o item', () => {
  it.each(RECOGNITION)('%s (%s) é %s', (name, category, key) => {
    expect(longCycleKeyOf(name, category)).toBe(key);
  });

  it('sem nome, nada', () => {
    expect(longCycleKeyOf('', null)).toBeNull();
    expect(longCycleKeyOf('   ', null)).toBeNull();
  });
});

describe('as primeiras palavras da leitura longa', () => {
  const words = longCycleFirstWords();

  it('as formas de cada palavra, como o motor de termos aceita', () => {
    expect(wordForms('escova')).toEqual(['escova', 'escovas']);
    expect(wordForms('coador')).toEqual(['coador', 'coadores', 'coadors']);
    expect(wordForms('sabao')).toEqual(['sabao', 'saboes', 'sabaes', 'sabaos']);
    expect(wordForms('lapis')).toEqual(['lapis', 'lapises']);
    // O motor de termos lê o plural de "papel" como "papeis", e o de "refil" do mesmo jeito.
    expect(wordForms('refil')).toEqual(['refil', 'refiis']);
    expect(wordForms('papel')).toEqual(['papel', 'papeis']);
    expect(wordForms('atum')).toEqual(['atum', 'atuns']);
    for (const item of LONG_CYCLE_ITEMS) {
      for (const term of item.terms) {
        const first = term.split(' ')[0];
        for (const form of wordForms(first)) {
          // As expressões são /g: uma nova a cada conferência.
          expect(new RegExp(termRegex(first).source).test(form)).toBe(true);
          expect(words).toContain(form);
        }
      }
    }
  });

  it('com as abreviações de nota que viram uma delas, sem repetir e em ordem', () => {
    expect(words).toEqual(expect.arrayContaining(['esc', 'espo', 'esponj', 'escova', 'escovas', 'refil', 'travesseiros']));
    expect(words).toEqual([...new Set(words)].sort());
  });

  it('todo nome que o app reconhece começa por uma palavra pedida ao servidor', () => {
    const recognised = [
      ...RECOGNITION.filter(([, , key]) => key).map(([name]) => name),
      ...LONG_CYCLE_ITEMS.flatMap((i) => [i.name, ...i.terms]),
    ];
    for (const name of recognised) expect(words).toContain(termText(name).split(' ')[0]);
  });
});

describe('o estado de cada item', () => {
  it('um estado por item, na ordem da tabela', () => {
    expect(longCycleStates({ records: [], settings: null, today: TODAY }).map((s) => s.item.key)).toEqual(LONG_CYCLE_ITEMS.map((i) => i.key));
  });

  it('nunca comprado: sem compra', () => {
    const state = stateOf('escova_dente', []);
    expect(state).toMatchObject({ status: 'sem_compra', last: null, dueOn: null, months: 3, custom: false, off: false });
  });

  it('na hora exatamente no addMonths (31/01 + 1 mês = 28/02), em dia na véspera', () => {
    const records = [record('Chupeta', '2026-01-31', { category: 'bebe' })];
    expect(stateOf('chupeta', records, [setting('chupeta', { every_months: 1 })], '2026-02-28')).toMatchObject({
      status: 'trocar',
      dueOn: '2026-02-28',
    });
    expect(stateOf('chupeta', records, [setting('chupeta', { every_months: 1 })], '2026-02-27').status).toBe('em_dia');
  });

  it('com duas vezes o prazo, parou', () => {
    const records = [record('Escova de dente', '2026-05-22')];
    expect(stateOf('escova_dente', records, [], '2026-11-21').status).toBe('trocar');
    expect(stateOf('escova_dente', records, [], '2026-11-22').status).toBe('parou');
    expect(LONG_CYCLE_GIVE_UP_FACTOR).toBe(2);
  });

  it('o "Já troquei" mais novo vence a compra mais velha, e o contrário', () => {
    const records = [record('Escova de dente', '2026-06-01')];
    expect(stateOf('escova_dente', records, [setting('escova_dente', { replaced_on: '2026-08-01' })]).last).toEqual({
      day: '2026-08-01',
      via: 'troca',
    });
    expect(stateOf('escova_dente', records, [setting('escova_dente', { replaced_on: '2026-05-01' })]).last).toEqual({
      day: '2026-06-01',
      via: 'compra',
    });
    // No empate, a compra.
    expect(stateOf('escova_dente', records, [setting('escova_dente', { replaced_on: '2026-06-01' })]).last?.via).toBe('compra');
  });

  it('o "Já troquei" de um relógio adiantado conta como hoje', () => {
    expect(stateOf('vassoura', [], [setting('vassoura', { replaced_on: '2027-01-10' })]).last).toEqual({ day: TODAY, via: 'troca' });
  });

  it('compra com data inválida ou de depois de hoje não conta', () => {
    const records = [
      record('Escova de dente', 'nada'),
      record('Escova de dente', '2026-11-25'),
      record('Escova de dente', '2026-01-10'),
    ];
    expect(stateOf('escova_dente', records).last).toEqual({ day: '2026-01-10', via: 'compra' });
  });

  it('"não sugerir" vence', () => {
    expect(stateOf('escova_dente', [record('Escova de dente', '2026-07-01')], [setting('escova_dente', { off: true })]).status).toBe('off');
  });

  it('o prazo da casa', () => {
    const state = stateOf('escova_dente', [record('Escova de dente', '2026-09-01')], [setting('escova_dente', { every_months: 2 })]);
    expect(state).toMatchObject({ months: 2, custom: true, dueOn: '2026-11-01', status: 'trocar' });
    // O mesmo prazo do app guardado não é "da casa".
    expect(stateOf('escova_dente', [], [setting('escova_dente', { every_months: 3 })]).custom).toBe(false);
  });

  it('um prazo fora de 1..24, ou quebrado, volta ao do app', () => {
    for (const every_months of [0, 25, 2.5, -1]) {
      expect(stateOf('escova_dente', [], [setting('escova_dente', { every_months })])).toMatchObject({ months: 3, custom: false });
    }
  });

  it('uma chave desconhecida não conta, e null é o mesmo que nenhuma linha', () => {
    const records = [record('Escova de dente', '2026-07-01')];
    expect(stateOf('escova_dente', records, [setting('escova_eletrica', { off: true })])).toEqual(stateOf('escova_dente', records, null));
  });

  it('a compra, a de lista e o produto vêm das mais novas', () => {
    const records = [
      record('Escova Oral-B', '2026-03-01', { source: 'receipt', productId: 'p-velho' }),
      record('ESC DENT COLGATE', '2026-05-01', { source: 'receipt', productId: 'p-novo', quantity: 2 }),
      record('Escova de dente', '2026-04-01', { source: 'list', quantity: 3 }),
      record('Escova de dente', '2026-06-01', { source: 'list', category: 'pet' }),
      record('Escova de dente infantil', '2026-07-01', { source: 'receipt' }),
    ];
    const state = stateOf('escova_dente', records);
    expect(state.record?.name).toBe('Escova de dente infantil');
    expect(state.listRecord?.quantity).toBe(3);
    expect(state.productId).toBe('p-novo');
  });
});

describe('o que a casa já acompanha', () => {
  const none = { restock: [], supplies: [], chores: [], equipment: [] };

  it('em "Acho que acabou", pelo nome e por cada nome da compra', () => {
    expect(
      [...longCycleSkipKeys({ ...none, restock: [{ name: 'Escova de dente', category: 'higiene', boughtAs: [] }] })],
    ).toEqual(['escova_dente']);
    expect(
      [
        ...longCycleSkipKeys({
          ...none,
          restock: [{ name: 'Item', category: 'outros', boughtAs: [{ name: 'Travesseiro Nasa', productId: null }] }],
        }),
      ],
    ).toEqual(['travesseiro']);
  });

  it('em "Gás, água e ração"', () => {
    expect([...longCycleSkipKeys({ ...none, supplies: [{ name: 'Filtro da cozinha', kind: 'filtro' }] })]).toEqual(['refil_filtro_agua']);
    expect([...longCycleSkipKeys({ ...none, supplies: [{ name: 'Escova de dente', kind: 'outros' }] })]).toEqual(['escova_dente']);
  });

  it('numa tarefa que se repete', () => {
    const chore = (title: string, recurrence: 'none' | 'weekly' | 'monthly', equipment_id: string | null = null) => ({
      title,
      recurrence,
      equipment_id,
    });
    expect([...longCycleSkipKeys({ ...none, chores: [chore('Trocar refil do filtro', 'monthly')] })]).toEqual(['refil_filtro_agua']);
    expect([...longCycleSkipKeys({ ...none, chores: [chore('Trocar refil do filtro', 'weekly')] })]).toEqual(['refil_filtro_agua']);
    expect([...longCycleSkipKeys({ ...none, chores: [chore('Trocar refil do filtro', 'none')] })]).toEqual([]);
    expect([...longCycleSkipKeys({ ...none, chores: [chore('Trocar escova de dente', 'monthly')] })]).toEqual(['escova_dente']);
    for (const title of ['Limpar filtros', 'Trocar óleo', 'Trocar filtro do ar']) {
      expect([...longCycleSkipKeys({ ...none, chores: [chore(title, 'monthly')] })]).toEqual([]);
    }
    const equipment = [
      { id: 'pur', name: 'Purificador Europa', category: 'cozinha' },
      { id: 'gel', name: 'Geladeira', category: 'cozinha' },
    ];
    expect([...longCycleSkipKeys({ ...none, equipment, chores: [chore('Limpar a vela', 'monthly', 'pur')] })]).toEqual(['refil_filtro_agua']);
    expect([...longCycleSkipKeys({ ...none, equipment, chores: [chore('Limpar a vela', 'monthly', 'gel')] })]).toEqual([]);
  });

  it('o verbo de troca no título', () => {
    expect(longCycleChoreKey('Substituir a vassoura')).toBe('vassoura');
    expect(longCycleChoreKey('Comprar os travesseiros')).toBe('travesseiro');
    expect(longCycleChoreKey('Repor refil do mop')).toBe('refil_mop');
    expect(longCycleChoreKey('Escova de dente')).toBeNull();
  });
});

describe('as sugestões do Hoje', () => {
  const due = (key: string, day: string) => stateOf(key, [record(longCycleItem(key)!.name, day, { category: longCycleItem(key)!.category })]);

  it('só o que está na hora, o que venceu antes primeiro, depois o nome, até 3, e o total', () => {
    const states = [
      due('escova_dente', '2026-08-01'),
      due('vassoura', '2025-09-01'),
      due('travesseiro', '2024-08-01'),
      due('refil_mop', '2026-04-01'),
      due('chupeta', '2026-11-01'),
    ];
    const { shown, total } = longCycleSuggestions(states, { lists: [], exclude: NO_LISTS, skip: new Set() });
    expect(shown.map((s) => s.key)).toEqual(['travesseiro', 'vassoura', 'refil_mop']);
    expect(total).toBe(4);
  });

  it('no empate do vencimento, pelo nome', () => {
    const states = [due('esponja_maquiagem', '2026-07-01'), due('esponja_banho', '2026-07-01'), due('coador_pano', '2026-07-01')];
    expect(longCycleSuggestions(states, { lists: [], exclude: NO_LISTS, skip: new Set() }).shown.map((s) => s.name)).toEqual([
      'Coador de pano',
      'Esponja de banho',
      'Esponja de maquiagem',
    ]);
  });

  it('o que já está numa lista: pelo nome, pelo produto, pelo item sem a marca e pela chave do item', () => {
    const state = stateOf('escova_dente', [record('Escova Dental Colgate', '2026-07-01', { productId: 'p1', source: 'receipt' })]);
    const on = (lists: { name: string; category?: string | null; product_id: string | null }[], justListed: string[] = []) =>
      longCycleSuggestions([state], { lists, exclude: listExclusion(lists, justListed), skip: new Set() }).total === 0;
    expect(on([])).toBe(false);
    expect(on([{ name: 'escova de dente', product_id: null }])).toBe(true);
    expect(on([{ name: 'Outra coisa', product_id: 'p1' }])).toBe(true);
    expect(on([{ name: 'Escova dental Colgate', category: 'higiene', product_id: null }])).toBe(true);
    expect(on([{ name: 'Escova Dental Oral-B', category: 'higiene', product_id: null }])).toBe(true);
    // Acabou de ir para a lista (useJustListed).
    expect(on([], ['escova de dente'])).toBe(true);
    const pillow = stateOf('travesseiro', [record('Travesseiro', '2024-06-01', { category: 'outros' })]);
    expect(longCycleOnList(pillow, { lists: [{ name: 'Travesseiro Nasa', product_id: null }], exclude: NO_LISTS })).toBe(true);
    expect(longCycleOnList(pillow, { lists: [{ name: 'Capa de travesseiro', product_id: null }], exclude: NO_LISTS })).toBe(false);
  });

  it('o que a casa acompanha de outro jeito fica de fora', () => {
    const states = [due('escova_dente', '2026-07-01'), due('vassoura', '2025-10-01')];
    expect(longCycleSuggestions(states, { lists: [], exclude: NO_LISTS, skip: new Set(['vassoura']) }).shown.map((s) => s.key)).toEqual([
      'escova_dente',
    ]);
  });
});

describe('o item da lista', () => {
  it('a quantidade e o produto pela regra de groupPurchases, ou 1 un só com o "Já troquei"', () => {
    const fromList = longCycleSuggestion(
      stateOf('escova_dente', [
        record('Escova de dente', '2026-05-01', { source: 'list', quantity: 4 }),
        record('ESC DENT COLGATE CLAS', '2026-07-01', { source: 'receipt', quantity: 2.4, productId: 'p1' }),
      ]),
    );
    expect(fromList).toMatchObject({ key: 'escova_dente', name: 'Escova de dente', quantity: 4, unit: 'un', productId: 'p1' });
    const fromReceipt = longCycleSuggestion(
      stateOf('escova_dente', [record('ESC DENT COLGATE CLAS', '2026-07-01', { source: 'receipt', quantity: 2.4 })]),
    );
    expect(fromReceipt).toMatchObject({ name: 'Escova de dente', quantity: 2, unit: 'un' });
    const onlyReplaced = longCycleSuggestion(stateOf('vassoura', [], [setting('vassoura', { replaced_on: '2025-01-01' })]));
    expect(onlyReplaced).toMatchObject({ name: 'Vassoura', category: 'limpeza', quantity: 1, unit: 'un', productId: null });
  });

  it('a categoria da última compra, senão a da tabela', () => {
    expect(longCycleSuggestion(stateOf('refil_filtro_agua', [record('Refil filtro Europa', '2026-01-01', { category: 'limpeza' })])).category).toBe(
      'limpeza',
    );
    expect(longCycleSuggestion(stateOf('refil_filtro_agua', [])).category).toBe('outros');
  });

  it('o nome da tabela, a lista sem a marca', () => {
    const item = longCycleItem('escova_dente')!;
    expect(longCycleListName(item, null)).toBe('Escova de dente');
    expect(longCycleListName(item, record('ESC DENT COLGATE CLAS', '2026-07-01'))).toBe('Escova de dente');
    expect(longCycleListName(longCycleItem('travesseiro')!, record('Travesseiro Nasa', '2026-07-01', { category: 'outros' }))).toBe('Travesseiro');
  });

  it('a palavra que decide o que se pode comprar guarda o nome da compra', () => {
    const item = longCycleItem('escova_dente')!;
    expect(longCycleListName(item, record('Escovas de dentes infantil', '2026-07-01'))).toBe('Escovas de dentes infantil');
    expect(longCycleListName(item, record('Escova Dental Colgate Kids', '2026-07-01'))).toBe('Escova Dental Colgate Kids');
    expect(longCycleListName(longCycleItem('travesseiro')!, record('Travesseiro infantil', '2026-07-01', { category: 'outros' }))).toBe(
      'Travesseiro infantil',
    );
  });

  it('a chupeta e o bico guardam o nome da compra', () => {
    expect(longCycleListName(longCycleItem('chupeta')!, record('Chupeta NUK Fase 2', '2026-07-01', { category: 'bebe' }))).toBe(
      'Chupeta NUK Fase 2',
    );
    expect(
      longCycleSuggestion(stateOf('bico_mamadeira', [record('Bico mamadeira fluxo médio', '2026-07-01', { category: 'bebe' })])).name,
    ).toBe('Bico mamadeira fluxo médio');
  });
});

describe('a tela dos prazos', () => {
  it('o que está na hora primeiro, depois a ordem da tabela', () => {
    const states = longCycleStates({
      records: [
        record('Vassoura', '2025-09-01', { category: 'limpeza' }),
        record('Escova de dente', '2026-08-01'),
        record('Chupeta', '2026-11-01', { category: 'bebe' }),
      ],
      settings: [],
      today: TODAY,
    });
    expect(longCycleScreenOrder(states).map((s) => s.item.key)).toEqual([
      'vassoura',
      'escova_dente',
      'chupeta',
      'bico_mamadeira',
      'esponja_banho',
      'esponja_maquiagem',
      'coador_pano',
      'refil_filtro_agua',
      'refil_mop',
      'escova_sanitaria',
      'travesseiro',
    ]);
  });

  it('o que "Salvar" grava', () => {
    const item = longCycleItem('escova_dente')!;
    expect(longCycleSaveMonths(item, 3)).toBeNull();
    expect(longCycleSaveMonths(item, 6)).toBe(6);
    expect(() => longCycleSaveMonths(item, 0)).toThrow();
    expect(() => longCycleSaveMonths(item, 25)).toThrow();
  });

  it('o que "Desfazer" grava', () => {
    expect(longCycleUndo('replaced', undefined)).toEqual({ replaced_on: null });
    expect(longCycleUndo('replaced', setting('x', { replaced_on: '2026-01-01' }))).toEqual({ replaced_on: '2026-01-01' });
    expect(longCycleUndo('off', setting('x', { off: true }))).toEqual({ off: false });
    expect(longCycleUndo('period', undefined)).toEqual({ every_months: null });
    expect(longCycleUndo('period', setting('x', { every_months: 6 }))).toEqual({ every_months: 6 });
  });

  it('os chips: as escolhas e, fora delas, o prazo guardado', () => {
    expect(longCyclePeriodChoices(3)).toEqual([...LONG_CYCLE_PERIOD_CHOICES]);
    expect(longCyclePeriodChoices(5)).toEqual([1, 2, 3, 4, 5, 6, 9, 12, 18, 24]);
    expect(longCyclePeriodChoices(13)).toEqual([1, 2, 3, 4, 6, 9, 12, 13, 18, 24]);
  });
});

describe('os textos', () => {
  it('as constantes', () => {
    expect(SUGGESTION_TITLES.longCycle).toBe('Hora de trocar');
    expect(LONG_CYCLE_TITLE).toBe('Prazos de troca');
    expect(LONG_CYCLE_ROW_SUBTITLE).toBe('Quando trocar a escova de dente, o refil do filtro, o travesseiro…');
    expect(longCycleRowSubtitle(null)).toBe(LONG_CYCLE_ROW_SUBTITLE);
    expect(longCycleRowSubtitle('Casa da Ana')).toBe(`Casa da Ana · ${LONG_CYCLE_ROW_SUBTITLE}`);
    expect(LONG_CYCLE_INTRO).toContain('vale para a casa toda');
    expect(LONG_CYCLE_FOOTNOTE).toContain('"Já troquei"');
    expect(LONG_CYCLE_NOT_READY).toBe('Mudar os prazos ainda não está disponível. Por enquanto vale o padrão do Kotii.');
    expect(LONG_CYCLE_OFFLINE).toBe('Sem internet: não deu para abrir os prazos de troca.');
    expect(LONG_CYCLE_HISTORY_FAILED).toContain('compras mais antigas');
    expect(LONG_CYCLE_ACTIONS).toEqual({
      add: 'Pôr na lista',
      replaced: 'Já troquei',
      undoReplaced: 'Desfazer o “Já troquei”',
      period: 'Mudar o prazo',
      off: 'Não sugerir mais',
      on: 'Voltar a sugerir',
    });
    expect(LONG_CYCLE_BADGES).toEqual({ due: 'Hora de trocar', onList: 'Na lista', off: 'Não sugerido' });
    expect(longCycleOptionsLabel('Escova de dente')).toBe('Opções de Escova de dente');
    expect(longCycleAddLabel('Escova de dente')).toBe('Pôr Escova de dente na lista');
    expect(LONG_CYCLE_PERIOD_QUESTION).toBe('Trocar a cada');
    expect(LONG_CYCLE_SHEET).toEqual({ save: 'Salvar', cancel: 'Cancelar' });
    expect(longCycleDefaultLine(3)).toBe('O padrão do Kotii é 3 meses.');
    expect(longCycleDefaultChipLabel(3)).toBe('3 meses, o padrão do Kotii');
    expect(LONG_CYCLE_UNDO).toBe('Desfazer');
    expect(LONG_CYCLE_ERROR_TITLE).toBe('Erro');
  });

  it('os avisos e o desfazer', () => {
    expect(longCycleReplacedNotice('Escova de dente')).toBe('Escova de dente: troca anotada hoje.');
    expect(longCycleOffNotice('Travesseiro')).toBe(
      'Travesseiro não vai mais aparecer aqui. Para voltar, abra Configurações → Casa → Prazos de troca.',
    );
    expect(longCyclePeriodNotice('Vassoura', 18)).toBe('Vassoura: agora a cada 1 ano e meio.');
    expect(longCycleNotice('replaced', 'Escova de dente', 3)).toBe(longCycleReplacedNotice('Escova de dente'));
    expect(longCycleNotice('off', 'Travesseiro', 24)).toBe(longCycleOffNotice('Travesseiro'));
    expect(longCycleNotice('period', 'Vassoura', 12)).toBe('Vassoura: agora todo ano.');
    expect(longCycleUndoLabel('replaced', 'Escova de dente')).toBe('Desfazer a troca de Escova de dente');
    expect(longCycleUndoLabel('off', 'Travesseiro')).toBe('Voltar a sugerir Travesseiro');
    expect(longCycleUndoLabel('period', 'Vassoura')).toBe('Voltar ao prazo de antes de Vassoura');
  });

  it('"Ver os outros"', () => {
    expect(longCycleSeeMore(1)).toBe('Ver o outro (1)');
    expect(longCycleSeeMore(2)).toBe('Ver os outros (2)');
    expect(longCycleSeeMoreLabel(1)).toBe('Ver o outro item na hora de trocar');
    expect(longCycleSeeMoreLabel(2)).toBe('Ver os outros 2 itens na hora de trocar');
  });

  it('os meses', () => {
    expect([1, 2, 12, 13, 18, 24, 30].map(longCycleMonthsText)).toEqual([
      '1 mês',
      '2 meses',
      '1 ano',
      '1 ano e 1 mês',
      '1 ano e meio',
      '2 anos',
      '2 anos e meio',
    ]);
    expect(longCycleMonthsText(14)).toBe('1 ano e 2 meses');
    expect([1, 12, 3, 18].map(longCycleEvery)).toEqual(['todo mês', 'todo ano', 'a cada 3 meses', 'a cada 1 ano e meio']);
  });

  it('há quanto tempo', () => {
    expect(longCycleWhen(TODAY, TODAY)).toBe('hoje');
    expect(longCycleWhen('2026-11-21', TODAY)).toBe('há 1 dia');
    expect(longCycleWhen('2026-10-31', TODAY)).toBe('há 22 dias');
    expect(longCycleWhen('2026-07-22', TODAY)).toBe('há 4 meses');
    expect(longCycleWhen('2026-07-23', TODAY)).toBe('há 3 meses');
    expect(longCycleWhen('2025-09-22', TODAY)).toBe('há 1 ano e 2 meses');
    expect(longCycleWhen('2025-05-01', TODAY)).toBe('há 1 ano e meio');
    // 31/01 + 1 mês = 28/02: em 28/02 já é um mês.
    expect(longCycleWhen('2026-01-31', '2026-02-28')).toBe('há 1 mês');
    expect(longCycleWhen('2026-01-31', '2026-02-27')).toBe('há 27 dias');
  });

  it('a linha do Hoje', () => {
    expect(describeLongCycle({ last: { day: '2026-07-22', via: 'compra' }, months: 3 }, TODAY)).toBe(
      'Última compra há 4 meses · trocar a cada 3 meses',
    );
    expect(describeLongCycle({ last: { day: '2025-11-22', via: 'troca' }, months: 12 }, TODAY)).toBe('Última troca há 1 ano · trocar todo ano');
  });

  it('a linha da tela dos prazos, por estado', () => {
    const last = { day: '2026-07-22', via: 'compra' as const };
    expect(longCycleRowText({ last: null, months: 3, custom: false, status: 'sem_compra' }, TODAY)).toBe(
      'A cada 3 meses · nenhuma compra pelo app',
    );
    expect(longCycleRowText({ last, months: 6, custom: false, status: 'em_dia' }, TODAY)).toBe('A cada 6 meses · última compra há 4 meses');
    expect(longCycleRowText({ last, months: 2, custom: true, status: 'trocar' }, TODAY)).toBe(
      'A cada 2 meses (prazo da casa) · última compra há 4 meses',
    );
    expect(longCycleRowText({ last, months: 1, custom: true, status: 'parou' }, TODAY)).toBe(
      'Todo mês (prazo da casa) · última compra há 4 meses (já não aparece em Hoje)',
    );
    expect(longCycleRowText({ last: { day: TODAY, via: 'troca' }, months: 12, custom: false, status: 'off' }, TODAY)).toBe(
      'Todo ano · última troca hoje',
    );
    expect(longCycleRowText({ last: null, months: 12, custom: false, status: 'off' }, TODAY)).toBe('Todo ano');
  });

  it('a data do aparelho', () => {
    expect(longCycleDayError('2000-01-01')).toBeNull();
    expect(longCycleDayError('2100-12-31')).toBeNull();
    const message = {
      title: 'Confira a data do aparelho',
      message: 'A data deste aparelho parece errada. Acerte o dia e a hora dele para o Kotii guardar quando foi a troca.',
    };
    expect(longCycleDayError('1999-12-31')).toEqual(message);
    expect(longCycleDayError('2101-01-01')).toEqual(message);
  });
});

describe('o banco', () => {
  const dir = join(__dirname, '../../../supabase/migrations');
  const file = readdirSync(dir).find((f) => readFileSync(join(dir, f), 'utf8').includes('create table public.long_cycle_settings'));
  const sql = readFileSync(join(dir, file!), 'utf8');

  it('os limites são os do app', () => {
    expect(file).toBe('20261122130000_long_cycle_settings.sql');
    expect(sql).toContain(`check (every_months between ${LONG_CYCLE_MIN_MONTHS} and ${LONG_CYCLE_MAX_MONTHS})`);
    expect(sql).toContain(`check (item_key ~ '${LONG_CYCLE_KEY_PATTERN.source}')`);
    expect(sql).toContain(`check (replaced_on between date '${APP_MIN_DATE}' and date '${APP_MAX_DATE}')`);
  });

  it('a leitura longa cobre o prazo maior até a sugestão desistir', () => {
    expect(LONG_CYCLE_HISTORY_MONTHS).toBeGreaterThanOrEqual(LONG_CYCLE_MAX_MONTHS * LONG_CYCLE_GIVE_UP_FACTOR);
    expect(Math.max(...LONG_CYCLE_ITEMS.map((i) => i.months))).toBeLessThanOrEqual(LONG_CYCLE_MAX_MONTHS);
    expect(Math.min(...LONG_CYCLE_ITEMS.map((i) => i.months))).toBeGreaterThanOrEqual(LONG_CYCLE_MIN_MONTHS);
  });
});
