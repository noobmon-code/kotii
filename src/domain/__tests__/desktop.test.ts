import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  APP_AREAS,
  areaHref,
  areaOfSegments,
  DESKTOP_CONTENT_WIDTH,
  DESKTOP_MIN_WIDTH,
  DESKTOP_PANEL_SIDE_WIDTH,
  DESKTOP_SIDE_MAX_SHARE,
  DESKTOP_SIDE_WIDTH,
  isDesktop,
  onTabs,
  SCREEN_AREAS,
  SIDEBAR_MARGIN,
  SIDEBAR_SPACE,
  SIDEBAR_WIDTH,
  tabParams,
  type NavRoute,
} from '../desktop';

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
