import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Dimensions, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import {
  DESKTOP_CONTENT_WIDTH,
  DESKTOP_DIALOG_WIDTH,
  DESKTOP_PHOTO_WIDTH,
  DESKTOP_SHEET_WIDTH,
  DESKTOP_SIDE_MAX_SHARE,
  DESKTOP_SIDE_WIDTH,
  DESKTOP_TABS_WIDTH,
  DESKTOP_WINDOW_WIDTH,
  REFRESH_LABEL,
  SIDEBAR_SPACE,
  sheetHeights,
} from '@/domain/desktop';
import { PhotoStrip } from '@/features/PhotoStrip';
import { ActionSheet } from '../ActionSheet';
import { Backdrop } from '../Backdrop';
import { Actions, Columns, SidebarContext, useAreaWidth, useBoxArea, useDesktop } from '../desktop';
import { handMenuOpener, menuOpener } from '../focus';
import { Screen, Segmented } from '../primitives';
import { SheetModal } from '../SheetModal';
import { MAX_WIDTH, SCREEN_PADDING, space } from '../theme';

// O arranjo do computador (ui/desktop): só no navegador e na janela larga. No celular, e na janela estreita do
// navegador, as mesmas peças deixam a tela exatamente como era: uma coluna, na ordem de sempre, sem caixa a mais.

jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/data/images', () => ({ signedImageUrl: async (_bucket: string, path: string) => `https://fotos/${path}` }));

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

  it('na janela estreita do navegador, também não: as caixas estão lá, mas não desenham nada (o que está dentro fica solto)', async () => {
    await browser(800);
    const root = await mount(page(true));
    // As mesmas três caixas do computador, na mesma ordem, todas sem caixa na tela (`display: contents`) e sem
    // nenhum outro estilo: o que está dentro fica solto na tela, como no celular.
    const all = boxes(root);
    expect(all).toHaveLength(3);
    for (const box of all) expect(flat(box)).toEqual({ display: 'contents' });
    expect(text(all[1])).toBe('ações');
    expect(text(all[2])).toBe('listaarquivadas');
    expect(text(root)).toBe('açõeslistaarquivadas');
    await act(async () => renderer!.update(page()));
    expect(text(root)).toBe('listaarquivadasações');
  });

  it('a janela que cruza a largura do computador não monta de novo o que está dentro das colunas (o que foi digitado fica)', async () => {
    let mounts = 0;
    function Typed({ name }: { name: string }) {
      const [mount] = useState(() => (mounts += 1));
      return <Text>{`${name} ${mount}`}</Text>;
    }
    const typed = (
      <Columns sideFirst side={<Typed name="lado" />}>
        <Typed name="itens" />
      </Columns>
    );
    await browser(1440);
    const root = await mount(typed);
    expect(mounts).toBe(2);
    expect(flat(boxes(root)[0]).flexDirection).toBe('row-reverse');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 900 } }));
    expect(flat(boxes(root)[0])).toEqual({ display: 'contents' });
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440 } }));
    expect(flat(boxes(root)[0]).flexDirection).toBe('row-reverse');
    // Nem para a janela estreita, nem de volta: as duas montadas uma vez só.
    expect(mounts).toBe(2);
    expect(text(root)).toBe('lado 1itens 2');
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

  it('na janela estreita do navegador, também: a caixa está lá, mas não desenha nada', async () => {
    await browser(800);
    const root = await mount(actions);
    const [row] = boxes(root);
    expect(boxes(root)).toHaveLength(1);
    expect(flat(row)).toEqual({ display: 'contents' });
  });

  it('no computador ficam lado a lado, do tamanho do rótulo', async () => {
    await browser(1440);
    const root = await mount(actions);
    const [row] = boxes(root);
    expect(flat(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(flat(row).justifyContent).toBeUndefined();
    expect(text(row)).toBe('Nova tarefaPontos');
  });

  it('com `end`, no computador, encostadas à direita (o rodapé da revisão da nota)', async () => {
    await browser(1440);
    const root = await mount(
      <Actions end>
        <Text>Descartar nota</Text>
        <Text>Confirmar nota</Text>
      </Actions>,
    );
    const [row] = boxes(root);
    expect(flat(row)).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-end' });
    expect(text(row)).toBe('Descartar notaConfirmar nota');
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

  describe('o rodapé', () => {
    /** As caixas em volta do que vai no rodapé, da mais de fora para a mais de dentro. */
    const around = (root: ReactTestInstance) => {
      const button = root.findAll((node) => (node.type as unknown) === 'Text' && node.props.children === 'Confirmar')[0];
      return boxes(root).filter((box) => box.findAll((node) => node === button).length > 0);
    };
    /** A caixa de dentro do rodapé (a que tem o que vai nele) e a do rodapé, em volta dela. */
    const footerInner = (root: ReactTestInstance) => around(root)[around(root).length - 1];
    const footerBar = (root: ReactTestInstance) => around(root)[around(root).length - 2];
    const page = (
      <Screen wide footer={<Text>Confirmar</Text>}>
        <Text>itens</Text>
      </Screen>
    );

    it('no celular, como sempre: da largura da coluna, com a margem do rodapé', async () => {
      const root = await mount(page);
      expect(flat(footerInner(root))).toEqual({ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: 8 });
      expect(flat(footerBar(root)).paddingHorizontal).toBe(16);
    });

    it('no computador, com as mesmas beiradas do conteúdo: o botão à direita fica embaixo da coluna do lado', async () => {
      await browser(1440);
      const root = await mount(page);
      const inner = flat(footerInner(root));
      const box = flat(content(root));
      expect(inner).toMatchObject({ width: '100%', maxWidth: box.maxWidth, alignSelf: 'center', paddingHorizontal: box.padding });
      expect(flat(footerBar(root)).paddingHorizontal).toBe(0);
    });
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

  describe('o "Atualizar" do computador (no navegador não se puxa a tela)', () => {
    const onRefresh = jest.fn();
    const refresh = (root: ReactTestInstance) =>
      root.findAll((node) => node.props.accessibilityLabel === REFRESH_LABEL && typeof node.props.onPress === 'function');
    /** A caixa em volta do botão: a que diz onde ele fica (a de verdade mais próxima, acima do botão). */
    const holder = (root: ReactTestInstance) => {
      const button = refresh(root)[0];
      const around = boxes(root).filter((box) => box.findAll((node) => node === button).length > 0);
      return around[around.length - 1];
    };
    const page = (props: { wide?: boolean; refreshing?: boolean; ownRefreshButton?: boolean } = {}) => (
      <Screen onRefresh={onRefresh} {...props}>
        <Text>conteúdo</Text>
      </Screen>
    );

    it('no celular, não existe: puxa-se a tela, como sempre', async () => {
      const root = await mount(page({ wide: true }));
      expect(refresh(root)).toHaveLength(0);
    });

    it('na janela estreita do navegador, também não', async () => {
      await browser(800);
      const root = await mount(page({ wide: true }));
      expect(refresh(root)).toHaveLength(0);
    });

    it('no computador, um botão redondo de 44 que faz o que puxar a tela faz', async () => {
      await browser(1440);
      onRefresh.mockClear();
      const root = await mount(page());
      const [button] = refresh(root);
      expect(button.props.accessibilityRole).toBe('button');
      expect(StyleSheet.flatten(button.props.style({ pressed: false }))).toMatchObject({ width: 44, height: 44 });
      await act(async () => button.props.onPress());
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(root.findAllByType(ActivityIndicator)).toHaveLength(0);
    });

    it('buscando, gira, e não aceita outro toque', async () => {
      await browser(1440);
      const root = await mount(page({ refreshing: true }));
      const [button] = refresh(root);
      expect(button.props.disabled).toBe(true);
      expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
      expect(root.findAllByType(ActivityIndicator)).toHaveLength(1);
    });

    it('nas abas fica por cima, no canto de cima à direita; nas outras telas, numa linha dele, à direita, antes do conteúdo', async () => {
      await browser(1440);
      const tab = await mount(page({ wide: true }));
      expect(flat(holder(tab))).toMatchObject({ position: 'absolute', right: SCREEN_PADDING, zIndex: 1 });
      // Antes do conteúdo, na ordem do teclado e do leitor de tela: a primeira caixa dentro da do conteúdo.
      const first = (root: ReactTestInstance) => boxes(content(root))[1] === holder(root);
      expect(first(tab)).toBe(true);
      await act(async () => renderer!.unmount());
      const form = await mount(page());
      expect(flat(holder(form))).toEqual({ alignSelf: 'flex-end' });
      expect(first(form)).toBe(true);
    });

    it('numa aba com o título só para o leitor de tela, vem depois dele: quem navega pelos títulos o acha a partir do começo da página', async () => {
      await browser(1440);
      const root = await mount(
        <Screen wide heading="Compras" onRefresh={onRefresh}>
          <Text>Listas</Text>
        </Screen>,
      );
      // A ordem do teclado e do leitor de tela, entre os filhos da caixa do conteúdo: o título, o botão, o conteúdo.
      const order = content(root).children.map((child) =>
        typeof child === 'string' ? child : child.findAll((node) => node === refresh(root)[0]).length ? 'Atualizar' : text(child),
      );
      expect(order).toEqual(['Compras', 'Atualizar', 'Listas']);
    });

    it('a tela que já tem o próprio botão de atualizar (o Consultor) não ganha um segundo', async () => {
      await browser(1440);
      const root = await mount(page({ ownRefreshButton: true }));
      expect(refresh(root)).toHaveLength(0);
    });

    it('sem o que buscar de novo, não aparece', async () => {
      await browser(1440);
      const root = await mount(
        <Screen wide>
          <Text>conteúdo</Text>
        </Screen>,
      );
      expect(refresh(root)).toHaveLength(0);
    });

    it('a janela que cruza a largura do computador não monta o conteúdo de novo', async () => {
      let mounts = 0;
      function Field() {
        const [first] = useState(() => (mounts += 1));
        return <Text>{`montagem ${first}`}</Text>;
      }
      jest.replaceProperty(Platform, 'OS', 'web');
      await act(async () => Dimensions.set({ window: { ...WINDOW, width: 800 } }));
      const root = await mount(
        <Screen wide onRefresh={onRefresh}>
          <Field />
        </Screen>,
      );
      await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440 } }));
      expect(refresh(root)).toHaveLength(1);
      await act(async () => Dimensions.set({ window: { ...WINDOW, width: 800 } }));
      expect(refresh(root)).toHaveLength(0);
      expect(mounts).toBe(1);
    });
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
    expect(flat(backdrop(root)).paddingLeft).toBeUndefined();
  });

  it('com a barra lateral na tela, a caixa fica no meio do lugar ao lado dela', async () => {
    await browser(1440);
    const root = await mount(<SidebarContext.Provider value>{sheet}</SidebarContext.Provider>);
    expect(flat(backdrop(root))).toMatchObject({ justifyContent: 'center', paddingLeft: SIDEBAR_SPACE + space.xl });
  });

  describe('a opção escolhida diz quem abriu o menu (a tela em janela que ela abre devolve o foco a ele)', () => {
    const adicionar = { name: 'Adicionar' };
    const onPress = jest.fn();
    const menu = (visible: boolean) => <ActionSheet visible={visible} actions={[{ label: 'Remédio', onPress }]} onClose={() => undefined} />;
    /** O menu, que estava fechado, abre (o toque no "Adicionar"). */
    const show = () => renderer!.update(menu(true));
    const option = (root: ReactTestInstance) =>
      root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && text(node) === 'Remédio')[0];
    afterEach(() => {
      delete (global as { document?: unknown }).document;
      handMenuOpener(null);
      onPress.mockClear();
    });

    it('no navegador: quem tinha o foco quando o menu abriu, e não a opção, que tem o foco quando ela roda', async () => {
      await browser(1440);
      const page = { activeElement: adicionar as unknown };
      (global as { document?: unknown }).document = page;
      const root = await mount(menu(false));
      await act(async () => show());
      // Aberto o menu, o foco entra nele (na opção tocada).
      page.activeElement = { name: 'Remédio' };
      await act(async () => option(root).props.onPress());
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(menuOpener()).toMatchObject({ opener: adicionar });
      // A caixa do menu vai junto: a janela só usa quem abriu o menu enquanto o foco ainda estiver dentro dela.
      expect(menuOpener()?.menu).toBeTruthy();
    });

    it('no celular, nada disso', async () => {
      const root = await mount(menu(false));
      await act(async () => show());
      await act(async () => option(root).props.onPress());
      expect(menuOpener()).toBeNull();
    });
  });
});

