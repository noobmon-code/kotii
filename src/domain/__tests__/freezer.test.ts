import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  asksFrozenOnReceipt,
  boughtFrozen,
  DEFAULT_FREEZE_DAYS,
  FREEZE_KINDS,
  freezeChoices,
  freezeKind,
  freezeKindOf,
  frozenChipLabel,
  frozenExpiryFor,
  frozenExpiryHint,
  frozenFormLine,
  frozenKeptText,
  frozenOnFits,
  frozenReceiptHint,
  frozenSheetText,
  frozenText,
  hasFreezerFields,
  isFreezeKind,
  isFrozen,
  pantryFormFreeze,
  repeatFreezeFailedText,
  repeatFreezes,
  thawedExpiry,
  thawedFormLine,
  thawedRowSubtitle,
  thawedSuffix,
  thawedText,
  thawPreviewText,
  wasFrozen,
  type FreezeKind,
  type FreezerRow,
  type ThawedRow,
} from '../freezer';
import { APP_MAX_DATE, APP_MIN_DATE } from '../dates';
import { EXPIRY_SOURCES } from '../pantry';

const today = '2026-11-20';

describe('freezeKind: o tipo do congelador pelo nome', () => {
  const table: [name: string, category: string, kind: FreezeKind | null, unit?: string][] = [
    ['CARNE MOIDA PATINHO KG', 'carnes', 'carne_moida'],
    ['Carne moída', 'carnes', 'carne_moida'],
    ['ACEM MOIDO', 'carnes', 'carne_moida'],
    ['MOIDA DE PRIMEIRA', 'carnes', 'carne_moida'],
    ['Peito de frango moído', 'carnes', 'carne_moida'],
    ['CARNE MOIDA DE FRANGO', 'carnes', 'carne_moida'],
    ['HAMBURGUER BOVINO', 'carnes', 'carne_moida'],
    ['HAMBURGUER DE FRANGO', 'carnes', 'carne_moida'],
    ['KAFTA', 'carnes', 'carne_moida'],
    ['QUIBE', 'carnes', 'carne_moida'],
    ['ALMONDEGAS BOV', 'carnes', 'carne_moida'],
    ['QUIBE', 'padaria', null],
    ['FILE PEITO FGO SADIA', 'carnes', 'frango'],
    ['COXA SOBRECOXA FRANGO KG', 'carnes', 'frango'],
    ['ASA FRANGO', 'carnes', 'frango'],
    ['ASINHA DE FRANGO', 'carnes', 'frango'],
    ['CORACAO DE FRANGO', 'carnes', 'frango'],
    ['MOELA', 'carnes', 'frango'],
    ['FIGADO DE FRANGO', 'carnes', 'frango'],
    ['GALINHA CAIPIRA', 'carnes', 'frango'],
    ['Frango inteiro', 'carnes', 'frango'],
    ['Filé de peito', 'carnes', 'carne'],
    ['PICANHA BOV KG', 'carnes', 'carne'],
    ['LOMBO SUINO', 'carnes', 'carne'],
    ['PERNIL SUINO', 'carnes', 'carne'],
    ['FIGADO BOV', 'carnes', 'carne'],
    ['CARNE SECA', 'carnes', 'carne'],
    ['COSTELINHA SUINA', 'carnes', 'carne'],
    ['LINGUICA TOSCANA', 'carnes', 'frios'],
    ['BACON FATIADO', 'frios', 'frios'],
    ['PRESUNTO FAT', 'frios', 'frios'],
    ['Salsicha', 'frios', 'frios'],
    ['PEITO PERU', 'frios', 'frios'],
    ['Mortadela', 'frios', 'frios'],
    ['Salame', 'frios', 'frios'],
    ['APRESUNTADO', 'frios', 'frios'],
    ['FILE TILAPIA CONG', 'peixes', 'peixe'],
    ['SALMAO KG', 'peixes', 'peixe'],
    ['CAMARAO', 'peixes', 'peixe'],
    ['PEIXE ESPADA', 'peixes', 'peixe'],
    ['PANGA FILE', 'peixes', 'peixe'],
    ['LULA', 'peixes', 'peixe'],
    ['SARDINHA FRESCA', 'peixes', 'peixe'],
    ['SARDINHA', 'peixes', 'peixe', 'kg'],
    ['ATUM FRESCO KG', 'peixes', 'peixe'],
    ['ATUM RALADO GOMES DA COSTA', 'peixes', null],
    ['ATUM SOLIDO', 'peixes', null],
    ['SARDINHA EM OLEO', 'peixes', null],
    ['SARDINHA 88 COQUEIRO', 'peixes', null],
    ['PEIXE EMPANADO', 'peixes', null],
    ['FRANGO EMPANADO', 'carnes', null],
    ['PAO FRANCES KG', 'padaria', 'pao'],
    ['Pão de forma', 'padaria', 'pao'],
    ['BISNAGUINHA', 'padaria', 'pao'],
    ['PAO SIRIO', 'padaria', 'pao'],
    ['PAO DOCE', 'padaria', 'pao'],
    ['CROISSANT', 'padaria', 'pao'],
    ['PAO DE ALHO', 'padaria', null],
    ['Pão de queijo', 'padaria', null],
    ['Bolo de cenoura', 'padaria', null],
    ['TORRADA', 'padaria', null],
    ['MUSSARELA FAT', 'frios', null],
    ['MUSSARELA FAT', 'laticinios', null],
    ['NUGGETS SADIA', 'congelados', null],
    ['PAO DE QUEIJO CONG', 'congelados', null],
    ['Frango', 'limpeza', null],
    ['Arroz', 'graos', null],
  ];
  // Sem a unidade na linha, "un" (o parâmetro a mais seria lido pelo Jest como o "done" do teste).
  it.each(table)('%s (%s) → %s', (...row) => {
    const [name, category, kind, unit] = row;
    expect(freezeKind(name, category, unit ?? 'un')).toBe(kind);
  });

  it('com vários nomes, o primeiro que o vocabulário conhece decide antes da categoria', () => {
    expect(freezeKindOf(['Filé de peito', 'FILE PEITO FGO SADIA'], 'carnes')).toBe('frango');
    expect(freezeKindOf([null, '', 'PICANHA BOV KG'], 'carnes')).toBe('carne');
    // Nenhum conhecido: a categoria pelo primeiro nome que não está vazio.
    expect(freezeKindOf(['', 'MOIDA DE PRIMEIRA', 'KAFTA'], 'carnes')).toBe('carne_moida');
    expect(freezeKindOf([null, undefined], 'carnes')).toBeNull();
    // Conhecido como outra coisa: não cai na categoria.
    expect(freezeKindOf(['Frango empanado', 'FRANGO KG'], 'carnes')).toBeNull();
  });
});

