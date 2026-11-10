import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import NukeScreen from '@/app/nuke';
import type { NukeAction, NukeMessage } from '@/domain/nuke';
import { FEATURES } from '@/lib/features';
import { Button } from '@/ui/primitives';

// A conversa com o Nuke guardada no aparelho volta com as ações como foram sugeridas, também as de antes da chave
// de Finanças (lib/features): um "Registrar" de um gasto, um "Ver as contas". A tela de verdade, com a conversa e as
// buscas trocadas por respostas prontas: sem Finanças, essas ações não ganham botão (as outras, sim), e com ela
// ligada voltam como estavam.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockState = { messages: [] as NukeMessage[], ran: [] as NukeAction[] };

jest.mock('@/data/nuke', () => ({
  useAskNuke: () => ({ mutateAsync: jest.fn() }),
  useNukeContext: () => ({ status: 'ready', context: 'A casa.' }),
  useRunNukeAction: () => async (action: NukeAction) => {
    mockState.ran.push(action);
    return '';
  },
}));
jest.mock('@/features/nuke/conversation', () => ({
  clearConversation: jest.fn(),
  conversationEpoch: () => 0,
  conversationOwner: (userId: string, householdId: string) => `${userId}:${householdId}`,
  newMessageId: () => 'nova',
  setPending: jest.fn(),
  updateConversation: jest.fn(),
  useNukeConversation: () => ({ messages: mockState.messages, pending: false }),
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'ana' } } }),
  useHousehold: () => ({ data: { household: { id: 'h1', name: 'Casa' }, me: { display_name: 'Ana' } } }),
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
jest.mock('@/ui/NukeArt', () => ({ NukeAvatar: () => null }));

/** Uma resposta do Nuke de antes da chave, guardada no aparelho com as ações que ela trouxe. */
const STORED: NukeMessage[] = [
  { id: 'q', role: 'user', text: 'Gastei 42,50 na feira. E as contas?' },
  {
    id: 'r',
    role: 'assistant',
    text: 'Posso anotar o gasto e abrir as contas.',
    actions: [
      { type: 'add_expense', label: 'Registrar o gasto da feira', description: 'Feira', amount: 42.5, category: 'mercado', spent_on: '2026-10-24' },
      { type: 'open_screen', label: 'Ver as contas', screen: 'contas' },
      { type: 'open_screen', label: 'Ver Finanças', screen: 'financas' },
      { type: 'create_chore', label: 'Criar a tarefa', title: 'Trocar o filtro', due_on: '2026-10-30', recurrence: 'monthly' },
      { type: 'open_screen', label: 'Ver a despensa', screen: 'despensa' },
    ],
  },
];

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => renderer!.root.findAllByType(RNText).map(rawText);
const buttons = () => renderer!.root.findAllByType(Button);

async function mount() {
  await act(async () => {
    renderer = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <NukeScreen />
      </SafeAreaProvider>,
    );
  });
}

beforeEach(() => {
  mockState.messages = STORED;
  mockState.ran = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

describe('as ações guardadas na conversa e a chave de Finanças (lib/features)', () => {
  it('desligada: o gasto e as telas de Finanças não ganham botão; as outras ações ficam, e o toque faz a ação certa', async () => {
    await mount();
    const texts = page();
    expect(texts).toContain('Posso anotar o gasto e abrir as contas.');
    expect(texts).not.toContain('Registrar o gasto da feira');
    expect(texts).not.toContain('Ver as contas');
    expect(texts).not.toContain('Ver Finanças');
    expect(texts).toEqual(expect.arrayContaining(['Criar a tarefa', 'Ver a despensa']));
    // Um botão por ação que ficou: "Fazer" da tarefa e "Abrir" da despensa.
    expect(buttons().map((button) => button.props.title)).toEqual(['Fazer', 'Abrir']);
    // O índice continua o da mensagem guardada: o toque em "Abrir" é o da despensa, não o da terceira ação.
    await act(async () => buttons()[1].props.onPress());
    expect(mockState.ran).toEqual([{ type: 'open_screen', label: 'Ver a despensa', screen: 'despensa' }]);
  });

  it('ligada: as mesmas ações voltam como estavam', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await mount();
    expect(page()).toEqual(expect.arrayContaining(['Registrar o gasto da feira', 'Ver as contas', 'Ver Finanças', 'Criar a tarefa', 'Ver a despensa']));
    expect(buttons().map((button) => button.props.title)).toEqual(['Fazer', 'Abrir', 'Abrir', 'Fazer', 'Abrir']);
  });
});
