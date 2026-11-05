import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/store';
import { inMemoryContext } from 'expo-router/build/testing-library/context-stubs';
import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SPOTLIGHT_TICK_MS, SPOTLIGHT_WAIT_MS, useReminderSpotlight } from '@/features/useReminderSpotlight';

// O `?aviso=` com o roteador de verdade: a pilha da raiz, as abas dentro dela e a aba Família com o hook de verdade.
// "Abrir os avisos" fica em telas da pilha (o clima, o remédio, a reposição) e em abas (a despensa da Casa); de uma
// tela da pilha, o push empilha um navegador de abas novo, que monta junto com a Família. O parâmetro tem de sair da
// rota da Família em todos os casos (senão a recarga da página rola de novo, e o mesmo link tocado outra vez não
// faz nada), e a página aberta já com o parâmetro (a recarga, um link) não pode quebrar. Sem medidas aqui: a tela
// não rola, só o pedido conta (a rolagem está em reminderSpotlight.test).

jest.mock('@/ui/scrollMeasure', () => ({ measureScrollArea: async () => null, measureInScroll: async () => null }));

/** Quantos pedidos a Família recebeu (cada vez que o destaque começa) e o que ela viu no parâmetro. */
const seen = { requests: 0, params: [] as (string | undefined)[] };

function Familia() {
  const { aviso } = useLocalSearchParams<{ aviso?: string }>();
  const active = Boolean(useReminderSpotlight(aviso).spotlight);
  useEffect(() => {
    if (active) seen.requests++;
  }, [active]);
  useEffect(() => {
    seen.params.push(aviso);
  });
  return <Text>Família</Text>;
}

const routes = {
  _layout: () => <Stack />,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/index': () => <Text>Hoje</Text>,
  '(tabs)/casa': () => <Text>Casa</Text>,
  '(tabs)/familia': Familia,
  clima: () => <Text>Clima da casa</Text>,
  'remedio/[id]': () => <Text>Remédio</Text>,
};

let renderer: ReactTestRenderer | undefined;

async function start(location: string) {
  await act(async () => {
    renderer = create(<ExpoRoot context={inMemoryContext(routes) as never} location={location} />);
  });
}

async function go(href: Parameters<typeof router.push>[0]) {
  await act(async () => {
    router.push(href);
  });
}

/** Deixa o pedido terminar (sem medida, ele desiste em SPOTLIGHT_WAIT_MS). */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(SPOTLIGHT_WAIT_MS + SPOTLIGHT_TICK_MS * 4);
  });
}

const route = () => store.getRouteInfo();
const openAvisos = (aviso: string) => go({ pathname: '/familia', params: { aviso } });

beforeEach(() => {
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  jest.useFakeTimers();
  seen.requests = 0;
  seen.params = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

describe('"Abrir os avisos" com o roteador de verdade', () => {
  it.each([
    ['de uma aba (a Casa)', '/casa'],
    ['de uma tela da pilha (o clima)', '/clima'],
    ['de outra tela da pilha (o remédio)', '/remedio/r1'],
  ])('%s: o parâmetro sai da rota da Família, e o mesmo link tocado de novo pede de novo', async (_, from) => {
    await start('/');
    await go(from);
    await openAvisos('supplies');
    await settle();
    expect(route().pathname).toBe('/familia');
    expect(route().params.aviso).toBeUndefined();
    expect(seen.params.at(-1)).toBeUndefined();
    expect(seen.requests).toBe(1);

    // Dentro das mesmas abas, a Casa e de volta à Família com o mesmo tipo: um pedido novo.
    await go('/casa');
    await openAvisos('supplies');
    await settle();
    expect(route().params.aviso).toBeUndefined();
    expect(seen.requests).toBe(2);
  });

  it('a página aberta já com o parâmetro (a recarga, um link): pede uma vez e tira o parâmetro, sem erro', async () => {
    await start('/familia?aviso=weather');
    await settle();
    expect(route().pathname).toBe('/familia');
    expect(route().params.aviso).toBeUndefined();
    expect(seen.requests).toBe(1);
  });
});