describe('asksFrozenOnReceipt e boughtFrozen', () => {
  it('a nota pergunta para carne, frango, carne moída e peixe, e para qualquer tipo comprado como carne ou peixe', () => {
    expect(asksFrozenOnReceipt('carne', 'carnes')).toBe(true);
    expect(asksFrozenOnReceipt('frango', 'carnes')).toBe(true);
    expect(asksFrozenOnReceipt('carne_moida', 'carnes')).toBe(true);
    expect(asksFrozenOnReceipt('peixe', 'peixes')).toBe(true);
    expect(asksFrozenOnReceipt(freezeKind('LINGUICA TOSCANA', 'carnes'), 'carnes')).toBe(true);
    expect(asksFrozenOnReceipt(freezeKind('Salsicha', 'frios'), 'frios')).toBe(false);
    expect(asksFrozenOnReceipt('pao', 'padaria')).toBe(false);
    expect(asksFrozenOnReceipt('frios', 'frios')).toBe(false);
    expect(asksFrozenOnReceipt(null, 'carnes')).toBe(false);
  });

  it('"CONG" no nome é comprado congelado', () => {
    expect(boughtFrozen(['FILE TILAPIA CONG'])).toBe(true);
    expect(boughtFrozen([null, 'Peixe congelado'])).toBe(true);
    expect(boughtFrozen(['Coxas congeladas'])).toBe(true);
    expect(boughtFrozen(['PICANHA BOV KG', null])).toBe(false);
    expect(boughtFrozen(['Congelador'])).toBe(false);
  });

  it('os tipos conhecidos e as colunas da compra', () => {
    expect(isFreezeKind('carne')).toBe(true);
    expect(isFreezeKind('boi')).toBe(false);
    expect(isFrozen({ frozen_on: '2026-11-01', thawed_on: null })).toBe(true);
    expect(isFrozen({ frozen_on: '2026-11-01', thawed_on: '2026-11-05' })).toBe(false);
    expect(isFrozen({})).toBe(false);
    expect(wasFrozen({ frozen_on: '2026-11-01' })).toBe(true);
    expect(wasFrozen({ frozen_on: null })).toBe(false);
    expect(hasFreezerFields({ frozen_on: null })).toBe(true);
    expect(hasFreezerFields({})).toBe(false);
  });
});

