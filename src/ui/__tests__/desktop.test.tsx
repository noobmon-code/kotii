import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ReactElement } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import {
  DESKTOP_CONTENT_WIDTH,
  DESKTOP_DIALOG_WIDTH,
  DESKTOP_SIDE_MAX_SHARE,
  DESKTOP_SIDE_WIDTH,
  DESKTOP_TABS_WIDTH,
  SIDEBAR_SPACE,
} from '@/domain/desktop';
import { ActionSheet } from '../ActionSheet';
import { Actions, Columns, SidebarContext, useAreaWidth, useDesktop } from '../desktop';
import { Screen, Segmented } from '../primitives';
import { MAX_WIDTH } from '../theme';

// O arranjo do computador (ui/desktop): só no navegador e na janela larga. No celular, e na janela estreita do
// navegador, as mesmas peças deixam a tela exatamente como era: uma coluna, na ordem de sempre, sem caixa a mais.

jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const WINDOW = Dimensions.get('window');
let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  await act(async () => Dimensions.set({ window: WINDOW }));
  jest.restoreAllMocks();
});

/** O navegador numa janela dessa largura. */
async function browser(width: number) {
  jest.replaceProperty(Platform, 'OS', 'web');
  await act(async () => Dimensions.set({ window: { ...WINDOW, width } }));
}

async function mount(element: ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer!.root;
}

const text = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(text).join(''));
const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
/** As caixas de verdade (o que vai para a tela), na ordem em que aparecem. */
const boxes = (root: ReactTestInstance) => root.findAll((node) => (node.type as unknown) === 'View');

function Probe() {
  return <Text>{useDesktop() ? 'computador' : 'celular'}</Text>;
}

describe('a janela de computador', () => {
  it('no celular e no tablet, nunca: nem na tela larga', async () => {
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1366 } }));
    expect(text(await mount(<Probe />))).toBe('celular');
  });

  it('no navegador, só na janela larga, e acompanha a janela quando ela muda de tamanho', async () => {
    await browser(1440);
    const root = await mount(<Probe />);
    expect(text(root)).toBe('computador');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 800 } }));
    expect(text(root)).toBe('celular');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1024 } }));
    expect(text(root)).toBe('computador');
  });
});

describe('a largura do lugar das telas', () => {
  function Width() {
    return <Text>{String(useAreaWidth())}</Text>;
  }

  it('é a da janela; com a barra lateral na tela, a da janela menos o lugar dela', async () => {
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1280 } }));
    expect(text(await mount(<Width />))).toBe('1280');
    await act(async () =>
      renderer!.update(
        <SidebarContext.Provider value>
          <Width />
        </SidebarContext.Provider>,
      ),
    );
    expect(text(renderer!.root)).toBe(String(1280 - SIDEBAR_SPACE));
  });
});

