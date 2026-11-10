import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create } from 'react-test-renderer';

import { FEEDBACK_LIMIT, FEEDBACK_SENT } from '@/domain/appFeedback';
import { NUKE_ACTION_UNAVAILABLE, type NukeAction } from '@/domain/nuke';
import { FEATURES } from '@/lib/features';

import { useAskNuke, useRunNukeAction } from '../nuke';

// O recado que o Nuke sugere só sai pelo toque em "Enviar": a ação manda exatamente o tipo e o texto do cartão
// (sendAppFeedback) e devolve a frase de enviado; a recusa sobe para a tela mostrar.

const mockSend = jest.fn(async (_input: { kind: string; message: string }): Promise<string> => 'id-1');
jest.mock('@/data/appFeedback', () => ({ sendAppFeedback: (input: { kind: string; message: string }) => mockSend(input) }));
// As outras ações e o retrato da casa não entram aqui.
jest.mock('@/data/market', () => ({ useAddToMarketList: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/data/home', () => ({ useSaveChore: () => ({ mutateAsync: jest.fn() }) }));
const mockSaveExpense = jest.fn(async (_input: unknown) => undefined);
jest.mock('@/data/finance', () => ({ useSaveExpense: () => ({ mutateAsync: (input: unknown) => mockSaveExpense(input) }) }));
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

afterEach(() => {
  // A chave de Finanças ligada num teste não passa para o seguinte, mesmo quando ele falha no meio.
  jest.restoreAllMocks();
  jest.mocked(router.navigate).mockClear();
  jest.mocked(router.back).mockClear();
  mockSaveExpense.mockClear();
});

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
  function asker() {
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
    return ask!;
  }
  const input = { messages: [{ role: 'user' as const, text: 'O app trava na lista.' }], context: '', today: '2026-10-24' };

  it('diz que este app mostra o cartão do recado: sem isso a função nunca oferece o recado', async () => {
    const ask = asker();
    await act(async () => {
      await ask.mutateAsync(input);
    });
    expect(mockInvoke).toHaveBeenCalledWith('nuke', { body: { ...input, features: ['send_feedback'] } });
  });

  describe('as ações de Finanças, que a função continua sugerindo', () => {
    const actions = [
      { type: 'add_expense', label: 'Registrar', description: 'Feira', amount: 42.5, category: 'mercado', spent_on: '2026-10-24' },
      { type: 'open_screen', label: 'Ver as contas', screen: 'contas' },
      { type: 'open_screen', label: 'Ver a despensa', screen: 'despensa' },
    ];
    const answerTypes = async () => {
      mockInvoke.mockResolvedValueOnce({ data: { reply: 'Pronto.', actions }, error: null } as never);
      const ask = asker();
      let answer: Awaited<ReturnType<typeof ask.mutateAsync>> | undefined;
      await act(async () => {
        answer = await ask.mutateAsync(input);
      });
      return answer!.actions.map((a) => (a.type === 'open_screen' ? a.screen : a.type));
    };

    it('com Finanças desligada (lib/features), ficam de fora da resposta', async () => {
      expect(await answerTypes()).toEqual(['despensa']);
    });

    it('com ela ligada, vêm', async () => {
      jest.replaceProperty(FEATURES, 'finance', true);
      expect(await answerTypes()).toEqual(['add_expense', 'contas', 'despensa']);
    });
  });
});

describe('as ações de Finanças guardadas na conversa (de antes da chave)', () => {
  const expense: NukeAction = { type: 'add_expense', label: 'Registrar', description: 'Feira', amount: 42.5, category: 'mercado', spent_on: '2026-10-24' };

  it('com Finanças desligada (lib/features), a execução recusa: nada vai para os gastos, e nenhuma tela de Finanças se abre', async () => {
    await expect(runner()(expense)).rejects.toThrow(NUKE_ACTION_UNAVAILABLE);
    expect(mockSaveExpense).not.toHaveBeenCalled();
    for (const screen of ['contas', 'financas'] as const) {
      await expect(runner()({ type: 'open_screen', label: 'Ver', screen })).rejects.toThrow(NUKE_ACTION_UNAVAILABLE);
    }
    // Nem fecha a conversa: a pessoa fica onde estava, com o aviso.
    expect(router.back).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('com ela ligada, o gasto é lançado como antes', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await expect(runner()(expense)).resolves.toBe('Gasto registrado.');
    expect(mockSaveExpense).toHaveBeenCalledWith({
      values: { description: 'Feira', amount: 42.5, spent_on: '2026-10-24', category: 'mercado', notes: null },
    });
  });
});

describe('"Ver notas" do Nuke', () => {
  const notas: NukeAction = { type: 'open_screen', label: 'Ver notas', screen: 'notas' };

  it('com Finanças desligada (lib/features), abre o Mercado do mês: as notas de Finanças não existem', async () => {
    await runner()(notas);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/mercado');
  });

  it('com ela ligada, abre Finanças → Notas', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await runner()(notas);
    expect(router.navigate).toHaveBeenCalledWith({ pathname: '/financas', params: { aba: 'notas' } });
  });
});