describe('frozenExpiryFor e thawedExpiry', () => {
  it('a validade do congelador conta do dia em que foi congelado', () => {
    expect(
      frozenExpiryFor({ frozenOn: '2026-11-01', fresh: { expiresOn: '2026-11-04', source: 'categoria' }, kind: 'frango', days: DEFAULT_FREEZE_DAYS }),
    ).toEqual({ expiresOn: '2027-01-30', source: 'congelado' });
    expect(frozenExpiryFor({ frozenOn: '2026-11-01', fresh: { expiresOn: null, source: null }, kind: 'frios', days: DEFAULT_FREEZE_DAYS })).toEqual({
      expiresOn: '2026-12-01',
      source: 'congelado',
    });
    // No último dia da validade de antes ainda vale o congelador.
    expect(
      frozenExpiryFor({ frozenOn: '2026-11-04', fresh: { expiresOn: '2026-11-04', source: 'manual' }, kind: 'peixe', days: DEFAULT_FREEZE_DAYS }),
    ).toEqual({ expiresOn: '2027-01-03', source: 'congelado' });
  });

  it('a que já tinha passado antes do dia em que foi congelada fica como estava, com a origem', () => {
    const fresh = { expiresOn: '2026-11-04', source: 'manual' as const };
    expect(frozenExpiryFor({ frozenOn: '2026-11-06', fresh, kind: 'carne', days: DEFAULT_FREEZE_DAYS })).toEqual(fresh);
  });

  it('descongelar: a validade volta a contar de onde parou (os mesmos casos de thaw_pantry_items)', () => {
    const lot = { frozen_on: '2026-11-01', fresh_expires_on: '2026-11-04', fresh_expiry_source: 'categoria' as const };
    expect(thawedExpiry(lot, '2026-11-20')).toEqual({ expiresOn: '2026-11-23', source: 'descongelado', undo: false });
    // No mesmo dia: desfaz.
    expect(thawedExpiry(lot, '2026-11-01')).toEqual({ expiresOn: '2026-11-04', source: 'categoria', undo: true });
    expect(thawedExpiry(lot, '2026-10-30')).toEqual({ expiresOn: '2026-11-04', source: 'categoria', undo: true });
    // Sem validade de antes.
    expect(thawedExpiry({ frozen_on: '2026-11-01', fresh_expires_on: null, fresh_expiry_source: null }, '2026-11-20')).toEqual({
      expiresOn: null,
      source: null,
      undo: false,
    });
    // Congelado dois dias depois de vencer: continua dois dias vencido.
    expect(thawedExpiry({ frozen_on: '2026-11-06', fresh_expires_on: '2026-11-04', fresh_expiry_source: 'categoria' }, '2026-11-20')).toEqual({
      expiresOn: '2026-11-18',
      source: 'descongelado',
      undo: false,
    });
    // Congelado no último dia: vence no dia em que sai.
    expect(thawedExpiry({ frozen_on: '2026-11-04', fresh_expires_on: '2026-11-04', fresh_expiry_source: 'manual' }, '2026-11-20').expiresOn).toBe(
      '2026-11-20',
    );
  });

  it('a descongelada que voltou ao congelador e sai no mesmo dia volta à validade dela (o F de scripts/db/test.sql)', () => {
    // Congelado 01/11 (vencia 04/11), descongelado 20/11 (23/11), de novo no congelador 21/11 e descongelado nesse dia.
    const refrozen = { frozen_on: '2026-11-21', fresh_expires_on: '2026-11-23', fresh_expiry_source: 'descongelado' as const };
    expect(thawedExpiry(refrozen, '2026-11-21')).toEqual({ expiresOn: '2026-11-23', source: 'descongelado', undo: true });
    // Outro dia: pausa como qualquer outra.
    expect(thawedExpiry(refrozen, '2026-11-25')).toEqual({ expiresOn: '2026-11-27', source: 'descongelado', undo: false });
  });

  it('desfazer a descongelada guarda que ela esteve no congelador: o banco devolve frozen_on (a migração)', () => {
    const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261122110000_pantry_freezer.sql'), 'utf8');
    const thaw = sql.slice(sql.indexOf('create function public.thaw_pantry_items'));
    expect(thaw).toContain('frozen_on = case when p_thawed_on <= p.frozen_on then p.prev_frozen_on else p.frozen_on end');
    expect(thaw).toContain('thawed_on = case when p_thawed_on <= p.frozen_on then p.prev_thawed_on else p_thawed_on end');
    // E diz qual foi desfeita, pelo frozen_on de antes (a mesma condição de thawedExpiry): o aviso usa isso, não frozen_on.
    expect(thaw).toContain('item_frozen_on date, item_undone boolean)');
    expect(thaw).toContain('returning p.id, p.expires_on, p.expiry_source, p.frozen_on, p_thawed_on <= o.frozen_on');
    expect(sql).toContain("check (expiry_source is distinct from 'descongelado' or frozen_on is not null)");
  });
});

