import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import PantryItemScreen from '@/app/despensa/[id]';
import { addDays, formatBRDate, formatShortDate, todayISO } from '@/domain/dates';
import type { ThawedRow } from '@/domain/freezer';
import type { PantryValues, SavePantryInput } from '@/data/home';
import { closeWindow } from '@/lib/navigation';
import type { PantryItem } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Chip, TextField } from '@/ui/primitives';

// O formulário de uma compra da despensa com o congelador: "Congelei" e "Congelado em", a validade do congelador
// que segue o dia, a data digitada antes ou depois de ligar "Congelei", "Descongelei" (perguntando antes quando há
// o que perder) e a compra que mudou em outro aparelho. "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockState: { id: string; item: PantryItem | undefined; available: boolean | undefined; rows: unknown[] } = {
  id: 'novo',
  item: undefined,
  available: true,
  rows: [{ id: 'x' }],
};
const mockSave = jest.fn<(input: SavePantryInput) => void>();
const mockThaw = jest.fn<(input: { ids: string[]; thawedOn: string }) => Promise<ThawedRow[]>>();

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: mockState.id }) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/lib/navigation', () => ({ closeWindow: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/data/home', () => ({
  usePantryItem: () => ({ data: mockState.item, isPending: false, isError: false, error: null }),
  useSavePantryItem: () => ({
    isPending: false,
    mutate: (input: SavePantryInput, callbacks: { onSuccess: (rows: unknown[]) => void }) => {
      mockSave(input);
      callbacks.onSuccess(mockState.rows);
    },
  }),
}));
jest.mock('@/data/freezer', () => {
  const { DEFAULT_FREEZE_DAYS } = jest.requireActual<typeof import('@/domain/freezer')>('@/domain/freezer');
  return {
    useFreezer: () => ({ available: mockState.available, days: mockState.available === true ? DEFAULT_FREEZE_DAYS : null }),
    useThawPantryItems: () => ({ mutateAsync: mockThaw, isPending: false }),
  };
});

const today = todayISO();
const day = (offset: number) => addDays(today, offset);
const br = (offset: number) => formatBRDate(day(offset));
const short = (iso: string) => formatShortDate(iso, Number(today.slice(0, 4)));

