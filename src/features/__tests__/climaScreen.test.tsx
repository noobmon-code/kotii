import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import WeatherScreen from '@/app/clima';
import type { HouseholdLocation } from '@/data/weather';
import {
  CEP_INCOMPLETE,
  CEP_INCOMPLETE_TITLE,
  HOUSE_PLACE_REMOVE,
  housePlaceHouseLine,
  PLACE_SEARCH_FAILED_TITLE,
} from '@/domain/housePlace';
import { confirmAction, notify } from '@/ui/dialogs';
import { router } from 'expo-router';

// A tela do clima (Configurações → Clima da casa) salva o bairro achado na hora, pela mesma busca de quem cria a casa
// (usePlaceSearch): o CEP só sai do campo depois de salvo; se salvar falha, o aviso diz o motivo e o CEP fica.

const PINHEIROS: HouseholdLocation = { label: 'Pinheiros, São Paulo', latitude: -23.56, longitude: -46.69, source: 'cep' };
const PERTO: HouseholdLocation = { label: 'Vila Madalena, São Paulo', latitude: -23.55, longitude: -46.69, source: 'gps' };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockState: { location: HouseholdLocation | null; houses: number; remindersSupported: boolean } = {
  location: null,
  houses: 1,
  remindersSupported: true,
};
const mockWeather = {
  findPlaceByCep: jest.fn(async (_cep: string): Promise<HouseholdLocation> => PINHEIROS),
  findPlaceByDevice: jest.fn(async (): Promise<HouseholdLocation> => PERTO),
  save: jest.fn(async (place: HouseholdLocation): Promise<HouseholdLocation> => place),
  clear: jest.fn(),
};
jest.mock('@/data/weather', () => ({
  findPlaceByCep: (cep: string) => mockWeather.findPlaceByCep(cep),
  findPlaceByDevice: () => mockWeather.findPlaceByDevice(),
  useSaveHouseholdLocation: () => ({ mutateAsync: (place: HouseholdLocation) => mockWeather.save(place) }),
  useClearHouseholdLocation: () => ({ isPending: false, mutate: mockWeather.clear }),
  useRefreshWeather: () => async () => undefined,
}));
jest.mock('@/features/useHouseWeather', () => ({
  useHouseWeather: () => ({
    location: { data: mockState.location, isPending: false, isRefetching: false },
    forecast: { data: undefined, isPending: false, isRefetching: false, error: null },
    tipsFor: () => [],
  }),
}));
jest.mock('@/lib/reminders', () => ({
  REMINDER_PLACE: 'neste celular',
  get remindersSupported() {
    return mockState.remindersSupported;
  },
  remindersUnavailableReason: () => 'Este navegador não mostra avisos.',
}));
// A casa aberta e quantas a pessoa tem: com mais de uma, a tela diz de qual casa é o lugar.
jest.mock('@/lib/auth', () => ({
  useHousehold: () => ({
    data: {
      household: { id: 'h1', name: 'Casa da Ana' },
      households: Array.from({ length: mockState.houses }, (_, i) => ({ id: `h${i + 1}`, name: `Casa ${i + 1}`, role: 'owner' })),
    },
  }),
}));
jest.mock('@/lib/supabase', () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => rawText(renderer!.root);

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount() {
  await act(async () => {
    renderer = create(<WeatherScreen />);
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

beforeEach(() => {
  jest.clearAllMocks();
  mockState.location = null;
  mockState.houses = 1;
  mockState.remindersSupported = true;
  mockWeather.findPlaceByCep.mockImplementation(async () => PINHEIROS);
  mockWeather.findPlaceByDevice.mockImplementation(async () => PERTO);
  mockWeather.save.mockImplementation(async (place) => place);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('Clima da casa: definir o bairro', () => {
  it('pelo CEP: busca, salva o lugar achado e só então limpa o campo', async () => {
    await mount();
    expect(button('Buscar pelo CEP').props.variant).toBe('primary');
    await type('CEP', '05422030');
    let cepWhenSaving = '';
    mockWeather.save.mockImplementation(async (place) => {
      cepWhenSaving = field('CEP').props.value;
      return place;
    });
    await press('Buscar pelo CEP');
    expect(mockWeather.findPlaceByCep).toHaveBeenCalledWith('05422030');
    expect(mockWeather.save).toHaveBeenCalledWith(PINHEIROS);
    expect(cepWhenSaving).toBe('05422-030');
    expect(field('CEP').props.value).toBe('');
    expect(notify).not.toHaveBeenCalled();
  });

  it('pela localização do celular: salva o lugar achado', async () => {
    await mount();
    await press('Usar a localização do celular');
    expect(mockWeather.findPlaceByDevice).toHaveBeenCalled();
    expect(mockWeather.save).toHaveBeenCalledWith(PERTO);
  });

  it('salvar que falha: o aviso diz o motivo e o CEP fica no campo', async () => {
    mockWeather.save.mockImplementation(async () => {
      throw new Error('Sem internet agora.');
    });
    await mount();
    await type('CEP', '05422030');
    await press('Buscar pelo CEP');
    expect(notify).toHaveBeenCalledWith(PLACE_SEARCH_FAILED_TITLE, 'Sem internet agora.');
    expect(field('CEP').props.value).toBe('05422-030');
    // Terminada a busca, os botões voltam.
    expect(button('Buscar pelo CEP').props.disabled).toBe(false);
  });

  it('a busca que falha: o aviso diz o motivo, nada é salvo e o CEP fica', async () => {
    mockWeather.findPlaceByCep.mockImplementation(async () => {
      throw new Error('CEP não encontrado. Confira os números.');
    });
    await mount();
    await type('CEP', '00000000');
    await press('Buscar pelo CEP');
    expect(notify).toHaveBeenCalledWith(PLACE_SEARCH_FAILED_TITLE, 'CEP não encontrado. Confira os números.');
    expect(mockWeather.save).not.toHaveBeenCalled();
    expect(field('CEP').props.value).toBe('00000-000');
  });

  it('o CEP com números faltando: avisa e não busca', async () => {
    await mount();
    await type('CEP', '0542');
    await press('Buscar pelo CEP');
    expect(notify).toHaveBeenCalledWith(CEP_INCOMPLETE_TITLE, CEP_INCOMPLETE);
    expect(mockWeather.findPlaceByCep).not.toHaveBeenCalled();
  });

  it('enquanto busca, os dois botões ficam travados e o tocado mostra o andamento', async () => {
    let answer: (place: HouseholdLocation) => void = () => undefined;
    mockWeather.findPlaceByCep.mockImplementation(
      () =>
        new Promise<HouseholdLocation>((resolve) => {
          answer = resolve;
        }),
    );
    await mount();
    await type('CEP', '05422030');
    await act(async () => {
      button('Buscar pelo CEP').props.onPress();
    });
    expect(button('Buscar pelo CEP').props.loading).toBe(true);
    expect(button('Buscar pelo CEP').props.disabled).toBe(true);
    expect(button('Usar a localização do celular').props.disabled).toBe(true);
    await act(async () => answer(PINHEIROS));
    await settle();
    expect(mockWeather.save).toHaveBeenCalledWith(PINHEIROS);
  });

  it('com o bairro: o lugar, o campo para mudar e "Tirar o local", que pergunta antes', async () => {
    mockState.location = PINHEIROS;
    await mount();
    expect(page()).toContain('Pinheiros, São PauloPelo CEP');
    expect(field('Mudar pelo CEP')).toBeDefined();
    await press(HOUSE_PLACE_REMOVE);
    expect(confirmAction).toHaveBeenCalledWith(HOUSE_PLACE_REMOVE, expect.any(String), 'Tirar', expect.any(Function));
  });

  it('com mais de uma casa, a tela diz de qual casa é o lugar; com uma só, não', async () => {
    mockState.location = PINHEIROS;
    await mount();
    expect(page()).not.toContain('Casa da Ana');
    await act(async () => renderer?.unmount());
    mockState.houses = 2;
    await mount();
    expect(page()).toContain(`Onde fica a casa${housePlaceHouseLine('Casa da Ana')}Pinheiros, São Paulo`);
  });
});

describe('Clima da casa: a dica por notificação', () => {
  it('com avisos neste aparelho, aponta para os avisos da Família', async () => {
    mockState.location = PINHEIROS;
    await mount();
    expect(page()).toContain('Cada pessoa liga no próprio aparelho, em Família, “Avisos neste celular”.');
    expect(button('Abrir os avisos')).toBeDefined();
    expect(page()).not.toContain('tela Hoje');
    // Abre a Família já no interruptor das dicas do clima.
    await act(async () => button('Abrir os avisos').props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/familia', params: { aviso: 'weather' } });
  });

  it('sem avisos neste aparelho, diz por que e que as dicas ficam nesta tela (não mais na tela Hoje)', async () => {
    mockState.location = PINHEIROS;
    mockState.remindersSupported = false;
    await mount();
    expect(page()).toContain('Este navegador não mostra avisos. As dicas ficam aqui, nesta tela.');
    expect(button('Abrir os avisos')).toBeUndefined();
    expect(page()).not.toContain('tela Hoje');
  });
});