describe('freezeChoices: o menu da despensa', () => {
  it('comprado hoje (ou depois): Congelar', () => {
    expect(freezeChoices([{ purchased_on: today }], today)).toEqual([{ label: 'Congelar', frozenOn: today }]);
    expect(freezeChoices([{ purchased_on: today }, { purchased_on: '2026-11-21' }], today)).toEqual([
      { label: 'Congelar (tudo)', frozenOn: today },
    ]);
  });

  it('uma compra de antes: hoje ou no dia da compra', () => {
    expect(freezeChoices([{ purchased_on: '2026-11-12' }], today)).toEqual([
      { label: 'Congelei hoje', frozenOn: today },
      { label: 'Congelei no dia da compra (12 nov)', frozenOn: '2026-11-12' },
    ]);
  });

  it('várias do mesmo dia de antes, e de dias diferentes', () => {
    expect(freezeChoices([{ purchased_on: '2026-11-12' }, { purchased_on: '2026-11-12' }], today)).toEqual([
      { label: 'Congelei hoje (tudo)', frozenOn: today },
      { label: 'Congelei no dia da compra (12 nov, tudo)', frozenOn: '2026-11-12' },
    ]);
    expect(freezeChoices([{ purchased_on: '2026-11-15' }, { purchased_on: '2026-11-12' }, { purchased_on: today }], today)).toEqual([
      { label: 'Congelei hoje (tudo)', frozenOn: today },
      { label: 'Congelei no dia de cada compra (tudo)', frozenOn: '2026-11-12' },
    ]);
  });

  it('a compra de outro ano leva o ano', () => {
    expect(freezeChoices([{ purchased_on: '2025-12-30' }], '2026-01-02')[1].label).toBe('Congelei no dia da compra (30 dez 2025)');
  });

  it('a descongelada: nunca antes do dia em que saiu do congelador (o mesmo piso de freeze_pantry_items e do formulário)', () => {
    // Comprado 01/11, descongelado 18/11: "no dia da compra" seria um dia que o banco não grava.
    expect(freezeChoices([{ purchased_on: '2026-11-01', thawed_on: '2026-11-18' }], today)).toEqual([
      { label: 'Congelei hoje', frozenOn: today },
      { label: 'Congelei no dia em que descongelou (18 nov)', frozenOn: '2026-11-18' },
    ]);
    // Descongelado hoje: só hoje.
    expect(freezeChoices([{ purchased_on: '2026-11-01', thawed_on: today }], today)).toEqual([{ label: 'Congelar', frozenOn: today }]);
    // Descongeladas no mesmo dia.
    expect(
      freezeChoices([{ purchased_on: '2026-11-01', thawed_on: '2026-11-18' }, { purchased_on: '2026-11-03', thawed_on: '2026-11-18' }], today),
    ).toEqual([
      { label: 'Congelei hoje (tudo)', frozenOn: today },
      { label: 'Congelei no dia em que descongelou (18 nov, tudo)', frozenOn: '2026-11-18' },
    ]);
    // Com outra fresca, ou descongeladas em dias diferentes: só hoje (outro dia, no item).
    expect(freezeChoices([{ purchased_on: '2026-11-12' }, { purchased_on: '2026-11-01', thawed_on: '2026-11-18' }], today)).toEqual([
      { label: 'Congelei hoje (tudo)', frozenOn: today },
    ]);
    expect(
      freezeChoices([{ purchased_on: '2026-11-01', thawed_on: '2026-11-17' }, { purchased_on: '2026-11-01', thawed_on: '2026-11-18' }], today),
    ).toEqual([{ label: 'Congelei hoje (tudo)', frozenOn: today }]);
    // Descongelada no próprio dia da compra: o dia da compra ainda serve.
    expect(freezeChoices([{ purchased_on: '2026-11-12', thawed_on: '2026-11-12' }], today)).toEqual([
      { label: 'Congelei hoje', frozenOn: today },
      { label: 'Congelei no dia da compra (12 nov)', frozenOn: '2026-11-12' },
    ]);
    // Nenhuma escolha manda um dia que o banco mudaria (greatest(dia, compra, saída)).
    const lots = [
      [{ purchased_on: '2026-11-01', thawed_on: '2026-11-18' }],
      [{ purchased_on: '2026-11-12', thawed_on: null }],
      [{ purchased_on: '2026-11-01', thawed_on: '2026-11-18' }, { purchased_on: '2026-11-03', thawed_on: '2026-11-18' }],
    ];
    for (const group of lots) {
      for (const choice of freezeChoices(group, today)) {
        const stored = group.map((lot) => [choice.frozenOn, lot.purchased_on, lot.thawed_on ?? lot.purchased_on].sort().at(-1));
        if (!choice.label.includes('cada compra')) expect(stored.every((day) => day === choice.frozenOn)).toBe(true);
      }
    }
  });
});

