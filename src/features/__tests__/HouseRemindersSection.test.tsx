import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Switch } from 'react-native';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import { notify } from '@/ui/dialogs';

import { HouseRemindersSection } from '../HouseRemindersSection';

// A seção de verdade, com a opção "Alguém indo ao mercado" lida pelo caminho
// real (data/marketTrips); o que muda de um aparelho para outro vem de
// lib/reminders, trocado aqui. "mock" no nome: o jest.mock só enxerga
// variáveis assim.
const mockDevice: {
  reminders: boolean;
  tripPush: boolean;
  read: () => Promise<boolean>;
  set: jest.Mock<(enabled: boolean) => Promise<boolean>>;
} = { reminders: true, tripPush: true, read: async () => true, set: jest.fn(async () => true) };

jest.mock('@/lib/reminders', () => ({
  get remindersSupported() {
    return mockDevice.reminders;
  },
  get marketTripPushSupported() {
    return mockDevice.tripPush;
  },
  REMINDER_PLACE: 'neste navegador',
  PERMISSION_HINT: 'Permita as notificações do Kotii nas configurações do navegador.',
  remindersUnavailableReason: () => 'Este navegador não recebe notificações.',
  getHouseReminderKinds: async () => ({ bills: true, documents: false, chores: false, appointments: false, vaccines: false, weather: false }),
  setHouseReminderKind: async () => true,
  syncHouseReminders: async () => undefined,
  getMarketTripPush: () => mockDevice.read(),
  setMarketTripPush: (enabled: boolean) => mockDevice.set(enabled),
}));
jest.mock('@/features/useReminderSync', () => ({
  syncOtherHouses: async () => undefined,
  useHouseReminderData: () => ({ data: null }),
  useHouseReminderTarget: () => null,
}));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: undefined }) }));
jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (result: { data: unknown }) => result.data,
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
// As ilustrações usam o reanimated, que não roda aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const LABEL = 'Alguém indo ao mercado';
const HINT = 'Quando alguém da casa avisa que está saindo para as compras. Chega em até um minuto.';

/** Todos os textos da tela, na ordem. */
function textsOf(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node === null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textsOf);
  return (node.children ?? []).flatMap(textsOf);
}

let client: QueryClient;
let tree: ReactTestRenderer;

async function render() {
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <HouseRemindersSection />
      </QueryClientProvider>,
    );
  });
  // A leitura dos avisos ligados e a da opção terminam.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return textsOf(tree.toJSON());
}

const tripSwitch = () => tree.root.findAllByType(Switch).find((s) => s.props.accessibilityLabel === 'Avisos de alguém indo ao mercado');

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  Object.assign(mockDevice, { reminders: true, tripPush: true, read: async () => true });
  mockDevice.set = jest.fn(async () => true);
  jest.mocked(notify).mockClear();
});

afterEach(async () => {
  await act(async () => tree.unmount());
  client.clear();
});

describe('"Alguém indo ao mercado" nos avisos deste navegador', () => {
  it('no navegador que recebe avisos: aparece com os outros, com o texto de ajuda, ligado como está no servidor', async () => {
    const texts = await render();
    expect(texts).toContain('Avisos neste navegador');
    expect(texts).toContain('Contas a pagar');
    expect(texts).toContain(LABEL);
    expect(texts.join('')).toContain(HINT);
    // Depois dos avisos da casa, no mesmo cartão.
    expect(texts.indexOf(LABEL)).toBeGreaterThan(texts.indexOf('Dicas do clima'));
    expect(tripSwitch()?.props.value).toBe(true);
  });

  it('desligado no servidor (ou navegador ainda sem inscrição): aparece desligado', async () => {
    mockDevice.read = async () => false;
    const texts = await render();
    expect(texts).toContain(LABEL);
    expect(tripSwitch()?.props.value).toBe(false);
  });

  it('no celular não aparece (lá não há push remoto): só os avisos locais', async () => {
    mockDevice.tripPush = false;
    const texts = await render();
    expect(texts).toContain('Contas a pagar');
    expect(texts).not.toContain(LABEL);
    expect(tripSwitch()).toBeUndefined();
  });

  it('banco de antes da opção (a coluna não existe): escondida, sem erro na tela', async () => {
    mockDevice.read = async () => {
      throw { code: '42703', message: 'column push_subscriptions.market_trips does not exist' };
    };
    const texts = await render();
    expect(texts).toContain('Contas a pagar');
    expect(texts).not.toContain(LABEL);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sem conseguir ler (sem internet): não mostra a opção num estado que pode estar errado', async () => {
    mockDevice.read = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await render()).not.toContain(LABEL);
  });

  it('navegador sem avisos: a seção explica por quê e a opção não aparece', async () => {
    mockDevice.reminders = false;
    mockDevice.tripPush = false;
    const texts = await render();
    expect(texts).toContain('Este navegador não recebe notificações.');
    expect(texts).not.toContain(LABEL);
  });

  it('desligar e ligar passam pela inscrição deste navegador, e a chave acompanha', async () => {
    await render();
    mockDevice.read = async () => false;
    await act(async () => {
      tripSwitch()?.props.onValueChange(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockDevice.set).toHaveBeenCalledWith(false);
    expect(tripSwitch()?.props.value).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('ligar sem a permissão do navegador: a chave volta e a pessoa fica sabendo o que fazer', async () => {
    mockDevice.read = async () => false;
    mockDevice.set = jest.fn(async () => false);
    await render();
    await act(async () => {
      tripSwitch()?.props.onValueChange(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockDevice.set).toHaveBeenCalledWith(true);
    expect(tripSwitch()?.props.value).toBe(false);
    expect(notify).toHaveBeenCalledWith('Sem permissão', 'Para receber os avisos: permita as notificações do Kotii nas configurações do navegador.');
  });

  it('com o ligar ainda no ar, a chave fica parada no que foi escolhido e um segundo toque não muda nada', async () => {
    mockDevice.read = async () => false;
    let answer = (_ok: boolean) => undefined as void;
    mockDevice.set = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    await render();
    expect(tripSwitch()?.props.disabled).toBe(false);
    await act(async () => {
      tripSwitch()?.props.onValueChange(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tripSwitch()?.props.value).toBe(true);
    expect(tripSwitch()?.props.disabled).toBe(true);
    // Um toque que ainda chega (a chave desabilitada não o impede em todo lugar) é ignorado.
    await act(async () => {
      tripSwitch()?.props.onValueChange(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockDevice.set).toHaveBeenCalledTimes(1);
    expect(tripSwitch()?.props.value).toBe(true);
    // O servidor responde: a chave volta a funcionar, ligada.
    mockDevice.read = async () => true;
    await act(async () => {
      answer(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tripSwitch()?.props.disabled).toBe(false);
    expect(tripSwitch()?.props.value).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('dois toques no mesmo instante, antes de a tela se atualizar: só o primeiro vale', async () => {
    mockDevice.read = async () => false;
    let answer = (_ok: boolean) => undefined as void;
    mockDevice.set = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    await render();
    const before = tripSwitch();
    await act(async () => {
      before?.props.onValueChange(true);
      before?.props.onValueChange(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockDevice.set).toHaveBeenCalledTimes(1);
    expect(mockDevice.set).toHaveBeenCalledWith(true);
    mockDevice.read = async () => true;
    await act(async () => {
      answer(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tripSwitch()?.props.value).toBe(true);
  });
});
