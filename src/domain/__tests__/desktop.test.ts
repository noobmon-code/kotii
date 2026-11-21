import { describe, expect, it } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  APP_AREAS,
  areaHref,
  areaOfSegments,
  DESKTOP_CONTENT_WIDTH,
  DESKTOP_MIN_WIDTH,
  DESKTOP_PANEL_SIDE_WIDTH,
  DESKTOP_PHOTO_WIDTH,
  DESKTOP_SHEET_HEIGHT_SHARE,
  DESKTOP_SHEET_TALL_HEIGHT,
  DESKTOP_SHEET_WIDTH,
  DESKTOP_SIDE_MAX_SHARE,
  DESKTOP_SIDE_WIDTH,
  DESKTOP_WINDOW_HEIGHT,
  DESKTOP_WINDOW_WIDTH,
  isDesktop,
  onTabs,
  SCREEN_AREAS,
  sheetHeights,
  SIDEBAR_MARGIN,
  SIDEBAR_SPACE,
  SIDEBAR_WIDTH,
  tabParams,
  windowFallback,
  windowHeight,
  type NavRoute,
} from '../desktop';
import { CASA_TABS, COMPRAS_TABS, DIA_A_DIA, FINANCAS, SAUDE_TABS } from '../tabs';

const APP_DIR = join(__dirname, '..', '..', 'app');