describe('pantryFormFreeze: o formulário da compra', () => {
  const days = DEFAULT_FREEZE_DAYS;
  const estimate = { expiresOn: '2026-11-23', source: 'categoria' as const };

  it('item novo congelando: a validade de antes é a estimada, a do campo a do congelador', () => {
    expect(
      pantryFormFreeze({ item: null, freezing: true, frozenOn: '2026-11-20', kind: 'frango', estimate, days }),
    ).toEqual({
      expires_on: '2027-02-18',
      expiry_source: 'congelado',
      freezer: {
        frozen_on: '2026-11-20',
        thawed_on: null,
        freeze_kind: 'frango',
        fresh_expires_on: '2026-11-23',
        fresh_expiry_source: 'categoria',
      },
    });
  });

  it('a data digitada antes de "Congelei" vira a de antes (manual); a digitada depois é a do congelador (manual)', () => {
    const before = pantryFormFreeze({
      item: null,
      freezing: true,
      frozenOn: '2026-11-20',
      kind: 'carne',
      estimate,
      freshTyped: '2026-11-25',
      days,
    });
    expect(before.freezer).toEqual(expect.objectContaining({ fresh_expires_on: '2026-11-25', fresh_expiry_source: 'manual' }));
    expect(before).toEqual(expect.objectContaining({ expires_on: '2027-02-18', expiry_source: 'congelado' }));
    const after = pantryFormFreeze({
      item: null,
      freezing: true,
      frozenOn: '2026-11-20',
      kind: 'carne',
      estimate,
      expiryTyped: '2027-01-10',
      days,
    });
    expect(after).toEqual(expect.objectContaining({ expires_on: '2027-01-10', expiry_source: 'manual' }));
    expect(after.freezer).toEqual(expect.objectContaining({ fresh_expires_on: '2026-11-23', fresh_expiry_source: 'categoria' }));
    // Apagada: sem validade.
    expect(pantryFormFreeze({ item: null, freezing: true, frozenOn: '2026-11-20', kind: 'carne', estimate, expiryTyped: null, days })).toEqual(
      expect.objectContaining({ expires_on: null, expiry_source: null }),
    );
  });

  it('compra que existe, congelando: a validade de antes é a da cópia', () => {
    const item = { expires_on: '2026-11-22', expiry_source: 'produto' as const, frozen_on: null, thawed_on: null };
    expect(pantryFormFreeze({ item, freezing: true, frozenOn: '2026-11-19', kind: 'peixe', estimate, days }).freezer).toEqual({
      frozen_on: '2026-11-19',
      thawed_on: null,
      freeze_kind: 'peixe',
      fresh_expires_on: '2026-11-22',
      fresh_expiry_source: 'produto',
    });
  });

  it('descongelada e congelada de novo: thawed_on volta a vazio, a validade de antes é a descongelada', () => {
    const item = { expires_on: '2026-11-26', expiry_source: 'descongelado' as const, frozen_on: '2026-11-01', thawed_on: '2026-11-18' };
    const out = pantryFormFreeze({ item, freezing: true, frozenOn: '2026-11-20', kind: 'frango', estimate, days });
    expect(out.freezer).toEqual({
      frozen_on: '2026-11-20',
      thawed_on: null,
      freeze_kind: 'frango',
      fresh_expires_on: '2026-11-26',
      fresh_expiry_source: 'descongelado',
    });
    expect(out.expiry_source).toBe('congelado');
  });

  it('já no congelador: o dia e o tipo; a data digitada antes fica; sem ela, refeita com o dia do campo', () => {
    const item = {
      expires_on: '2027-01-30',
      expiry_source: 'congelado' as const,
      frozen_on: '2026-11-01',
      thawed_on: null,
      freeze_kind: 'frango',
      fresh_expires_on: '2026-11-04',
      fresh_expiry_source: 'categoria' as const,
    };
    expect(pantryFormFreeze({ item, freezing: false, frozenOn: '2026-11-01', kind: 'frango', estimate, days })).toEqual({
      expires_on: '2027-01-30',
      expiry_source: 'congelado',
      freezer: { frozen_on: '2026-11-01', freeze_kind: 'frango' },
    });
    expect(pantryFormFreeze({ item, freezing: false, frozenOn: '2026-11-03', kind: 'frango', estimate, days }).expires_on).toBe('2027-02-01');
    expect(pantryFormFreeze({ item: { ...item, expires_on: '2027-03-01', expiry_source: 'manual' }, freezing: false, frozenOn: '2026-11-03', kind: 'frango', estimate, days })).toEqual(
      expect.objectContaining({ expires_on: '2027-03-01', expiry_source: 'manual' }),
    );
    expect(pantryFormFreeze({ item, freezing: false, frozenOn: '2026-11-01', kind: 'frango', estimate, expiryTyped: '2026-12-24', days })).toEqual(
      expect.objectContaining({ expires_on: '2026-12-24', expiry_source: 'manual' }),
    );
  });

  it('fora do congelador: a regra de sempre, sem colunas do congelador', () => {
    expect(pantryFormFreeze({ item: null, freezing: false, frozenOn: null, kind: 'frango', estimate, days })).toEqual({
      expires_on: '2026-11-23',
      expiry_source: 'categoria',
      freezer: {},
    });
    const item = { expires_on: '2026-11-22', expiry_source: 'produto' as const };
    expect(pantryFormFreeze({ item, freezing: false, frozenOn: null, kind: null, estimate, days })).toEqual({
      expires_on: '2026-11-22',
      expiry_source: 'produto',
      freezer: {},
    });
    expect(pantryFormFreeze({ item, freezing: false, frozenOn: null, kind: null, estimate, expiryTyped: '2026-12-01', days })).toEqual({
      expires_on: '2026-12-01',
      expiry_source: 'manual',
      freezer: {},
    });
    // Sem tipo, "Congelei" não vale.
    expect(pantryFormFreeze({ item: null, freezing: true, frozenOn: '2026-11-20', kind: null, estimate, days }).freezer).toEqual({});
  });

  it('o dia de "Congelado em" fica entre a compra (ou a saída do congelador) e hoje', () => {
    expect(frozenOnFits('2026-11-15', { purchasedOn: '2026-11-12', today })).toBe(true);
    expect(frozenOnFits('2026-11-12', { purchasedOn: '2026-11-12', today })).toBe(true);
    expect(frozenOnFits('2026-11-11', { purchasedOn: '2026-11-12', today })).toBe(false);
    expect(frozenOnFits('2026-11-21', { purchasedOn: '2026-11-12', today })).toBe(false);
    expect(frozenOnFits('2026-11-16', { purchasedOn: '2026-11-12', thawedOn: '2026-11-17', today })).toBe(false);
    expect(frozenOnFits(null, { purchasedOn: '2026-11-12', today })).toBe(false);
  });
});