describe('as caixas no meio da janela, com a barra lateral na tela', () => {
  function Probe() {
    return <View testID="area" style={useBoxArea()} />;
  }
  const area = (root: ReactTestInstance) => root.findAll((node) => node.props.testID === 'area' && (node.type as unknown) === 'View')[0];

  it('no celular, na janela estreita e fora de uma casa (sem a barra), nada a mais', async () => {
    expect(area(await mount(<SidebarContext.Provider value><Probe /></SidebarContext.Provider>)).props.style).toBeNull();
    await act(async () => renderer!.unmount());
    await browser(800);
    expect(area(await mount(<SidebarContext.Provider value><Probe /></SidebarContext.Provider>)).props.style).toBeNull();
    await act(async () => renderer!.unmount());
    await browser(1440);
    expect(area(await mount(<Probe />)).props.style).toBeNull();
  });

  it('a margem da esquerda pula a barra: nenhuma caixa a cobre, nem a das fotos na janela mais estreita do computador', async () => {
    await browser(1440);
    const inset = (area(await mount(<SidebarContext.Provider value><Probe /></SidebarContext.Provider>)).props.style as { paddingLeft: number })
      .paddingLeft;
    expect(inset).toBe(SIDEBAR_SPACE + space.xl);
    // A caixa fica no meio do que sobra entre a margem da esquerda e a da direita (space.xl), com a largura dela até
    // onde cabe: o começo dela nunca entra na barra (de SIDEBAR_MARGIN a SIDEBAR_SPACE).
    for (const width of [1024, 1280, 1366, 1440, 1920]) {
      for (const box of [DESKTOP_PHOTO_WIDTH, DESKTOP_WINDOW_WIDTH, DESKTOP_SHEET_WIDTH, DESKTOP_DIALOG_WIDTH]) {
        const room = width - inset - space.xl;
        const left = inset + (room - Math.min(box, room)) / 2;
        expect(left).toBeGreaterThanOrEqual(SIDEBAR_SPACE);
        // E no meio do lugar das telas, ao lado da barra: o mesmo meio da coluna de uma tela.
        expect(left + Math.min(box, room) / 2).toBeCloseTo(SIDEBAR_SPACE + (width - SIDEBAR_SPACE) / 2);
      }
    }
  });
});

