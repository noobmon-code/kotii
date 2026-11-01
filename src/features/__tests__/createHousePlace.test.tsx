import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { AccessibilityInfo } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import WelcomeScreen from '@/app/bem-vindo';
import HouseholdsScreen from '@/app/casas';
import type { HouseholdLocation } from '@/data/weather';
import {
  CEP_INCOMPLETE_TITLE,
  CEP_LOOKUP_FAILED_TITLE,
  cepIncompleteOnCreate,
  cepLookupFailedMessage,
  HOUSE_PLACE_OPTIONAL,
  HOUSE_PLACE_PRIVACY,
  HOUSE_PLACE_REMOVE,
  PLACE_NOT_SAVED_OFFLINE,
  PLACE_NOT_SAVED_TITLE,
  placeFoundAnnouncement,
  placeNotSavedMessage,
} from '@/domain/housePlace';
import { notify } from '@/ui/dialogs';

// Criar uma casa (bem-vindo e Suas casas) com a parte opcional "Onde fica a casa": sem o bairro, como antes; com o
// bairro achado, ele vai para a casa nova (pelo id dela), uma casa só; o CEP digitado e não buscado é buscado antes
// e, se não for achado, nada é criado; o bairro que não foi salvo não desfaz a casa, e a pessoa fica sabendo.
// Entrar com um código não pergunta o lugar.

const PINHEIROS: HouseholdLocation = { label: 'Pinheiros, São Paulo', latitude: -23.56, longitude: -46.69, source: 'cep' };
const PERTO: HouseholdLocation = { label: 'Vila Madalena, São Paulo', latitude: -23.55, longitude: -46.69, source: 'gps' };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockWeather = {
  findPlaceByCep: jest.fn(async (_cep: string): Promise<HouseholdLocation> => PINHEIROS),
  findPlaceByDevice: jest.fn(async (): Promise<HouseholdLocation> => PERTO),
  saveHouseholdLocationFor: jest.fn(async (_householdId: string, _place: HouseholdLocation): Promise<void> => undefined),
};
jest.mock('@/data/weather', () => ({
  LOCATION_KEY: ['householdLocation'],
  findPlaceByCep: (cep: string) => mockWeather.findPlaceByCep(cep),
  findPlaceByDevice: () => mockWeather.findPlaceByDevice(),
  saveHouseholdLocationFor: (id: string, place: HouseholdLocation) => mockWeather.saveHouseholdLocationFor(id, place),
}));