describe('repeatFreezes: "Não colocar" com linhas "Congelei"', () => {
  it('a compra do carrinho que cada linha congelada repete, por tipo e dia', () => {
    const payload = [
      { id: 'a', pantry: { name: 'Frango', frozen_on: '2026-11-10', freeze_kind: 'frango' as const } },
      { id: 'b', pantry: { name: 'Coxa', frozen_on: '2026-11-10', freeze_kind: 'frango' as const } },
      { id: 'c', pantry: { name: 'Tilápia', frozen_on: '2026-11-10', freeze_kind: 'peixe' as const } },
      { id: 'd', pantry: { name: 'Leite' } },
    ];
    expect(
      repeatFreezes(
        [
          { id: 'a', name: 'Frango', entryId: 'p1' },
          { id: 'b', name: 'Coxa', entryId: 'p1' },
          { id: 'c', name: 'Tilápia', entryId: 'p3' },
          { id: 'd', name: 'Leite', entryId: 'p4' },
          { id: 'a', name: 'Frango' },
        ],
        payload,
      ),
    ).toEqual([
      { kind: 'frango', frozenOn: '2026-11-10', ids: ['p1'], names: ['Frango', 'Coxa'] },
      { kind: 'peixe', frozenOn: '2026-11-10', ids: ['p3'], names: ['Tilápia'] },
    ]);
  });
});