describe('a janela de computador', () => {
  it('só no navegador, a partir de 1024 de largura', () => {
    expect(DESKTOP_MIN_WIDTH).toBe(1024);
    expect(isDesktop(true, 1024)).toBe(true);
    expect(isDesktop(true, 1440)).toBe(true);
    expect(isDesktop(true, 1023.5)).toBe(false);
    expect(isDesktop(true, 390)).toBe(false);
    // No celular e no tablet (o app instalado), nunca: nem deitado, nem numa tela grande.
    expect(isDesktop(false, 1024)).toBe(false);
    expect(isDesktop(false, 1366)).toBe(false);
    // A janela ainda sem medida fica com o celular.
    expect(isDesktop(true, 0)).toBe(false);
    expect(isDesktop(true, Number.NaN)).toBe(false);
    expect(isDesktop(true, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('na janela mais estreita do computador, as duas colunas ainda cabem ao lado da barra', () => {
    expect(SIDEBAR_SPACE).toBe(SIDEBAR_WIDTH + SIDEBAR_MARGIN);
    // O que sobra para a tela, menos a margem dela dos dois lados (20).
    const row = DESKTOP_MIN_WIDTH - SIDEBAR_SPACE - 2 * 20;
    // A coluna do lado encolhe até a parte dela da linha; a principal fica com o resto, menos o espaço entre as duas (24).
    const main = (side: number) => row - 24 - Math.min(side, row * DESKTOP_SIDE_MAX_SHARE);
    // Com a do lado de qualquer das duas larguras, a principal fica mais larga que um celular.
    expect(main(DESKTOP_SIDE_WIDTH)).toBeGreaterThanOrEqual(360);
    expect(main(DESKTOP_PANEL_SIDE_WIDTH)).toBeGreaterThanOrEqual(360);
    // E a do lado, encolhida, ainda tem a largura de um celular estreito.
    expect(row * DESKTOP_SIDE_MAX_SHARE).toBeGreaterThanOrEqual(320);
    expect(DESKTOP_CONTENT_WIDTH).toBeGreaterThan(720);
  });
});

describe('as janelas de formulário no computador', () => {
  it('a caixa cabe na janela mais estreita do computador, ao lado de nada (ela fica por cima de tudo)', () => {
    expect(DESKTOP_SHEET_WIDTH).toBeLessThan(DESKTOP_MIN_WIDTH - 2 * 24);
    // Mais larga que um celular: os formulários não ficam mais apertados do que lá.
    expect(DESKTOP_SHEET_WIDTH).toBeGreaterThanOrEqual(430);
  });

  it('a altura: até uma parte da janela; a das listas de escolher, fixa e nunca maior que isso', () => {
    expect(sheetHeights(900)).toEqual({ max: Math.floor(900 * DESKTOP_SHEET_HEIGHT_SHARE), tall: DESKTOP_SHEET_TALL_HEIGHT });
    expect(sheetHeights(1080)).toEqual({ max: 950, tall: 720 });
    // Na janela baixa, a lista de escolher encolhe com ela.
    expect(sheetHeights(700)).toEqual({ max: 616, tall: 616 });
    expect(sheetHeights(600.5)).toEqual({ max: 528, tall: 528 });
    // A janela ainda sem medida fica com a altura das listas.
    for (const height of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sheetHeights(height)).toEqual({ max: DESKTOP_SHEET_TALL_HEIGHT, tall: DESKTOP_SHEET_TALL_HEIGHT });
    }
  });

  it('as fotos: mais larga que a dos formulários, e ainda cabe na janela mais estreita do computador', () => {
    expect(DESKTOP_PHOTO_WIDTH).toBeGreaterThan(DESKTOP_SHEET_WIDTH);
    expect(DESKTOP_PHOTO_WIDTH).toBeLessThan(DESKTOP_MIN_WIDTH - 2 * 24);
  });
});

describe('as telas em janela no computador (as que no celular sobem por cima das outras)', () => {
  it('a caixa tem a largura da coluna das telas de formulário (MAX_WIDTH) e cabe na janela mais estreita do computador', () => {
    expect(DESKTOP_WINDOW_WIDTH).toBe(720);
    expect(DESKTOP_WINDOW_WIDTH).toBeLessThan(DESKTOP_MIN_WIDTH - 2 * 24);
  });

  it('a altura é fixa: a parte da janela que as caixas tomam, até DESKTOP_WINDOW_HEIGHT', () => {
    expect(windowHeight(900)).toBe(Math.floor(900 * DESKTOP_SHEET_HEIGHT_SHARE));
    expect(windowHeight(1400)).toBe(DESKTOP_WINDOW_HEIGHT);
    expect(windowHeight(600)).toBe(528);
    // A janela ainda sem medida: a das listas de escolher.
    expect(windowHeight(Number.NaN)).toBe(DESKTOP_SHEET_TALL_HEIGHT);
  });

  it('sem tela para onde voltar, o "Fechar" leva à parte da aba onde fica o que a tela mostra (ou à Hoje)', () => {
    // As notas pendentes ficam em Compras → Notas: o mesmo lugar do "Voltar" das duas telas da nota.
    expect(windowFallback('nota/qrcode')).toEqual({ pathname: '/compras', params: { aba: 'notas' } });
    expect(windowFallback('nota/pendente')).toEqual({ pathname: '/compras', params: { aba: 'notas' } });
    expect(windowFallback('despensa/[id]')).toEqual({ pathname: '/compras', params: { aba: 'despensa' } });
    expect(windowFallback('reposicao/[id]')).toEqual({ pathname: '/compras', params: { aba: 'despensa' } });
    expect(windowFallback('tarefa/[id]')).toEqual({ pathname: '/casa', params: { aba: 'dia', dia: 'tarefas' } });
    expect(windowFallback('compromisso/[id]')).toEqual({ pathname: '/casa', params: { aba: 'dia', dia: 'agenda' } });
    expect(windowFallback('remedio/[id]')).toEqual({ pathname: '/saude', params: { aba: 'remedios' } });
    expect(windowFallback('consulta/[id]')).toEqual({ pathname: '/saude', params: { aba: 'cuidados' } });
    expect(windowFallback('vacina/[id]')).toEqual({ pathname: '/saude', params: { aba: 'cuidados' } });
    expect(windowFallback('pessoa/[id]')).toEqual({ pathname: '/saude', params: { aba: 'cuidados' } });
    expect(windowFallback('orcamento')).toEqual({ pathname: '/casa', params: { aba: 'financas', financas: 'resumo' } });
    expect(windowFallback('conta/[id]')).toEqual({ pathname: '/casa', params: { aba: 'financas', financas: 'contas' } });
    expect(windowFallback('gasto/[id]')).toEqual({ pathname: '/casa', params: { aba: 'financas', financas: 'resumo' } });
    expect(windowFallback('consultor/conversa')).toEqual({ pathname: '/consultor' });
    // O serviço: o prestador ou o aparelho de onde ele foi aberto, quando o endereço diz; senão, a lista dos prestadores.
    expect(windowFallback('servico/[id]', { id: 'novo', prestador: 'p1' })).toEqual({ pathname: '/prestador/[id]', params: { id: 'p1' } });
    expect(windowFallback('servico/[id]', { id: 'novo', aparelho: 'a1' })).toEqual({ pathname: '/aparelho/[id]', params: { id: 'a1' } });
    expect(windowFallback('servico/[id]', { id: 'j1' })).toEqual({ pathname: '/prestadores' });
    expect(windowFallback('nuke')).toEqual({ pathname: '/' });
    // Uma tela sem lugar próprio: a aba da área dela; de nenhuma área, a Hoje.
    expect(windowFallback('lista/[id]/index')).toEqual({ pathname: '/compras' });
    expect(windowFallback('nao-existe')).toEqual({ pathname: '/' });
  });

  it('o lugar de cada janela existe: a tela, e a parte da aba', () => {
    const parts: Record<string, readonly { value: string }[]> = { '/compras': COMPRAS_TABS, '/casa': CASA_TABS, '/saude': SAUDE_TABS };
    // O arquivo da tela do endereço: uma aba, uma tela, ou a de entrada de uma pasta.
    const routeFile = (pathname: string) => {
      const path = pathname.slice(1);
      const files = [join(APP_DIR, '(tabs)', `${path || 'index'}.tsx`), join(APP_DIR, `${path}.tsx`), join(APP_DIR, path, 'index.tsx')];
      return files.some((file) => existsSync(file));
    };
    const layout = readFileSync(join(APP_DIR, '_layout.tsx'), 'utf8');
    const windows = [...layout.matchAll(/<Stack\.Screen name="([^"]+)" options=\{windowOptions\(/g)].map((match) => match[1]);
    expect(windows.length).toBeGreaterThan(10);
    const addresses = [
      ...windows.map((name) => windowFallback(name)),
      windowFallback('servico/[id]', { prestador: 'p1' }),
      windowFallback('servico/[id]', { aparelho: 'a1' }),
    ];
    for (const { pathname } of addresses) expect([pathname, routeFile(pathname)]).toEqual([pathname, true]);
    for (const name of windows) {
      const { pathname, params } = windowFallback(name);
      if (params?.aba) expect(parts[pathname].map((tab) => tab.value)).toContain(params.aba);
      if (params?.dia) expect(DIA_A_DIA.map((tab) => tab.value)).toContain(params.dia);
      if (params?.financas) expect(FINANCAS.map((tab) => tab.value)).toContain(params.financas);
    }
  });
});

describe('as áreas da barra lateral', () => {
  it('são as abas do app, na ordem em que o layout das abas as declara', () => {
    const layout = readFileSync(join(APP_DIR, '(tabs)', '_layout.tsx'), 'utf8');
    const declared = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)" options=\{\{ title: '([^']+)'/g)].map((m) => ({
      route: m[1],
      label: m[2],
    }));
    expect(declared.length).toBeGreaterThan(0);
    // O nome é o título da página (na barra lateral cabe "Configurações", que na pílula do celular é "Ajustes").
    expect(APP_AREAS.map(({ route, label }) => ({ route, label }))).toEqual(declared);
  });

  it('cada área abre o endereço da aba dela', () => {
    expect(APP_AREAS.map((area) => [area.key, area.href])).toEqual([
      ['hoje', '/'],
      ['compras', '/compras'],
      ['casa', '/casa'],
      ['saude', '/saude'],
      ['configuracoes', '/configuracoes'],
    ]);
    for (const area of APP_AREAS) {
      const file = area.route === 'index' ? 'index.tsx' : `${area.route}.tsx`;
      expect(readdirSync(join(APP_DIR, '(tabs)'))).toContain(file);
    }
  });

  it('toda tela de src/app tem a área dela decidida (ou nenhuma, de propósito)', () => {
    const screens = readdirSync(APP_DIR)
      .filter((name) => name !== '(tabs)' && !name.startsWith('_'))
      .map((name) => name.replace(/\.tsx$/, ''));
    expect(screens.length).toBeGreaterThan(40);
    // Uma tela nova precisa entrar em SCREEN_AREAS: sem isso, a barra lateral não acende nada enquanto ela está aberta.
    expect(screens.filter((name) => !(name in SCREEN_AREAS))).toEqual([]);
    // E nenhuma tela que já não existe fica para trás.
    expect(Object.keys(SCREEN_AREAS).filter((name) => !screens.includes(name))).toEqual([]);
    const areas = APP_AREAS.map((area) => area.key);
    for (const area of Object.values(SCREEN_AREAS)) {
      if (area !== null) expect(areas).toContain(area);
    }
  });

  it('a área da tela aberta, pelas partes do endereço', () => {
    expect(areaOfSegments([])).toBe('hoje');
    expect(areaOfSegments(['(tabs)'])).toBe('hoje');
    expect(areaOfSegments(['(tabs)', 'index'])).toBe('hoje');
    expect(areaOfSegments(['(tabs)', 'compras'])).toBe('compras');
    expect(areaOfSegments(['(tabs)', 'casa'])).toBe('casa');
    expect(areaOfSegments(['(tabs)', 'saude'])).toBe('saude');
    expect(areaOfSegments(['(tabs)', 'configuracoes'])).toBe('configuracoes');
    // As telas por cima das abas acendem a área de onde vêm.
    expect(areaOfSegments(['lista', '[id]'])).toBe('compras');
    expect(areaOfSegments(['lista', '[id]', 'onde-comprar'])).toBe('compras');
    expect(areaOfSegments(['nota', 'qrcode'])).toBe('compras');
    expect(areaOfSegments(['tarefa', '[id]'])).toBe('casa');
    expect(areaOfSegments(['consultor', 'lancamentos'])).toBe('casa');
    expect(areaOfSegments(['remedio', '[id]'])).toBe('saude');
    expect(areaOfSegments(['perfil'])).toBe('configuracoes');
    // O Nuke e uma tela que não existe não acendem nenhuma.
    expect(areaOfSegments(['nuke'])).toBeNull();
    expect(areaOfSegments(['nao-existe'])).toBeNull();
    expect(areaOfSegments(['(tabs)', 'nao-existe'])).toBeNull();
  });

  it('sabe quando a tela aberta é uma das abas', () => {
    expect(onTabs([])).toBe(true);
    expect(onTabs(['(tabs)'])).toBe(true);
    expect(onTabs(['(tabs)', 'casa'])).toBe(true);
    expect(onTabs(['lista', '[id]'])).toBe(false);
    expect(onTabs(['nuke'])).toBe(false);
  });
});