/** O banco: create_household devolve a casa nova; join_household, a casa do código. */
const mockRpc = jest.fn(async (name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({
  data: { id: name === 'create_household' ? 'nova' : 'dela', name: 'Casa' },
  error: null,
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args) },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
const mockOpened: string[] = [];
jest.mock('@/lib/activeHousehold', () => ({
  setActiveHousehold: async (_userId: string, id: string) => {
    mockOpened.push(id);
  },
}));
// O que data/household traz e não entra aqui (fila da lista, fotos, Nuke, lembretes).
jest.mock('@/data/images', () => ({ functionErrorMessage: async () => 'erro' }));
jest.mock('@/data/listPhotos', () => ({ photoQueueBusy: () => false, waitingCounts: () => ({}) }));
jest.mock('@/data/market', () => ({ listQueueBusy: () => false }));
jest.mock('@/features/nuke/conversation', () => ({ clearConversation: jest.fn(), conversationOwner: jest.fn() }));
jest.mock('@/lib/pendingReceipts', () => ({ forgetPendingReceiptsOf: jest.fn() }));
jest.mock('@/lib/queryClient', () => ({ saveNow: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ disableHouseholdReminders: jest.fn() }));
jest.mock('@/lib/auth', () => {
  const me = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' };
  const household = { id: 'h1', name: 'Casa da Ana', invite_code: 'ABC234', created_by: 'ana' };
  return {
    signOut: jest.fn(),
    useAuth: () => ({ session: { user: { id: 'ana' } } }),
    useHousehold: () => ({ data: { household, members: [me], me, households: [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }] } }),
  };
});
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => rawText(renderer!.root);

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount(screen: React.ReactElement) {
  await act(async () => {
    renderer = create(<QueryClientProvider client={queryClient}>{screen}</QueryClientProvider>);
  });
  await settle();
}

const field = (label: string) =>
  renderer!.root.findAll((node) => node.props.label === label && typeof node.props.onChangeText === 'function')[0];
const type = async (label: string, text: string) => {
  await act(async () => field(label).props.onChangeText(text));
};
const button = (title: string) =>
  renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function')[0];
const press = async (title: string) => {
  await act(async () => button(title).props.onPress());
  await settle();
};
const creates = () => mockRpc.mock.calls.filter(([name]) => name === 'create_household');
/** O seletor criar / entrar. */
const segmented = () =>
  renderer!.root.findAll((node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function')[0];

/** Uma busca de CEP que só responde quando o teste manda. */
function pendingCep() {
  let answer: (place: HouseholdLocation) => void = () => undefined;
  mockWeather.findPlaceByCep.mockImplementation(
    () =>
      new Promise<HouseholdLocation>((resolve) => {
        answer = resolve;
      }),
  );
  return (place: HouseholdLocation) => answer(place);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpened.length = 0;
  mockWeather.findPlaceByCep.mockImplementation(async () => PINHEIROS);
  mockWeather.findPlaceByDevice.mockImplementation(async () => PERTO);
  mockWeather.saveHouseholdLocationFor.mockImplementation(async () => undefined);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
});

describe('bem-vindo: criar a casa', () => {
  async function fill() {
    await mount(<WelcomeScreen />);
    await type('Seu nome', 'Ana');
    await type('Nome da casa', 'Casa da Ana');
  }

  it('a parte "Onde fica a casa" é opcional e diz o que fica guardado; sem ela, cria a casa como antes', async () => {
    await fill();
    expect(page()).toContain('Onde fica a casa (opcional)');
    expect(page()).toContain(HOUSE_PLACE_PRIVACY);
    expect(page()).toContain(HOUSE_PLACE_OPTIONAL);
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.findPlaceByCep).not.toHaveBeenCalled();
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('com o bairro achado pelo CEP: mostra o lugar, cria uma casa e salva o lugar nela, antes de buscar a casa de novo', async () => {
    await fill();
    await type('CEP', '05422030');
    expect(field('CEP').props.value).toBe('05422-030');
    await press('Buscar pelo CEP');
    expect(mockWeather.findPlaceByCep).toHaveBeenCalledWith('05422030');
    // Achado: o nome e como foi achado, com o campo para mudar e o "Tirar".
    expect(page()).toContain('Pinheiros, São PauloPelo CEP');
    expect(field('Mudar pelo CEP').props.value).toBe('');
    expect(button(HOUSE_PLACE_REMOVE)).toBeDefined();
    // O leitor de tela ouve o lugar achado; a busca é opcional, então o botão cheio é o de criar.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(placeFoundAnnouncement('Pinheiros, São Paulo'));
    expect(button('Buscar pelo CEP').props.variant).toBe('secondary');
    expect(button('Criar casa').props.variant).toBeUndefined();
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();

    const order: string[] = [];
    mockWeather.saveHouseholdLocationFor.mockImplementation(async () => {
      order.push('lugar');
    });
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(async (filters) => {
      if (filters?.queryKey?.[0] === 'household') order.push('casa');
    });
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).toHaveBeenCalledWith('nova', PINHEIROS);
    expect(order).toEqual(['lugar', 'casa']);
    expect(notify).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it('pela localização do celular, e "Tirar o local" volta a criar sem ele', async () => {
    await fill();
    await press('Usar a localização do celular');
    expect(page()).toContain('Vila Madalena, São PauloPela localização do celular');
    await press(HOUSE_PLACE_REMOVE);
    expect(page()).not.toContain('Vila Madalena');
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
  });

  it('o CEP digitado e não buscado é buscado no toque de criar, e vale ele', async () => {
    await fill();
    await type('CEP', '05422-030');
    await press('Criar casa');
    expect(mockWeather.findPlaceByCep).toHaveBeenCalledWith('05422030');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).toHaveBeenCalledWith('nova', PINHEIROS);
  });

  it('o CEP que não é achado no toque de criar: diz o motivo e não cria nada', async () => {
    mockWeather.findPlaceByCep.mockImplementation(async () => {
      throw new Error('CEP não encontrado. Confira os números.');
    });
    await fill();
    await type('CEP', '00000000');
    await press('Criar casa');
    expect(notify).toHaveBeenCalledWith(CEP_LOOKUP_FAILED_TITLE, cepLookupFailedMessage('CEP não encontrado. Confira os números.'));
    expect(creates()).toHaveLength(0);
    // O CEP fica no campo para corrigir.
    expect(field('CEP').props.value).toBe('00000-000');
  });

  it('o CEP com números faltando: avisa e não cria nada', async () => {
    await fill();
    await type('CEP', '0542');
    await press('Criar casa');
    expect(notify).toHaveBeenCalledWith(CEP_INCOMPLETE_TITLE, cepIncompleteOnCreate(null));
    expect(mockWeather.findPlaceByCep).not.toHaveBeenCalled();
    expect(creates()).toHaveLength(0);
  });

  it('com um lugar achado antes, o aviso do CEP diz que apagá-lo fica com o achado, e é o que acontece', async () => {
    await fill();
    await press('Usar a localização do celular');
    await type('Mudar pelo CEP', '0542');
    await press('Criar casa');
    expect(notify).toHaveBeenCalledWith(CEP_INCOMPLETE_TITLE, cepIncompleteOnCreate('Vila Madalena, São Paulo'));
    expect(creates()).toHaveLength(0);

    mockWeather.findPlaceByCep.mockImplementation(async () => {
      throw new Error('CEP não encontrado. Confira os números.');
    });
    await type('Mudar pelo CEP', '00000000');
    await press('Criar casa');
    expect(notify).toHaveBeenCalledWith(
      CEP_LOOKUP_FAILED_TITLE,
      cepLookupFailedMessage('CEP não encontrado. Confira os números.', 'Vila Madalena, São Paulo'),
    );
    expect(creates()).toHaveLength(0);

    // Apagado o CEP, a casa é criada com o lugar achado antes, como o aviso disse.
    await type('Mudar pelo CEP', '');
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).toHaveBeenCalledWith('nova', PERTO);
  });

  it('a busca do CEP no toque de criar: o andamento fica no botão tocado, e o formulário trava', async () => {
    await fill();
    await type('CEP', '05422030');
    const answer = pendingCep();
    await act(async () => {
      button('Criar casa').props.onPress();
    });
    expect(button('Criar casa').props.loading).toBe(true);
    expect(button('Buscar pelo CEP').props.loading).toBe(false);
    expect(field('Seu nome').props.editable).toBe(false);
    expect(field('Nome da casa').props.editable).toBe(false);
    expect(field('CEP').props.editable).toBe(false);
    await act(async () => answer(PINHEIROS));
    await settle();
    expect(creates()).toHaveLength(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(placeFoundAnnouncement('Pinheiros, São Paulo'));
  });

  it('trocar para "Tenho um código" durante a busca do CEP do toque de criar não vale: o toque já decidiu', async () => {
    await fill();
    await type('CEP', '05422030');
    const answer = pendingCep();
    await act(async () => {
      button('Criar casa').props.onPress();
    });
    await act(async () => segmented().props.onChange('entrar'));
    expect(page()).toContain('Onde fica a casa');
    expect(page()).not.toContain('Código de convite');
    await act(async () => answer(PINHEIROS));
    await settle();
    expect(creates()).toHaveLength(1);
    expect(mockRpc).not.toHaveBeenCalledWith('join_household', expect.anything());
    // Terminado o envio, dá para trocar de novo.
    await act(async () => segmented().props.onChange('entrar'));
    expect(page()).toContain('Código de convite');
  });

  it('o lugar que não foi salvo: a casa fica criada e a pessoa sabe onde definir depois', async () => {
    mockWeather.saveHouseholdLocationFor.mockImplementation(async () => {
      throw new Error('Sem internet agora.');
    });
    await fill();
    await type('CEP', '05422030');
    await press('Buscar pelo CEP');
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage('Sem internet agora.'));
    expect(notify).not.toHaveBeenCalledWith('Não foi possível continuar', expect.anything());
    // A casa é buscada de novo mesmo assim: é o que leva desta tela para a casa nova (a guarda do _layout).
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['household'] });
    expect(mockWeather.saveHouseholdLocationFor.mock.invocationCallOrder[0]).toBeLessThan(
      invalidate.mock.invocationCallOrder[invalidate.mock.calls.findIndex(([filters]) => filters?.queryKey?.[0] === 'household')],
    );
    invalidate.mockRestore();
  });

  it('o lugar que não chegou ao servidor: o aviso diz "sem internet" sem mandar tentar de novo', async () => {
    mockWeather.saveHouseholdLocationFor.mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    await fill();
    await press('Usar a localização do celular');
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage(PLACE_NOT_SAVED_OFFLINE));
    expect(JSON.stringify((notify as jest.Mock).mock.calls)).not.toContain('Tente de novo');
  });

  it('a casa que o banco não criou: o lugar não é salvo e a pessoa sabe', async () => {
    mockRpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'falhou' } }));
    await fill();
    await press('Usar a localização do celular');
    await press('Criar casa');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Não foi possível continuar', expect.anything());
  });

  it('dois toques seguidos criam uma casa só', async () => {
    await fill();
    await type('CEP', '05422030');
    await act(async () => {
      button('Criar casa').props.onPress();
      button('Criar casa').props.onPress();
    });
    await settle();
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).toHaveBeenCalledTimes(1);
  });

  it('entrar com um código não pergunta onde fica a casa', async () => {
    await mount(<WelcomeScreen />);
    await act(async () => renderer!.root.findAll((node) => node.props.value === 'criar' && typeof node.props.onChange === 'function')[0].props.onChange('entrar'));
    expect(page()).not.toContain('Onde fica a casa');
    await type('Seu nome', 'Ana');
    await type('Código de convite', 'abc234');
    await press('Entrar na casa');
    expect(mockRpc).toHaveBeenCalledWith('join_household', { p_invite_code: 'ABC234', p_display_name: 'Ana' });
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
  });

  it('o lugar achado em "Criar casa" (e um CEP não buscado) não vai para a casa em que se entra pelo código', async () => {
    await fill();
    await press('Usar a localização do celular');
    await type('Mudar pelo CEP', '05422030');
    await act(async () => segmented().props.onChange('entrar'));
    await type('Código de convite', 'abc234');
    await press('Entrar na casa');
    expect(mockRpc).toHaveBeenCalledWith('join_household', { p_invite_code: 'ABC234', p_display_name: 'Ana' });
    expect(creates()).toHaveLength(0);
    expect(mockWeather.findPlaceByCep).not.toHaveBeenCalled();
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
  });
});