describe('frases', () => {
  const row = (over: Partial<FreezerRow>): FreezerRow => ({ id: 'x', expiresOn: '2027-02-19', expirySource: 'congelado', frozenOn: '2026-11-21', ...over });
  const thawed = (over: Partial<ThawedRow>): ThawedRow => ({ ...row({ frozenOn: '2026-11-01', expirySource: 'descongelado' }), undone: false, ...over });

  it('as linhas da tela, com o ano só quando é outro', () => {
    expect(thawedRowSubtitle('2026-11-20', today)).toBe('Descongelado em 20 nov');
    expect(thawedSuffix('2026-11-20', today)).toBe(' · descongelado em 20 nov');
    expect(frozenFormLine('2026-11-12', today)).toBe('No congelador desde 12 nov.');
    expect(thawedFormLine('2025-12-20', today)).toBe('Descongelado em 20 dez 2025.');
    expect(frozenChipLabel('FILE TILAPIA CONG')).toBe('Congelei: FILE TILAPIA CONG');
  });

  it('o aviso de congelar', () => {
    expect(frozenText('Frango', [row({}), row({ expiresOn: '2027-03-01' })], today)).toBe(
      'Frango foi para o congelador. Validade estimada: 19 fev 2027.',
    );
    expect(frozenText('Frango', [row({}), row({ expiresOn: '2026-11-04', expirySource: 'categoria' })], today)).toBe(
      'Frango foi para o congelador. Validade estimada: 19 fev 2027. O que já tinha passado da validade ficou como estava.',
    );
    expect(frozenText('Frango', [row({ expiresOn: '2026-11-04', expirySource: 'manual' })], today)).toBe(
      'Frango foi para o congelador, mas já tinha passado da validade (4 nov), e ela fica como estava. Se congelou antes disso, corrija "Congelado em" no item.',
    );
    expect(frozenKeptText('Frango', '2026-11-04', today)).toContain('(4 nov)');
  });

  it('o aviso de descongelar', () => {
    expect(thawedText('Frango', [thawed({ frozenOn: null, expiresOn: '2026-11-23', expirySource: 'categoria', undone: true })], today)).toBe(
      'Frango saiu do congelador, com a validade de antes.',
    );
    expect(thawedText('Frango', [thawed({ expiresOn: '2026-11-23' })], today)).toBe(
      'Frango saiu do congelador. A validade volta a contar de onde parou: vence por volta de 23 nov.',
    );
    expect(thawedText('Frango', [thawed({ expiresOn: '2026-11-18' })], today)).toBe(
      'Frango saiu do congelador. A validade volta a contar de onde parou, e ela já tinha passado (18 nov).',
    );
    expect(thawedText('Frango', [thawed({ expiresOn: null, expirySource: null })], today)).toBe('Frango saiu do congelador.');
    // Sem validade de antes, desfeito: a validade de antes era nenhuma.
    expect(thawedText('Frango', [thawed({ frozenOn: null, expiresOn: null, expirySource: null, undone: true })], today)).toBe(
      'Frango saiu do congelador, com a validade de antes.',
    );
  });

  it('a descongelada que voltou ao congelador e sai no mesmo dia: o aviso de desfazer, mesmo com frozen_on (o F e o G de test.sql)', () => {
    // O banco devolve o dia em que tinha sido congelada antes (01/11), e item_undone diz que desfez.
    expect(thawedText('Frango', [thawed({ expiresOn: '2026-11-23', undone: true })], today)).toBe(
      'Frango saiu do congelador, com a validade de antes.',
    );
    // A validade digitada depois de descongelar volta como estava: nunca "por volta de" para uma data digitada.
    expect(thawedText('Frango', [thawed({ expiresOn: '2026-11-21', expirySource: 'manual', undone: true })], today)).toBe(
      'Frango saiu do congelador, com a validade de antes.',
    );
  });

  it('o aviso diz o que a prévia prometeu: a mesma regra, pela compra que vence primeiro', () => {
    // Congelado 01/11 (vencia 04/11), descongelado 18/11 (21/11), de novo no congelador hoje (20/11).
    const refrozen = { frozen_on: today, fresh_expires_on: '2026-11-21', fresh_expiry_source: 'descongelado' as const };
    const old = { frozen_on: '2026-11-01', fresh_expires_on: '2026-11-10', fresh_expiry_source: 'categoria' as const };
    const cases: { lots: (typeof refrozen | typeof old)[]; rows: ThawedRow[] }[] = [
      { lots: [refrozen], rows: [thawed({ expiresOn: '2026-11-21', undone: true })] },
      // Uma desfeita e uma que pausa: a que vence primeiro decide, nas duas frases.
      { lots: [refrozen, old], rows: [thawed({ expiresOn: '2026-11-21', undone: true }), thawed({ id: 'y', expiresOn: '2026-11-29' })] },
      { lots: [{ ...old, fresh_expires_on: '2026-11-03' }, refrozen], rows: [thawed({ expiresOn: '2026-11-22' }), thawed({ id: 'y', expiresOn: '2026-11-21', undone: true })] },
      { lots: [{ ...old, fresh_expires_on: '2026-10-30' }, refrozen], rows: [thawed({ expiresOn: '2026-11-18' }), thawed({ id: 'y', expiresOn: '2026-11-21', undone: true })] },
    ];
    for (const { lots, rows } of cases) {
      const preview = thawPreviewText(lots, today)!;
      const notice = thawedText('Frango', rows, today);
      expect(preview.startsWith('Se descongelar hoje, volta para a validade de antes')).toBe(notice.endsWith('com a validade de antes.'));
    }
    expect(thawedText('Frango', cases[3].rows, today)).toBe(
      'Frango saiu do congelador. A validade volta a contar de onde parou, e ela já tinha passado (18 nov).',
    );
    // Na mesma data, a desfeita: em qualquer ordem.
    const tie = [thawed({ expiresOn: '2026-11-21' }), thawed({ id: 'y', expiresOn: '2026-11-21', undone: true })];
    expect(thawedText('Frango', tie, today)).toBe('Frango saiu do congelador, com a validade de antes.');
    expect(thawedText('Frango', [...tie].reverse(), today)).toBe('Frango saiu do congelador, com a validade de antes.');
    expect(thawPreviewText([{ ...old, fresh_expires_on: '2026-11-02' }, refrozen], today)).toBe('Se descongelar hoje, volta para a validade de antes.');
  });

  it('o menu de um grupo no congelador', () => {
    const lot = { frozen_on: '2026-11-01', fresh_expires_on: '2026-11-04', fresh_expiry_source: 'categoria' as const };
    expect(frozenSheetText([lot], today)).toBe('No congelador desde 1 nov. Se descongelar hoje: vence por volta de 23 nov.');
    expect(frozenSheetText([{ ...lot, frozen_on: '2026-11-06' }], today)).toBe(
      'No congelador desde 6 nov. Se descongelar hoje, a validade já tinha passado (18 nov).',
    );
    expect(frozenSheetText([{ ...lot, frozen_on: today }], today)).toBe(
      'No congelador desde 20 nov. Se descongelar hoje, volta para a validade de antes.',
    );
    expect(frozenSheetText([{ ...lot, fresh_expires_on: null, fresh_expiry_source: null }], today)).toBe(
      'No congelador desde 1 nov. Se descongelar hoje, fica sem validade.',
    );
    // Várias compras: desde a primeira, e a prévia da que vence primeiro.
    expect(frozenSheetText([{ ...lot, frozen_on: '2026-11-10', fresh_expires_on: '2026-11-15' }, lot], today)).toBe(
      'No congelador desde 1 nov. Se descongelar hoje: vence por volta de 23 nov.',
    );
    expect(thawPreviewText([], today)).toBeNull();
  });

  it('os avisos da nota e os textos de ajuda', () => {
    expect(repeatFreezeFailedText(['Frango'])).toBe(
      'A nota foi salva, mas não deu para marcar Frango como congelado. Em Compras > Despensa, toque no item e escolha quando ele foi para o congelador.',
    );
    expect(repeatFreezeFailedText(['Frango', 'Peixe'])).toBe(
      'A nota foi salva, mas não deu para marcar Frango e Peixe como congelados. Em Compras > Despensa, toque em cada item e escolha quando ele foi para o congelador.',
    );
    // O aviso não diz o nome de uma escolha: a compra do carrinho é quase sempre de antes de hoje, e "Congelar" só
    // aparece para o que foi comprado hoje.
    const offered = new Set(
      [[{ purchased_on: today }], [{ purchased_on: '2026-11-12' }], [{ purchased_on: '2026-11-12' }, { purchased_on: '2026-11-15' }]].flatMap(
        (lots) => freezeChoices(lots, today).map((choice) => choice.label),
      ),
    );
    const quoted = [...repeatFreezeFailedText(['Frango']).matchAll(/"([^"]+)"/g)].map(([, label]) => label);
    expect(quoted.filter((label) => !offered.has(label))).toEqual([]);
    expect(frozenExpiryHint('frango', DEFAULT_FREEZE_DAYS)).toBe(
      'Estimada pelo congelador: 90 dias para frango, contados de quando foi congelado. Se corrigir, fica só neste item.',
    );
    expect(frozenReceiptHint('frango', DEFAULT_FREEZE_DAYS)).toBe('Validade estimada no congelador (frango: 90 dias) — ajuste se quiser.');
    expect(frozenReceiptHint('carne', DEFAULT_FREEZE_DAYS)).toBe(
      'Validade estimada no congelador (carne bovina e suína: 90 dias) — ajuste se quiser.',
    );
  });
});