describe('as duas colunas', () => {
  const page = (sideFirst?: boolean) => (
    <Columns sideFirst={sideFirst} side={<Text>ações</Text>}>
      <Text>lista</Text>
      <Text>arquivadas</Text>
    </Columns>
  );

  it('no celular não existem: os dois ficam soltos, a do lado depois (ou antes, com sideFirst)', async () => {
    const root = await mount(page());
    expect(boxes(root)).toHaveLength(0);
    expect(text(root)).toBe('listaarquivadasações');
    await act(async () => renderer!.update(page(true)));
    expect(boxes(root)).toHaveLength(0);
    expect(text(root)).toBe('açõeslistaarquivadas');
  });

  it('na janela estreita do navegador, também não', async () => {
    await browser(800);
    const root = await mount(page(true));
    expect(boxes(root)).toHaveLength(0);
    expect(text(root)).toBe('açõeslistaarquivadas');
  });

  it('no computador, a principal fica com a sobra e a do lado, à direita, com a largura dela', async () => {
    await browser(1440);
    const root = await mount(page());
    const [row, main, side] = boxes(root);
    expect(flat(row)).toMatchObject({ flexDirection: 'row', alignItems: 'flex-start' });
    expect(text(main)).toBe('listaarquivadas');
    expect(flat(main)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(text(side)).toBe('ações');
    // Na janela mais estreita do computador a do lado encolhe, para a principal não ficar apertada.
    expect(flat(side)).toMatchObject({ width: DESKTOP_SIDE_WIDTH, maxWidth: `${DESKTOP_SIDE_MAX_SHARE * 100}%` });
  });

  it('com sideFirst, a do lado vem antes na ordem (teclado e leitor de tela) e continua à direita', async () => {
    await browser(1440);
    const root = await mount(page(true));
    const [row, first, second] = boxes(root);
    expect(text(first)).toBe('ações');
    expect(text(second)).toBe('listaarquivadas');
    expect(flat(row).flexDirection).toBe('row-reverse');
  });

  it('a largura da coluna do lado e o espaço entre as partes vêm de quem usa', async () => {
    await browser(1440);
    const root = await mount(
      <Columns sideWidth={400} gap={16} side={<Text>agenda</Text>}>
        <Text>tarefas</Text>
      </Columns>,
    );
    const [, main, side] = boxes(root);
    expect(flat(main).gap).toBe(16);
    expect(flat(side)).toMatchObject({ width: 400, gap: 16 });
  });
});

describe('as ações do alto de uma parte', () => {
  const actions = (
    <Actions>
      <Text>Nova tarefa</Text>
      <Text>Pontos</Text>
    </Actions>
  );

  it('no celular ficam soltas, uma embaixo da outra', async () => {
    const root = await mount(actions);
    expect(boxes(root)).toHaveLength(0);
  });

  it('no computador ficam lado a lado, do tamanho do rótulo', async () => {
    await browser(1440);
    const root = await mount(actions);
    const [row] = boxes(root);
    expect(flat(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(text(row)).toBe('Nova tarefaPontos');
  });
});

describe('o seletor das partes de uma aba', () => {
  const tabs = (
    <Segmented
      value="a"
      onChange={() => undefined}
      options={[
        { value: 'a', label: 'Listas' },
        { value: 'b', label: 'Notas' },
      ]}
      desktopWidth={DESKTOP_TABS_WIDTH}
    />
  );

  it('no celular ocupa a largura da tela, como sempre', async () => {
    const root = await mount(tabs);
    expect(flat(boxes(root)[0]).maxWidth).toBeUndefined();
  });

  it('no computador não se estica pela coluna: fica à esquerda, com a largura máxima dele', async () => {
    await browser(1440);
    const root = await mount(tabs);
    expect(flat(boxes(root)[0])).toMatchObject({ maxWidth: DESKTOP_TABS_WIDTH, alignSelf: 'flex-start', width: '100%' });
  });

  it('sem a largura pedida, é o mesmo seletor no computador (o de dentro de um cartão)', async () => {
    await browser(1440);
    const root = await mount(<Segmented value="a" onChange={() => undefined} options={[{ value: 'a', label: 'Claro' }]} />);
    expect(flat(boxes(root)[0]).maxWidth).toBeUndefined();
  });
});

describe('a tela', () => {
  /** A caixa do conteúdo: a que tem a largura máxima da coluna. */
  const content = (root: ReactTestInstance) => boxes(root).find((box) => flat(box).alignSelf === 'center' && flat(box).padding !== undefined)!;

  it('no celular, a tela larga é a de sempre, com o lugar do botão do Nuke no fim', async () => {
    const root = await mount(
      <Screen wide fab>
        <Text>conteúdo</Text>
      </Screen>,
    );
    expect(flat(content(root))).toMatchObject({ maxWidth: MAX_WIDTH, paddingBottom: 96 });
  });

  it('no computador, a tela larga (as abas) vai mais longe, e o lugar do botão do Nuke não é guardado', async () => {
    await browser(1440);
    const root = await mount(
      <Screen wide fab>
        <Text>conteúdo</Text>
      </Screen>,
    );
    const box = flat(content(root));
    expect(box.maxWidth).toBe(DESKTOP_CONTENT_WIDTH);
    // O Nuke está na barra lateral: o fim da tela tem a margem de todos os lados.
    expect(box.paddingBottom).toBeUndefined();
  });

  it('no computador, as outras telas (formulários, leitura) ficam na coluna de sempre', async () => {
    await browser(1440);
    const root = await mount(
      <Screen>
        <Text>formulário</Text>
      </Screen>,
    );
    expect(flat(content(root)).maxWidth).toBe(MAX_WIDTH);
  });
});

describe('o menu de ações', () => {
  const sheet = <ActionSheet visible title="Mercado da semana" actions={[{ label: 'Renomear lista', onPress: () => undefined }]} onClose={() => undefined} />;
  /** O fundo escuro do menu: o que fecha no toque. */
  const backdrop = (root: ReactTestInstance) => root.findAll((node) => node.props.accessibilityLabel === 'Fechar')[0];

  it('no celular sobe do rodapé', async () => {
    const root = await mount(sheet);
    expect(flat(backdrop(root)).justifyContent).toBe('flex-end');
  });

  it('no computador é uma caixa no meio da janela', async () => {
    await browser(1440);
    const root = await mount(sheet);
    expect(flat(backdrop(root)).justifyContent).toBe('center');
    const anchored = root.findAll((node) => typeof node.type !== 'string' && flat(node).maxWidth === DESKTOP_DIALOG_WIDTH);
    expect(anchored.length).toBeGreaterThan(0);
  });
});

it('a conta das caixas enxerga um View de verdade', async () => {
  // "Nenhuma caixa" no celular só diz alguma coisa se a busca acha as caixas quando elas existem.
  expect(boxes(await mount(<View />))).toHaveLength(1);
});