describe('os parâmetros que cada aba guarda', () => {
  const tabs: NavRoute = {
    name: '(tabs)',
    state: {
      routes: [
        { name: 'index' },
        { name: 'compras', params: { aba: 'notas' } },
        { name: 'casa', params: { aba: 'dia', dia: 'agenda', financas: '' } },
        { name: 'saude', params: { aba: 'planos', screen: { nested: true }, n: 3 } },
      ],
    },
  };
  // O roteador põe o layout da raiz dentro de um nó dele.
  const root: NavRoute[] = [{ name: '__root', state: { routes: [tabs, { name: 'lista/[id]/index', params: { id: 'abc' } }] } }];

  it('vêm do estado da navegação, só os de texto e com valor', () => {
    expect(tabParams(root, 'compras')).toEqual({ aba: 'notas' });
    expect(tabParams(root, 'casa')).toEqual({ aba: 'dia', dia: 'agenda' });
    expect(tabParams(root, 'saude')).toEqual({ aba: 'planos' });
    expect(tabParams(root, 'index')).toEqual({});
    // Também com as abas no primeiro nível.
    expect(tabParams([tabs], 'compras')).toEqual({ aba: 'notas' });
  });

  it('sem as abas no estado (a página abriu direto numa tela por cima), nenhum', () => {
    expect(tabParams(undefined, 'compras')).toEqual({});
    expect(tabParams([], 'compras')).toEqual({});
    expect(tabParams([{ name: '__root', state: { routes: [{ name: 'precos' }] } }], 'compras')).toEqual({});
    expect(tabParams([{ name: '(tabs)' }], 'compras')).toEqual({});
    expect(tabParams(root, 'configuracoes')).toEqual({});
  });

  it('entram no endereço do link da área', () => {
    expect(areaHref('/compras', {})).toBe('/compras');
    expect(areaHref('/compras', { aba: 'notas' })).toBe('/compras?aba=notas');
    expect(areaHref('/casa', { aba: 'dia', dia: 'agenda' })).toBe('/casa?aba=dia&dia=agenda');
    expect(areaHref('/saude', { pessoa: 'a b&c' })).toBe('/saude?pessoa=a%20b%26c');
  });
});