const stored = (patch: Partial<PantryItem> = {}): PantryItem => ({
  id: 'a',
  product_id: 'p1',
  name: 'Picanha',
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
const inFreezer = (patch: Partial<PantryItem> = {}) =>
  stored({
    frozen_on: day(-2),
    freeze_kind: 'carne',
    expires_on: addDays(day(-2), 90),
    expiry_source: 'congelado',
    fresh_expires_on: day(1),
    fresh_expiry_source: 'categoria',
    ...patch,
  });

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  mockState.id = 'novo';
  mockState.item = undefined;
  mockState.available = true;
  mockState.rows = [{ id: 'x' }];
  mockSave.mockReset();
  mockThaw.mockReset();
  jest.mocked(notify).mockClear();
  jest.mocked(confirmAction).mockReset();
  jest.mocked(closeWindow).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function open(item?: PantryItem) {
  mockState.item = item;
  mockState.id = item ? item.id : 'novo';
  await act(async () => {
    renderer = create(<PantryItemScreen />);
  });
}
const field = (label: string) => renderer!.root.findAllByType(TextField).find((f) => f.props.label === label);
const chip = (label: string) => renderer!.root.findAllByType(Chip).find((c) => c.props.label === label);
const button = (title: string) => renderer!.root.findAllByType(Button).find((b) => b.props.title === title);
const type = (label: string, text: string) => act(() => field(label)!.props.onChangeText(text));
const tap = async (node: ReactTestInstance | undefined) => {
  if (!node) throw new Error('não está na tela');
  await act(async () => node.props.onPress());
};
const saved = (): PantryValues => mockSave.mock.calls.at(-1)![0].values;

describe('"Congelei" num item fora do congelador', () => {
  it('o item novo de carne: o chip, "Congelado em" (o dia da compra) e a validade do congelador', async () => {
    await open();
    await type('Item', 'Picanha');
    await type('Comprado em', br(-1));
    expect(chip('Congelei')).toBeDefined();
    expect(field('Congelado em')).toBeUndefined();
    await tap(chip('Congelei'));
    expect(field('Congelado em')!.props.value).toBe(br(-1));
    expect(field('Validade')!.props.value).toBe(formatBRDate(addDays(day(-1), 90)));
    expect(field('Validade')!.props.hint).toBe(
      'Estimada pelo congelador: 90 dias para carne bovina e suína, contados de quando foi congelado. Se corrigir, fica só neste item.',
    );
    // O dia muda, a validade segue.
    await type('Congelado em', br(0));
    expect(field('Validade')!.props.value).toBe(formatBRDate(addDays(today, 90)));
    await tap(button('Salvar'));
    expect(saved()).toEqual(
      expect.objectContaining({
        expires_on: addDays(today, 90),
        expiry_source: 'congelado',
        frozen_on: today,
        thawed_on: null,
        freeze_kind: 'carne',
        fresh_expires_on: addDays(day(-1), 3),
        fresh_expiry_source: 'categoria',
      }),
    );
    expect(closeWindow).toHaveBeenCalledWith('despensa/[id]');
  });

  it('a data digitada antes de ligar vira a de antes do congelador; desligar a devolve ao campo', async () => {
    await open(stored());
    await type('Validade', br(5));
    await tap(chip('Congelei'));
    expect(field('Validade')!.props.value).toBe(formatBRDate(addDays(today, 90)));
    await tap(chip('Congelei'));
    expect(field('Validade')!.props.value).toBe(br(5));
    await tap(chip('Congelei'));
    await tap(button('Salvar'));
    expect(saved()).toEqual(
      expect.objectContaining({ expiry_source: 'congelado', fresh_expires_on: day(5), fresh_expiry_source: 'manual', frozen_on: today }),
    );
  });

  it('a data digitada com "Congelei" ligado é a do congelador (manual), e sai ao desligar', async () => {
    await open(stored());
    await tap(chip('Congelei'));
    await type('Validade', br(40));
    expect(field('Validade')!.props.hint).toBe('Este item já foi congelado: se corrigir a validade, ela fica só nele.');
    await tap(button('Salvar'));
    expect(saved()).toEqual(expect.objectContaining({ expires_on: day(40), expiry_source: 'manual', fresh_expires_on: day(1), fresh_expiry_source: 'categoria' }));
    await tap(chip('Congelei'));
    expect(field('Validade')!.props.value).toBe(br(1));
  });

  it('o nome que deixa de congelar tira o chip e a escolha', async () => {
    await open(stored());
    await tap(chip('Congelei'));
    await type('Item', 'Bolo de cenoura');
    expect(chip('Congelei')).toBeUndefined();
    expect(field('Congelado em')).toBeUndefined();
    await tap(button('Salvar'));
    expect(saved().frozen_on).toBeUndefined();
  });

  it('"Congelado em" fora de [compra, hoje] não salva', async () => {
    await open(stored());
    await tap(chip('Congelei'));
    await type('Congelado em', br(-5));
    await tap(button('Salvar'));
    expect(notify).toHaveBeenCalledWith(
      'Data inválida',
      'Confira a data em que foi congelado (dd/mm/aaaa): não pode ser antes da compra nem depois de hoje.',
    );
    await type('Congelado em', br(1));
    await tap(button('Salvar'));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('sem o congelador no banco, ou com a cópia de antes desta versão, nada do congelador', async () => {
    mockState.available = false;
    await open(stored());
    expect(chip('Congelei')).toBeUndefined();
    await tap(button('Salvar'));
    expect(Object.keys(saved())).toEqual(['name', 'category', 'quantity', 'unit', 'purchased_on', 'expires_on', 'expiry_source']);
    expect(mockSave.mock.calls[0][0]).toEqual(expect.objectContaining({ freezerAvailable: false }));
    await act(async () => renderer?.unmount());
    mockState.available = true;
    const old = stored();
    for (const column of ['frozen_on', 'thawed_on', 'freeze_kind', 'fresh_expires_on', 'fresh_expiry_source'] as const) delete old[column];
    await open(old);
    expect(chip('Congelei')).toBeUndefined();
  });
});

describe('o item no congelador', () => {
  it('diz desde quando, mostra "Congelado em" e a validade segue o dia; o tipo fica numa edição da quantidade', async () => {
    await open(inFreezer());
    expect(JSON.stringify(renderer!.toJSON())).toContain(`No congelador desde ${short(day(-2))}.`);
    expect(field('Congelado em')!.props.value).toBe(br(-2));
    expect(field('Validade')!.props.value).toBe(formatBRDate(addDays(day(-2), 90)));
    await type('Quantidade', '2');
    await type('Congelado em', br(-1));
    expect(field('Validade')!.props.value).toBe(formatBRDate(addDays(day(-1), 90)));
    await tap(button('Salvar'));
    expect(saved()).toEqual(expect.objectContaining({ quantity: 2, frozen_on: day(-1), freeze_kind: 'carne', expiry_source: 'congelado' }));
    expect(saved()).not.toHaveProperty('fresh_expires_on');
    expect(mockSave.mock.calls[0][0].copy).toEqual(expect.objectContaining({ frozen_on: day(-2), thawed_on: null }));
  });

  it('o tipo guardado fica numa edição da quantidade, também quando o nome leria outro; muda só com o nome ou a categoria', async () => {
    // Congelado pela nota como frango ("FILE PEITO FGO SADIA"), e na despensa com o nome "Filé de peito", que sozinho
    // leria carne: salvar a quantidade não pode trocar o tipo (o banco refaria a validade pelo tempo de outro tipo).
    const peito = () => inFreezer({ name: 'Filé de peito', freeze_kind: 'frango' });
    await open(peito());
    await type('Quantidade', '2');
    await tap(button('Salvar'));
    expect(saved()).toEqual(expect.objectContaining({ quantity: 2, freeze_kind: 'frango', expiry_source: 'congelado' }));
    await act(async () => renderer?.unmount());
    // O nome mudou nesta tela: o tipo é o do nome novo.
    mockSave.mockReset();
    await open(peito());
    await type('Item', 'Patinho moído');
    await tap(button('Salvar'));
    expect(saved()).toEqual(expect.objectContaining({ name: 'Patinho moído', freeze_kind: 'carne_moida' }));
  });

  it('"Descongelei" sem nada mudado descongela hoje, avisa e fecha', async () => {
    await open(inFreezer());
    expect(JSON.stringify(renderer!.toJSON())).toContain(`Se descongelar hoje: vence por volta de ${short(day(3))}.`);
    mockThaw.mockResolvedValue([{ id: 'a', expiresOn: day(3), expirySource: 'descongelado', frozenOn: day(-2), undone: false }]);
    await tap(button('Descongelei'));
    expect(mockThaw).toHaveBeenCalledWith({ ids: ['a'], thawedOn: today });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'Descongelado',
      `Picanha saiu do congelador. A validade volta a contar de onde parou: vence por volta de ${short(day(3))}.`,
    );
    expect(closeWindow).toHaveBeenCalledWith('despensa/[id]');
  });

  it('"Descongelei" na descongelada que voltou hoje ao congelador: o aviso de desfazer, como a prévia', async () => {
    // Descongelada ontem com a validade digitada (manual), de novo no congelador hoje.
    await open(inFreezer({ frozen_on: today, thawed_on: null, fresh_expires_on: day(2), fresh_expiry_source: 'manual', expires_on: addDays(today, 90) }));
    expect(JSON.stringify(renderer!.toJSON())).toContain('Se descongelar hoje, volta para a validade de antes.');
    mockThaw.mockResolvedValue([{ id: 'a', expiresOn: day(2), expirySource: 'manual', frozenOn: day(-2), undone: true }]);
    await tap(button('Descongelei'));
    expect(notify).toHaveBeenCalledWith('Descongelado', 'Picanha saiu do congelador, com a validade de antes.');
  });

  it('"Descongelei" com algo mudado pergunta antes', async () => {
    await open(inFreezer());
    await type('Quantidade', '3');
    await tap(button('Descongelei'));
    expect(confirmAction).toHaveBeenCalledWith(
      'Descongelar agora?',
      'O que você mudou neste item e ainda não salvou vai se perder.',
      'Descongelar',
      expect.any(Function),
      false,
    );
    expect(mockThaw).not.toHaveBeenCalled();
  });

  it('a compra descongelada diz quando saiu, e corrigir a validade não ensina (o texto diz)', async () => {
    await open(stored({ frozen_on: day(-10), thawed_on: day(-1), freeze_kind: 'carne', expiry_source: 'descongelado' }));
    expect(JSON.stringify(renderer!.toJSON())).toContain(`Descongelado em ${short(day(-1))}.`);
    expect(field('Validade')!.props.hint).toBe('Este item já foi congelado: se corrigir a validade, ela fica só nele.');
    // Congelar de novo: "Congelado em" nunca antes do dia em que saiu.
    await tap(chip('Congelei'));
    expect(field('Congelado em')!.props.value).toBe(br(0));
    await type('Congelado em', br(-2));
    await tap(button('Salvar'));
    expect(notify).toHaveBeenCalledWith('Data inválida', expect.stringContaining('não pode ser antes da compra'));
  });
});

describe('a compra mudou em outro aparelho', () => {
  it('nada gravado: diz que mudou e fica aberta', async () => {
    mockState.rows = [];
    await open(stored());
    await tap(button('Salvar'));
    expect(notify).toHaveBeenCalledWith('A despensa mudou', 'Este item da despensa mudou em outro aparelho e nada foi salvo. Abra de novo e confira.');
    expect(closeWindow).not.toHaveBeenCalled();
  });
});