describe('as janelas de formulário', () => {
  const sheet = (props: { tall?: boolean; photo?: boolean; visible?: boolean } = {}) => (
    <SheetModal onClose={onClose} onShow={onShow} onDismiss={onDismiss} {...props}>
      <Text>Renomear lista</Text>
    </SheetModal>
  );
  const onClose = jest.fn();
  const onShow = jest.fn();
  const onDismiss = jest.fn();
  const frame = (root: ReactTestInstance) => root.findAll((node) => node.props.testID === 'sheet-frame' && (node.type as unknown) === 'View')[0];

  it('no celular tomam a tela inteira, subindo do rodapé, sobre o fundo liso', async () => {
    const root = await mount(sheet());
    const modal = root.findByType(Modal);
    expect(modal.props).toMatchObject({ visible: true, animationType: 'slide', transparent: false });
    expect(root.findAllByType(Backdrop)).toHaveLength(1);
    // A caixa de dentro só ocupa a tela: nenhuma largura, altura ou borda dela.
    expect(flat(frame(root))).toEqual({ flex: 1 });
    expect(text(frame(root))).toBe('Renomear lista');
  });

  it('o voltar do Android (e o Esc do navegador), o abrir e o fechar chegam a quem usa', async () => {
    const root = await mount(sheet({ visible: false }));
    const modal = root.findByType(Modal);
    expect(modal.props.visible).toBe(false);
    modal.props.onRequestClose();
    modal.props.onShow();
    modal.props.onDismiss();
    expect([onClose.mock.calls.length, onShow.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it('no computador são uma caixa no meio da janela, com o app escurecido atrás', async () => {
    await browser(1440);
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440, height: 900 } }));
    const root = await mount(sheet());
    expect(root.findByType(Modal).props).toMatchObject({ animationType: 'fade', transparent: true });
    // Sem o fundo liso por cima de tudo: a tela de onde a pessoa veio continua à vista.
    expect(root.findAllByType(Backdrop)).toHaveLength(0);
    const box = flat(frame(root));
    expect(box).toMatchObject({ width: '100%', maxWidth: DESKTOP_SHEET_WIDTH, overflow: 'hidden' });
    // Acompanha o conteúdo, até uma parte da altura da janela; o que não cabe rola dentro dela.
    expect(box.maxHeight).toBe(sheetHeights(900).max);
    expect(box.height).toBeUndefined();
    const dim = root.findAll((node) => flat(node).justifyContent === 'center' && flat(node).alignItems === 'center')[0];
    expect(flat(dim).backgroundColor).toBe('rgba(0,0,0,0.4)');
    expect(flat(dim).paddingLeft).toBeUndefined();
  });

  it('com a barra lateral na tela, a caixa (a das fotos também) fica no meio do lugar ao lado dela, sem cobri-la', async () => {
    await browser(1024);
    for (const props of [{}, { photo: true }]) {
      const root = await mount(<SidebarContext.Provider value>{sheet(props)}</SidebarContext.Provider>);
      const dim = root.findAll((node) => flat(node).justifyContent === 'center' && flat(node).alignItems === 'center')[0];
      expect(flat(dim)).toMatchObject({ padding: space.xl, paddingLeft: SIDEBAR_SPACE + space.xl });
      await act(async () => renderer!.unmount());
    }
  });

  it('a que leva uma lista para escolher tem altura fixa: não muda de tamanho a cada letra da busca', async () => {
    await browser(1440);
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440, height: 900 } }));
    const root = await mount(sheet({ tall: true }));
    const box = flat(frame(root));
    expect(box.height).toBe(sheetHeights(900).tall);
    expect(box.maxHeight).toBeUndefined();
  });

  it('as fotos, no celular, aparecem no lugar (sem subir do rodapé) e tomam a tela, como sempre', async () => {
    const root = await mount(sheet({ photo: true }));
    expect(root.findByType(Modal).props).toMatchObject({ animationType: 'fade', transparent: false });
    expect(root.findAllByType(Backdrop)).toHaveLength(1);
    expect(flat(frame(root))).toEqual({ flex: 1 });
  });

  it('as fotos, no computador, numa caixa mais larga, com a altura que a janela dá', async () => {
    await browser(1440);
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440, height: 900 } }));
    const root = await mount(sheet({ photo: true }));
    expect(root.findByType(Modal).props).toMatchObject({ animationType: 'fade', transparent: true });
    const box = flat(frame(root));
    expect(box).toMatchObject({ maxWidth: DESKTOP_PHOTO_WIDTH, height: sheetHeights(900).max });
    expect(box.maxHeight).toBeUndefined();
  });

  it('as fotos de um documento, aparelho, exame ou plano (PhotoStrip) abrem na caixa das fotos', async () => {
    await browser(1440);
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440, height: 900 } }));
    // Sem prazo para esquecer as consultas: um relógio de limpeza deixaria o Jest esperando no fim.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const root = await mount(
      <QueryClientProvider client={client}>
        <PhotoStrip bucket="documents" paths={['h1/rg.jpg', 'h1/verso.jpg']} />
      </QueryClientProvider>,
    );
    const viewer = () => root.findByType(SheetModal);
    expect(viewer().props).toMatchObject({ visible: false, photo: true });
    const thumbs = root.findAll((node) => node.props.accessibilityLabel === 'Ver foto' && typeof node.props.onPress === 'function');
    await act(async () => thumbs[1].props.onPress());
    expect(viewer().props).toMatchObject({ visible: true, photo: true });
    expect(text(viewer())).toContain('Foto 2 de 2');
    expect(flat(frame(root))).toMatchObject({ maxWidth: DESKTOP_PHOTO_WIDTH, height: sheetHeights(900).max });
    client.clear();
  });

  it('a janela que cruza a largura do computador não monta o formulário de novo', async () => {
    let mounts = 0;
    function Field() {
      // Conta as montagens: um formulário montado de novo perderia o que foi digitado.
      const [first] = useState(() => (mounts += 1));
      return <Text>{`montagem ${first}`}</Text>;
    }
    jest.replaceProperty(Platform, 'OS', 'web');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 800 } }));
    const root = await mount(
      <SheetModal onClose={onClose}>
        <Field />
      </SheetModal>,
    );
    expect(root.findByType(Modal).props.transparent).toBe(false);
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 1440 } }));
    expect(root.findByType(Modal).props.transparent).toBe(true);
    await act(async () => Dimensions.set({ window: { ...WINDOW, width: 800 } }));
    expect(text(frame(root))).toBe('montagem 1');
    expect(mounts).toBe(1);
  });

  it('todo formulário e toda foto em janela usam a mesma peça: só ela, o menu de ações e a espera abrem um Modal', () => {
    const SRC = join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.tsx')) files.push(path);
      }
    };
    walk(SRC);
    const withModal = files
      .filter((path) => /<Modal\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1).split('\\').join('/'))
      .sort();
    // Uma janela nova de formulário (ou de ver fotos) usa o SheetModal: sozinha, ela tomaria a janela inteira no computador.
    expect(withModal).toEqual(['ui/ActionSheet.tsx', 'ui/BusyOverlay.tsx', 'ui/SheetModal.tsx']);
  });
});

it('a conta das caixas enxerga um View de verdade', async () => {
  // "Nenhuma caixa" no celular só diz alguma coisa se a busca acha as caixas quando elas existem.
  expect(boxes(await mount(<View />))).toHaveLength(1);
});