describe('Suas casas: criar outra casa', () => {
  async function fill() {
    await mount(<HouseholdsScreen />);
    await type('Nome da casa', 'Casa da praia');
  }

  it('sem o bairro: cria e abre a casa nova, como antes', async () => {
    await fill();
    expect(page()).toContain('Onde fica a casa (opcional)');
    await press('Criar e abrir');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
    expect(mockOpened).toEqual(['nova']);
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(notify).not.toHaveBeenCalled();
  });

  it('com o bairro: salvo na casa nova, pelo id dela, antes de abri-la', async () => {
    const order: string[] = [];
    mockWeather.saveHouseholdLocationFor.mockImplementation(async () => {
      order.push(`lugar (aberta: ${mockOpened.join(',') || 'outra'})`);
    });
    await fill();
    await type('CEP', '05422030');
    await press('Buscar pelo CEP');
    expect(page()).toContain('Pinheiros, São PauloPelo CEP');
    await press('Criar e abrir');
    expect(creates()).toHaveLength(1);
    expect(mockWeather.saveHouseholdLocationFor).toHaveBeenCalledWith('nova', PINHEIROS);
    expect(order).toEqual(['lugar (aberta: outra)']);
    expect(mockOpened).toEqual(['nova']);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('o CEP que não é achado no toque de criar: nada é criado nem aberto', async () => {
    mockWeather.findPlaceByCep.mockImplementation(async () => {
      throw new Error('Não foi possível consultar o CEP agora. Tente de novo em instantes.');
    });
    await fill();
    await type('CEP', '05422030');
    await press('Criar e abrir');
    expect(notify).toHaveBeenCalledWith(
      CEP_LOOKUP_FAILED_TITLE,
      cepLookupFailedMessage('Não foi possível consultar o CEP agora. Tente de novo em instantes.'),
    );
    expect(creates()).toHaveLength(0);
    expect(mockOpened).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('o lugar que não foi salvo: a casa fica criada e aberta, e o aviso diz onde definir depois', async () => {
    mockWeather.saveHouseholdLocationFor.mockImplementation(async () => {
      throw new Error('Sem internet agora.');
    });
    await fill();
    await type('CEP', '05422030');
    await press('Criar e abrir');
    expect(creates()).toHaveLength(1);
    expect(mockOpened).toEqual(['nova']);
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(notify).toHaveBeenCalledWith(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage('Sem internet agora.'));
  });

  it('o lugar que não chegou ao servidor: o aviso diz "sem internet" sem mandar tentar de novo', async () => {
    mockWeather.saveHouseholdLocationFor.mockImplementation(async () => {
      throw new TypeError('Network request failed');
    });
    await fill();
    await press('Usar a localização do celular');
    await press('Criar e abrir');
    expect(creates()).toHaveLength(1);
    expect(mockOpened).toEqual(['nova']);
    expect(notify).toHaveBeenCalledWith(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage(PLACE_NOT_SAVED_OFFLINE));
    expect(JSON.stringify((notify as jest.Mock).mock.calls)).not.toContain('Tente de novo');
  });

  it('dois toques seguidos criam uma casa só', async () => {
    await fill();
    await type('CEP', '05422030');
    await act(async () => {
      button('Criar e abrir').props.onPress();
      button('Criar e abrir').props.onPress();
    });
    await settle();
    expect(creates()).toHaveLength(1);
    expect(mockWeather.findPlaceByCep).toHaveBeenCalledTimes(1);
    expect(mockWeather.saveHouseholdLocationFor).toHaveBeenCalledTimes(1);
    expect(mockOpened).toEqual(['nova']);
  });

  it('a busca do CEP no toque de criar: o andamento fica no botão tocado, o formulário trava e o modo não troca', async () => {
    await fill();
    await type('CEP', '05422030');
    const answer = pendingCep();
    await act(async () => {
      button('Criar e abrir').props.onPress();
    });
    expect(button('Criar e abrir').props.loading).toBe(true);
    expect(button('Buscar pelo CEP').props.loading).toBe(false);
    expect(field('Nome da casa').props.editable).toBe(false);
    expect(field('Seu nome').props.editable).toBe(false);
    await act(async () => segmented().props.onChange('entrar'));
    expect(page()).not.toContain('Código de convite');
    await act(async () => answer(PINHEIROS));
    await settle();
    expect(creates()).toHaveLength(1);
    expect(mockOpened).toEqual(['nova']);
  });

  it('entrar com um código não pergunta onde fica a casa', async () => {
    await mount(<HouseholdsScreen />);
    await act(async () => renderer!.root.findAll((node) => node.props.value === 'criar' && typeof node.props.onChange === 'function')[0].props.onChange('entrar'));
    expect(page()).not.toContain('Onde fica a casa');
  });

  it('o lugar achado em "Criar casa" (e um CEP não buscado) não vai para a casa em que se entra pelo código', async () => {
    await fill();
    await press('Usar a localização do celular');
    await type('Mudar pelo CEP', '05422030');
    await act(async () => segmented().props.onChange('entrar'));
    await type('Código de convite', 'abc234');
    await press('Entrar e abrir');
    expect(mockRpc).toHaveBeenCalledWith('join_household', { p_invite_code: 'ABC234', p_display_name: 'Ana' });
    expect(creates()).toHaveLength(0);
    expect(mockWeather.findPlaceByCep).not.toHaveBeenCalled();
    expect(mockWeather.saveHouseholdLocationFor).not.toHaveBeenCalled();
    expect(mockOpened).toEqual(['dela']);
  });
});