describe('a migração tem a mesma tabela', () => {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20261122110000_pantry_freezer.sql'), 'utf8');
  const kinds = FREEZE_KINDS.map((k) => `'${k.key}'`).join(', ');

  it('os tipos nos checks e nas funções', () => {
    expect(sql).toContain(`check (freeze_kind in (${kinds}))`);
    expect(sql).toContain(`p_kind not in (${kinds})`);
  });

  it('os dias de cada tipo em pantry_freeze_days', () => {
    const body = sql.slice(sql.indexOf('create function public.pantry_freeze_days'), sql.indexOf('$$;', sql.indexOf('create function public.pantry_freeze_days')));
    const found = Object.fromEntries([...body.matchAll(/when '([a-z_]+)' then (\d+)/g)].map(([, kind, n]) => [kind, Number(n)]));
    expect(found).toEqual(DEFAULT_FREEZE_DAYS);
  });

  it('as origens da validade', () => {
    expect(sql).toContain(`check (expiry_source in (${EXPIRY_SOURCES.map((s) => `'${s}'`).join(', ')}))`);
    expect(sql).toContain(
      `check (fresh_expiry_source in (${EXPIRY_SOURCES.filter((s) => s !== 'congelado').map((s) => `'${s}'`).join(', ')}))`,
    );
  });

  it('os limites das datas são os do app', () => {
    const range = `between date '${APP_MIN_DATE}' and date '${APP_MAX_DATE}'`;
    expect(sql).toContain(`check (frozen_on ${range})`);
    expect(sql).toContain(`p_frozen_on not ${range}`);
    expect(sql).toContain(`p_thawed_on not ${range}`);
    expect(sql).toContain(`thawed_on between frozen_on and date '${APP_MAX_DATE}'`);
  });
});
