import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Dimensions, Platform } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ConsultorScreen from '@/app/consultor';
import { REFRESH_LABEL } from '@/domain/desktop';

// O Consultor no computador: no navegador não se puxa a tela, e o "Atualizar" da barra dos bancos já faz o que o
// puxar faz (buscar os bancos de novo, à força). A tela não ganha o segundo "Atualizar" que o Screen desenha no
// computador para as telas que se puxam (ownRefreshButton). Os bancos de mentira: liberado, ainda carregando.

const mockSync = jest.fn();
jest.mock('@/data/financeBeta', () => ({
  useBeta: () => ({ data: true, isError: false }),
  useFinanceData: () => ({ status: 'loading' }),
  useSyncFinance: () => ({ mutate: mockSync, isPending: false, isError: false, data: undefined, variables: undefined }),
  useRepairSimilarMarks: () => undefined,
  useAddFinItem: () => ({ mutate: jest.fn(), isPending: false }),
  useRemoveFinConnection: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/NukeArt', () => ({ NukeAvatar: () => null }));

const WINDOW = Dimensions.get('window');
let renderer: ReactTestRenderer | undefined;

beforeEach(async () => {
  mockSync.mockClear();
  jest.replaceProperty(Platform, 'OS', 'web');
  await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440 } }));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  await act(async () => Dimensions.set({ window: WINDOW }));
  jest.restoreAllMocks();
});

const text = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(text).join(''));
/** Os botões de atualizar da tela: o redondo do Screen (pelo nome) e o da barra dos bancos (pelo título). */
const refreshButtons = () =>
  renderer!.root.findAll(
    (node) =>
      typeof node.props.onPress === 'function' &&
      typeof node.type !== 'string' &&
      (node.props.title === REFRESH_LABEL || (node.props.accessibilityLabel === REFRESH_LABEL && node.props.accessibilityRole === 'button')),
  );

describe('o Consultor no computador', () => {
  it('um "Atualizar" só, o da barra dos bancos, que busca os bancos de novo', async () => {
    await act(async () => {
      renderer = create(<ConsultorScreen />);
    });
    // Ao abrir, uma vez, sem forçar.
    expect(mockSync).toHaveBeenCalledWith({ force: false });
    const buttons = refreshButtons();
    expect(buttons.map((button) => button.props.title ?? button.props.accessibilityLabel)).toEqual([REFRESH_LABEL]);
    expect(buttons[0].props.title).toBe(REFRESH_LABEL);
    await act(async () => buttons[0].props.onPress());
    expect(mockSync).toHaveBeenLastCalledWith({ force: true }, expect.anything());
    expect(text(renderer!.root)).toContain('Carregando seus bancos…');
  });
});
