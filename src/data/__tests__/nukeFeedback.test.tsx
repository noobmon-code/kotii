import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import { FEEDBACK_LIMIT, FEEDBACK_SENT } from '@/domain/appFeedback';
import type { NukeAction } from '@/domain/nuke';

import { useAskNuke, useRunNukeAction } from '../nuke';

// O recado que o Nuke sugere só sai pelo toque em "Enviar": a ação manda exatamente o tipo e o texto do cartão
// (sendAppFeedback) e devolve a frase de enviado; a recusa sobe para a tela mostrar.

const mockSend = jest.fn(async (_input: { kind: string; message: string }): Promise<string> => 'id-1');
jest.mock('@/data/appFeedback', () => ({ sendAppFeedback: (input: { kind: string; message: string }) => mockSend(input) }));
// As outras ações e o retrato da casa não entram aqui.
jest.mock('@/data/market', () => ({ useAddToMarketList: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/data/home', () => ({ useSaveChore: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/data/finance', () => ({ useSaveExpense: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/data/family', () => ({}));
jest.mock('@/data/house', () => ({}));
jest.mock('@/data/health', () => ({}));
jest.mock('@/data/menu', () => ({}));
jest.mock('@/data/supplies', () => ({}));
jest.mock('@/data/images', () => ({}));
jest.mock('@/lib/auth', () => ({}));
const mockInvoke = jest.fn(async (_name: string, _options: { body: Record<string, unknown> }) => ({
  data: { reply: 'Posso mandar isto:', actions: [] },
  error: null,
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => mockInvoke(name, options) } },
}));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), navigate: jest.fn() } }));

function runner() {
  let run: ((action: NukeAction) => Promise<string>) | undefined;
  function Probe() {
    run = useRunNukeAction();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return run!;
}

describe('o recado pelo Nuke', () => {
  const action: NukeAction = { type: 'send_feedback', label: 'Mandar recado', kind: 'problema', text: 'A lista não abre no navegador.' };

  it('manda o tipo e o texto do cartão e diz que foi', async () => {
    await expect(runner()(action)).resolves.toBe(FEEDBACK_SENT);
    expect(mockSend).toHaveBeenCalledWith({ kind: 'problema', message: 'A lista não abre no navegador.' });
  });

  it('a recusa sobe como veio', async () => {
    mockSend.mockRejectedValueOnce(new Error(FEEDBACK_LIMIT));
    await expect(runner()(action)).rejects.toThrow(FEEDBACK_LIMIT);
  });
});

describe('a pergunta ao Nuke', () => {
  it('diz que este app mostra o cartão do recado: sem isso a função nunca oferece o recado', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let ask: ReturnType<typeof useAskNuke> | undefined;
    function Probe() {
      ask = useAskNuke();
      return null;
    }
    act(() => {
      create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    const input = { messages: [{ role: 'user' as const, text: 'O app trava na lista.' }], context: '', today: '2026-10-24' };
    await act(async () => {
      await ask!.mutateAsync(input);
    });
    expect(mockInvoke).toHaveBeenCalledWith('nuke', { body: { ...input, features: ['send_feedback'] } });
  });
});
