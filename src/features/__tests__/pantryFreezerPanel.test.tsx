import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { addDays, formatShortDate, todayISO } from '@/domain/dates';
import { DEFAULT_FREEZE_DAYS, FREEZER_NOT_READY, type FreezerRow } from '@/domain/freezer';
import { PantryPanel } from '@/features/PantryPanel';
import type { PantryItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Badge, ListRow, Section } from '@/ui/primitives';

// O congelador na despensa (Compras → Despensa): a seção "No congelador", o selo da validade estimada em cor
// neutra, e o menu do grupo com "Congelar" e "Descongelei", com os avisos de cada resposta.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockPantry: { rows: PantryItem[] } = { rows: [] };
const mockFreezer: { available: boolean | undefined } = { available: true };
const mockFreeze = jest.fn<(input: { ids: string[]; kind: string; frozenOn: string }) => Promise<FreezerRow[]>>();
const mockThaw = jest.fn<(input: { ids: string[]; thawedOn: string }) => Promise<FreezerRow[]>>();

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/home', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    usePantry: () => ({ data: mockPantry.rows, isPending: false, isError: false, error: null, refetch: jest.fn() }),
    useConsumePantryItems: mutation,
    useTakeOneFromPantry: mutation,
  };
});
jest.mock('@/data/freezer', () => {
  const { DEFAULT_FREEZE_DAYS: days } = jest.requireActual<typeof import('@/domain/freezer')>('@/domain/freezer');
  return {
    useFreezer: () => ({ available: mockFreezer.available, days: mockFreezer.available === true ? days : null }),
    useFreezePantryItems: () => ({ mutateAsync: mockFreeze, isPending: false }),
    useThawPantryItems: () => ({ mutateAsync: mockThaw, isPending: false }),
  };
});
jest.mock('@/data/market', () => ({
  useAddToPantryList: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useShoppingLists: () => ({ data: [] }),
  useProducts: () => ({ data: [] }),
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

const today = todayISO();
const day = (offset: number) => addDays(today, offset);
const short = (iso: string) => formatShortDate(iso, Number(today.slice(0, 4)));

const lot = (id: string, patch: Partial<PantryItem> = {}): PantryItem => ({
  id,
  product_id: 'p-frango',
  name: 'Frango',
  category: 'carnes',
  quantity: 1,
  unit: 'kg',
  purchased_on: day(-2),
  expires_on: day(1),
  expiry_source: 'categoria',
  consumed_at: null,
  frozen_on: null,
  thawed_on: null,
  freeze_kind: null,
  fresh_expires_on: null,
  fresh_expiry_source: null,
  ...patch,
});
const frozen = (id: string, patch: Partial<PantryItem> = {}) =>
  lot(id, {
    frozen_on: day(-10),
    freeze_kind: 'frango',
    expires_on: addDays(day(-10), DEFAULT_FREEZE_DAYS.frango),
    expiry_source: 'congelado',
    fresh_expires_on: day(-7),
    fresh_expiry_source: 'categoria',
    purchased_on: day(-10),
    ...patch,
  });

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  mockFreezer.available = true;
  mockFreeze.mockReset();
  mockThaw.mockReset();
  jest.mocked(notify).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function open(rows: PantryItem[]) {
  mockPantry.rows = rows;
  await act(async () => {
    renderer = create(<PantryPanel />);
  });
}
const rowsOf = (title: string): ReactTestInstance[] => renderer!.root.findAllByType(ListRow).filter((r) => r.props.title === title);
/** Os títulos das seções e as linhas de cada uma, na ordem da tela. */
const sections = () =>
  renderer!.root.findAllByType(Section).map((section) => [section.props.title, section.findAllByType(ListRow).map((r) => r.props.title)]);
/** O menu de uma linha (a de índice `at` com esse título). */
function sheetOf(title: string, at = 0): { actions: SheetAction[]; message?: string } {
  act(() => rowsOf(title)[at].props.onPress());
  const sheet = renderer!.root.findAllByType(ActionSheet)[0];
  return { actions: sheet.props.actions, message: sheet.props.message };
}
const labels = (actions: SheetAction[]) => actions.map((a) => a.label);

describe('a seção "No congelador"', () => {
  it('o congelado é outra linha, e fica no congelador também depois de vencer', async () => {
    await open([lot('fresco'), frozen('cong', { expires_on: day(-3) }), lot('arroz', { name: 'Arroz', product_id: null, category: 'graos', expires_on: day(-1), expiry_source: 'manual' })]);
    expect(sections()).toEqual([
      ['Vencidos (1)', ['Arroz']],
      ['Vencem em breve (1)', ['Frango']],
      ['No congelador (1)', ['Frango']],
    ]);
  });

  it('o selo: estimada neutra com "~" e "Validade estimada" para o leitor; a certa com a cor da seção', async () => {
    await open([
      lot('cat', { name: 'Coxa', product_id: 'p-coxa', expires_on: day(2), expiry_source: 'categoria' }),
      lot('man', { name: 'Picanha', product_id: 'p-pic', expires_on: day(2), expiry_source: 'manual' }),
      lot('pro', { name: 'Alcatra', product_id: 'p-alc', expires_on: day(-1), expiry_source: 'produto' }),
      lot('old', { name: 'Leite', product_id: 'p-leite', category: 'laticinios', expires_on: day(10), expiry_source: null }),
      frozen('cong', { name: 'Filé', product_id: 'p-file' }),
    ]);
    const badge = (title: string) => rowsOf(title)[0].findByType(Badge).props;
    expect(badge('Coxa')).toEqual({ label: '~ vence em 2 dias', tone: 'neutral' });
    expect(rowsOf('Coxa')[0].props.accessibilityLabel).toBe('Coxa, 1 kg, Validade estimada: vence em 2 dias');
    expect(badge('Picanha')).toEqual({ label: 'Vence em 2 dias', tone: 'warning' });
    expect(rowsOf('Picanha')[0].props.accessibilityLabel).toBe('Picanha, 1 kg, Validade: vence em 2 dias');
    expect(badge('Alcatra')).toEqual({ label: 'Venceu há 1 dia', tone: 'danger' });
    expect(badge('Leite')).toEqual({ label: 'Vence em 10 dias', tone: 'primary' });
    expect(badge('Filé').tone).toBe('neutral');
    expect(badge('Filé').label).toMatch(/^~ vence em \d+ dias$/);
  });

  it('a compra descongelada diz quando saiu, na linha e no menu', async () => {
    const thawed = lot('desc', { frozen_on: day(-10), thawed_on: day(-1), freeze_kind: 'frango', expiry_source: 'descongelado', purchased_on: day(-10) });
    await open([thawed]);
    expect(rowsOf('Frango')[0].props.subtitle).toBe(`1 kg · descongelado em ${short(day(-1))}`);
    expect(sheetOf('Frango').message).toBe(`Descongelado em ${short(day(-1))}.`);
    await act(async () => renderer?.unmount());
    await open([thawed, lot('fresco', { purchased_on: day(0), expires_on: day(3) })]);
    expect(sheetOf('Frango').message).toBe(
      `Compras: ${short(day(-10))} (1 kg, descongelado em ${short(day(-1))}) e ${short(day(0))} (1 kg).`,
    );
  });
});

describe('congelar pelo menu', () => {
  it('comprado antes de hoje: "Congelei hoje" e "Congelei no dia da compra", depois de "Usei 1" e antes de "Consumido"', async () => {
    await open([lot('a', { quantity: 2, unit: 'un' })]);
    const { actions } = sheetOf('Frango');
    const shown = labels(actions);
    expect(shown).toEqual(expect.arrayContaining(['Congelei hoje', `Congelei no dia da compra (${short(day(-2))})`]));
    expect(shown.indexOf('Usei 1 (fica 1 un)')).toBeLessThan(shown.indexOf('Congelei hoje'));
    expect(shown.indexOf(`Congelei no dia da compra (${short(day(-2))})`)).toBeLessThan(shown.indexOf('Consumido / descartado'));
    mockFreeze.mockResolvedValue([{ id: 'a', expiresOn: addDays(day(-2), 90), expirySource: 'congelado', frozenOn: day(-2) }]);
    await act(async () => actions.find((a) => a.label.startsWith('Congelei no dia da compra'))!.onPress());
    expect(mockFreeze).toHaveBeenCalledWith({ ids: ['a'], kind: 'frango', frozenOn: day(-2) });
    expect(notify).toHaveBeenCalledWith('No congelador', `Frango foi para o congelador. Validade estimada: ${short(addDays(day(-2), 90))}.`);
  });

  it('a descongelada: o dia em que saiu do congelador, nunca o da compra (o banco não congela antes dele)', async () => {
    await open([lot('desc', { frozen_on: day(-10), thawed_on: day(-1), freeze_kind: 'frango', expiry_source: 'descongelado', purchased_on: day(-10) })]);
    const { actions } = sheetOf('Frango');
    expect(labels(actions)).toEqual(expect.arrayContaining(['Congelei hoje', `Congelei no dia em que descongelou (${short(day(-1))})`]));
    expect(labels(actions).some((label) => label.startsWith('Congelei no dia da compra'))).toBe(false);
    mockFreeze.mockResolvedValue([{ id: 'desc', expiresOn: addDays(day(-1), 90), expirySource: 'congelado', frozenOn: day(-1) }]);
    await act(async () => actions.find((a) => a.label.startsWith('Congelei no dia em que descongelou'))!.onPress());
    expect(mockFreeze).toHaveBeenCalledWith({ ids: ['desc'], kind: 'frango', frozenOn: day(-1) });
  });

  it('comprado hoje: "Congelar"', async () => {
    await open([lot('a', { purchased_on: today })]);
    const { actions } = sheetOf('Frango');
    expect(labels(actions)).toContain('Congelar');
    expect(labels(actions)).not.toContain('Congelei hoje');
  });

  it('só com o congelador no banco, um tipo que congela e compras que trazem as colunas dele', async () => {
    // `available` em lista: um undefined passado direto daria o valor padrão.
    const without = (rows: PantryItem[], ...answer: [boolean | undefined] | []) => async () => {
      mockFreezer.available = answer.length ? answer[0] : true;
      await open(rows);
      const shown = labels(sheetOf(rows[0].name).actions);
      await act(async () => renderer?.unmount());
      return shown.some((label) => label.startsWith('Congel'));
    };
    expect(await without([lot('a')])()).toBe(true);
    expect(await without([lot('a', { name: 'Arroz', product_id: null, category: 'graos' })])()).toBe(false);
    expect(await without([lot('a')], false)()).toBe(false);
    expect(await without([lot('a')], undefined)()).toBe(false);
    // A cópia guardada de antes desta versão: sem as colunas.
    const old = lot('a');
    for (const column of ['frozen_on', 'thawed_on', 'freeze_kind', 'fresh_expires_on', 'fresh_expiry_source'] as const) delete old[column];
    expect(await without([old])()).toBe(false);
  });

  it('os avisos: a validade que ficou, parte, nenhuma e o erro', async () => {
    await open([lot('a'), lot('b', { purchased_on: day(-2) })]);
    const press = async (reply: () => Promise<FreezerRow[]>) => {
      mockFreeze.mockImplementationOnce(reply);
      jest.mocked(notify).mockClear();
      const { actions } = sheetOf('Frango');
      await act(async () => actions.find((a) => a.label.startsWith('Congelei hoje'))!.onPress());
      return jest.mocked(notify).mock.calls[0];
    };
    expect(await press(async () => [
      { id: 'a', expiresOn: day(-3), expirySource: 'categoria', frozenOn: today },
      { id: 'b', expiresOn: day(-3), expirySource: 'categoria', frozenOn: today },
    ])).toEqual([
      'No congelador',
      `Frango foi para o congelador, mas já tinha passado da validade (${short(day(-3))}), e ela fica como estava. Se congelou antes disso, corrija "Congelado em" no item.`,
    ]);
    expect(await press(async () => [{ id: 'a', expiresOn: day(88), expirySource: 'congelado', frozenOn: today }])).toEqual([
      'A despensa mudou',
      'Parte foi para o congelador; o resto mudou em outro aparelho. Confira a despensa.',
    ]);
    expect(await press(async () => [])).toEqual(['A despensa mudou', 'A despensa mudou enquanto isso. Confira e tente de novo.']);
    expect(await press(async () => Promise.reject(new Error('Sem internet agora.')))).toEqual(['Erro', 'Sem internet agora.']);
    expect(await press(async () => Promise.reject(new Error(FREEZER_NOT_READY)))).toEqual(['Erro', FREEZER_NOT_READY]);
  });
});

describe('descongelar pelo menu', () => {
  it('"Descongelei" no grupo do congelador, com o texto do que descongelar hoje faria', async () => {
    await open([frozen('c')]);
    const { actions, message } = sheetOf('Frango');
    expect(labels(actions)).toContain('Descongelei');
    expect(labels(actions).some((label) => label.startsWith('Congel'))).toBe(false);
    expect(message).toBe(`No congelador desde ${short(day(-10))}. Se descongelar hoje: vence por volta de ${short(day(3))}.`);
    mockThaw.mockResolvedValue([{ id: 'c', expiresOn: day(3), expirySource: 'descongelado', frozenOn: day(-10) }]);
    await act(async () => actions.find((a) => a.label === 'Descongelei')!.onPress());
    expect(mockThaw).toHaveBeenCalledWith({ ids: ['c'], thawedOn: today });
    expect(notify).toHaveBeenCalledWith(
      'Descongelado',
      `Frango saiu do congelador. A validade volta a contar de onde parou: vence por volta de ${short(day(3))}.`,
    );
  });

  it('também sem a resposta do banco (a linha já diz que está no congelador)', async () => {
    mockFreezer.available = undefined;
    await open([frozen('c')]);
    expect(labels(sheetOf('Frango').actions)).toContain('Descongelei');
  });

  it('o congelado hoje desfaz, e o que já tinha passado continua vencido', async () => {
    await open([frozen('c', { frozen_on: today, purchased_on: today, expires_on: addDays(today, 90), fresh_expires_on: day(3) })]);
    expect(sheetOf('Frango').message).toBe(`No congelador desde ${short(today)}. Se descongelar hoje, volta para a validade de antes.`);
    await act(async () => renderer?.unmount());
    await open([frozen('c', { fresh_expires_on: day(-12), expires_on: day(-12), expiry_source: 'categoria' })]);
    expect(sheetOf('Frango').message).toBe(`No congelador desde ${short(day(-10))}. Se descongelar hoje, a validade já tinha passado (${short(day(-2))}).`);
  });
});
