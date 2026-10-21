import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Path } from 'react-native-svg';

import { toPurchases, type Purchase, type PurchaseLine } from '@/domain/priceHistory';
import { PriceChart } from '@/features/market/PriceChart';
import { PriceHistorySection } from '@/features/market/PriceHistorySection';
import { Badge, Button, Chip, ErrorNotice, ListRow, Loading, Segmented, Text } from '@/ui/primitives';

// A seção de verdade, com as regras de verdade (domain/priceHistory); só a busca das compras é trocada por
// respostas prontas. O que se confere aqui é o que a tela faz com elas e com os toques.

interface Query {
  data: Purchase[] | undefined;
  isError: boolean;
  error: unknown;
  /** 'paused': sem internet, a busca espera a conexão. */
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQuery: { current: Query; asked: string[] } = { current: { data: undefined, isError: false, error: null, refetch: jest.fn() }, asked: [] };

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/market', () => ({
  useProductPurchases: (productId: string) => {
    mockQuery.asked.push(productId);
    return mockQuery.current;
  },
}));
// Hoje é sempre 13 de outubro de 2026: os períodos contam para trás a partir daí.
jest.mock('@/domain/dates', () => ({
  ...jest.requireActual<typeof import('@/domain/dates')>('@/domain/dates'),
  todayISO: () => '2026-10-13',
}));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let serial = 0;
/** Uma linha de nota às 15h (hora do aparelho) do dia: 1 un no Assaí, a não ser que se diga outra coisa. */
function line(day: string, unitPrice: number, partial: Partial<PurchaseLine> = {}): PurchaseLine {
  const quantity = partial.quantity ?? 1;
  serial += 1;
  return {
    id: `i${serial}`,
    receiptId: `r-${day}`,
    storeId: 'assai',
    storeName: 'Assaí',
    purchasedAt: new Date(`${day}T15:00:00`).toISOString(),
    quantity,
    unit: 'un',
    unitPrice,
    totalPrice: Math.round(quantity * unitPrice * 100) / 100,
    ...partial,
  };
}
const atacadao = { storeId: 'atacadao', storeName: 'Atacadão' };

/** Arroz: quatro compras nos últimos 6 meses (uma no Atacadão, uma com desconto) e uma do ano passado. */
const rice = () =>
  toPurchases([
    line('2026-10-10', 25.9, { quantity: 2 }),
    line('2026-09-03', 27.9, { totalPrice: 24.9 }),
    line('2026-08-12', 21.9, atacadao),
    line('2026-07-12', 22.9),
    line('2025-11-02', 19.9),
  ]);

const loaded = (data: Purchase[]): Query => ({ data, isError: false, error: null, refetch: jest.fn() });

let renderer: ReactTestRenderer | undefined;

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

/** Tudo o que a seção escreve, na ordem da tela, um texto por linha. */
const page = () => texts(renderer!.toJSON()).join('\n');

async function mount(query: Query) {
  mockQuery.current = query;
  await act(async () => {
    renderer = create(<PriceHistorySection productId="arroz" productName="Arroz" />);
  });
  return page();
}

const chips = () => renderer!.root.findAllByType(Chip).map((chip) => `${chip.props.selected ? '[x]' : '[ ]'} ${chip.props.label}`);
const press = (label: string) => act(() => renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === label)!.props.onPress());
const rows = () => renderer!.root.findAllByType(ListRow).map((row) => `${row.props.title} · ${row.props.subtitle}`);

beforeEach(() => {
  mockQuery.asked = [];
  jest.mocked(router.push).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('o histórico de preço na tela do produto', () => {
  it('o resumo, os chips e as compras, na ordem da tela', async () => {
    expect(await mount(loaded(rice()))).toBe(
      [
        'Histórico de preço',
        '3 meses',
        '6 meses',
        '1 ano',
        'Tudo',
        'Todos',
        'Assaí',
        'Atacadão',
        'R$ 25,90/un · Assaí · 10 out',
        'Subiu 13% desde 12 jul (era R$ 22,90)',
        'Menor: R$ 21,90 (Atacadão, 12 ago) · Maior: R$ 27,90 (Assaí, 3 set)',
        'Costuma custar R$ 24,40',
        '4 compras em 6 meses',
        // O gráfico: o maior e o menor preço à esquerda, a primeira e a última data embaixo.
        'R$ 27,90',
        'R$ 21,90',
        '12 jul',
        '10 out',
        'Assaí',
        '10 out · 2 un · pagou R$ 51,80',
        'R$ 25,90/un',
        'Assaí',
        '3 set · 1 un · pagou R$ 24,90',
        'R$ 27,90/un',
        'com desconto',
        'Atacadão',
        '12 ago · 1 un · pagou R$ 21,90',
        'R$ 21,90/un',
        'Assaí',
        '12 jul · 1 un · pagou R$ 22,90',
        'R$ 22,90/un',
      ].join('\n'),
    );
    expect(mockQuery.asked).toContain('arroz');
    expect(chips()).toEqual(['[ ] 3 meses', '[x] 6 meses', '[ ] 1 ano', '[ ] Tudo', '[x] Todos', '[ ] Assaí', '[ ] Atacadão']);
    // Só a compra que saiu por menos leva o selo.
    expect(renderer!.root.findAllByType(Badge).map((badge) => badge.props.label)).toEqual(['com desconto']);
  });

  it('o gráfico diz o mesmo em palavras, e desenha a linha quando sabe a largura', async () => {
    await mount(loaded(rice()));
    const chart = renderer!.root.findByType(PriceChart);
    const image = chart.findByProps({ accessibilityRole: 'image' });
    expect(image.props.accessibilityLabel).toBe('Preço de Arroz de 12 jul a 10 out: de R$ 21,90 a R$ 27,90; o último, R$ 25,90');
    expect(chart.findAllByType(Path)).toHaveLength(0);
    act(() => chart.findAll((node) => typeof node.props.onLayout === 'function')[0].props.onLayout({ nativeEvent: { layout: { width: 180 } } }));
    // Quatro compras: a linha passa pelos quatro pontos, do mais antigo (à esquerda) ao mais recente (à direita).
    const [path] = chart.findAllByType(Path);
    expect(String(path.props.d).split(' L')).toHaveLength(4);
    expect(String(path.props.d).startsWith('M10 ')).toBe(true);
    expect(String(path.props.d)).toContain('L170 ');
  });

  it('o período muda o que aparece', async () => {
    await mount(loaded(rice()));
    press('3 meses');
    expect(chips().slice(0, 4)).toEqual(['[x] 3 meses', '[ ] 6 meses', '[ ] 1 ano', '[ ] Tudo']);
    expect(page()).toContain('Subiu 18% desde 12 ago (era R$ 21,90, em outro mercado: Atacadão)');
    expect(page()).toContain('3 compras em 3 meses');
    expect(rows()).toHaveLength(3);
    press('Tudo');
    expect(page()).toContain('Subiu 30% desde 2 nov 2025 (era R$ 19,90)');
    expect(page()).toContain('5 compras');
    expect(rows().at(-1)).toBe('Assaí · 2 nov 2025 · 1 un · pagou R$ 19,90');
  });

  it('o mercado escolhido filtra tudo; "Todos" volta', async () => {
    await mount(loaded(rice()));
    press('Atacadão');
    expect(chips().slice(4)).toEqual(['[ ] Todos', '[ ] Assaí', '[x] Atacadão']);
    expect(rows()).toEqual(['Atacadão · 12 ago · 1 un · pagou R$ 21,90']);
    expect(page()).toContain('R$ 21,90/un · Atacadão · 12 ago');
    expect(page()).toContain('1 compra em 6 meses');
    // Uma compra só: sem gráfico.
    expect(renderer!.root.findAllByType(PriceChart)).toHaveLength(0);
    press('Todos');
    expect(rows()).toHaveLength(4);
    expect(renderer!.root.findAllByType(PriceChart)).toHaveLength(1);
  });

  it('com um mercado só não há chips de mercado; com uma unidade só, nada a trocar', async () => {
    await mount(loaded(toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 27.9)])));
    expect(chips()).toEqual(['[ ] 3 meses', '[x] 6 meses', '[ ] 1 ano', '[ ] Tudo']);
    expect(renderer!.root.findAllByType(Segmented)).toHaveLength(0);
  });

  it('produto comprado por kg e por unidade: uma unidade de cada vez, com a troca à vista', async () => {
    const banana = toPurchases([
      line('2026-10-10', 6.99, { quantity: 1.2, unit: 'kg', totalPrice: 8.39 }),
      line('2026-09-20', 0.0059, { quantity: 800, unit: 'g', totalPrice: 4.72 }),
      line('2026-10-01', 0.9, { quantity: 6 }),
    ]);
    const text = await mount(loaded(banana));
    const [toggle] = renderer!.root.findAllByType(Segmented);
    expect(toggle.props.options).toEqual([
      { value: 'un', label: 'por unidade' },
      { value: 'kg', label: 'por kg' },
    ]);
    expect(toggle.props.value).toBe('kg');
    expect(text).toContain('R$ 6,99/kg · Assaí · 10 out');
    expect(rows()).toEqual(['Assaí · 10 out · 1,2 kg · pagou R$ 8,39', 'Assaí · 20 set · 800 g · pagou R$ 4,72']);
    expect(text).not.toContain('/un');
    act(() => toggle.props.onChange('un'));
    expect(rows()).toEqual(['Assaí · 1 out · 6 un · pagou R$ 5,40']);
    expect(page()).toContain('R$ 0,90/un · Assaí · 1 out');
    expect(page()).not.toContain('/kg');
    // Uma compra só por unidade: o período padrão dela é "Tudo".
    expect(chips()).toEqual(['[ ] 3 meses', '[ ] 6 meses', '[ ] 1 ano', '[x] Tudo']);
  });

  it('"Ver mais" mostra quantas faltam e traz as seguintes; trocar o período volta às primeiras', async () => {
    const many = toPurchases(Array.from({ length: 35 }, (_, n) => line(`2026-${n < 10 ? '09' : n < 25 ? '08' : '07'}-${String(10 + (n % 15)).padStart(2, '0')}`, 20 + (n % 7))));
    expect(many).toHaveLength(35);
    await mount(loaded(many));
    expect(rows()).toHaveLength(10);
    const more = () => renderer!.root.findAllByType(Button).find((button) => String(button.props.title).startsWith('Ver mais'));
    expect(more()!.props.title).toBe('Ver mais (faltam 25)');
    // O leitor de tela ouve de qual lista é: a tela do produto tem também os "Ver mais" dos preços de outras casas.
    expect(more()!.props.accessibilityLabel).toBe('Ver mais (faltam 25) do histórico de preço');
    act(() => more()!.props.onPress());
    expect(rows()).toHaveLength(30);
    expect(more()!.props.title).toBe('Ver mais (faltam 5)');
    act(() => more()!.props.onPress());
    expect(rows()).toHaveLength(35);
    expect(more()).toBeUndefined();
    press('Tudo');
    expect(rows()).toHaveLength(10);
    expect(more()!.props.title).toBe('Ver mais (faltam 25)');
  });

  it('tocar numa compra abre a nota dela', async () => {
    await mount(loaded(rice()));
    act(() => renderer!.root.findAllByType(ListRow)[2].props.onPress());
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'r-2026-08-12' } });
  });

  it('período sem compras: a frase diz onde ver, sem gráfico nem lista', async () => {
    await mount(loaded(toPurchases([line('2026-05-10', 25.9), line('2026-04-20', 22.9)])));
    press('3 meses');
    expect(page()).toBe(['Histórico de preço', '3 meses', '6 meses', '1 ano', 'Tudo', 'Nenhuma compra nos últimos 3 meses. Veja em "Tudo".'].join('\n'));
    expect(rows()).toEqual([]);
    press('Tudo');
    expect(rows()).toHaveLength(2);
  });

  it('carregando: só a seção espera', async () => {
    expect(await mount({ data: undefined, isError: false, error: null, refetch: jest.fn() })).toBe('Histórico de preço');
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(1);
  });

  it('a busca falhou: o erro da seção, com "Tentar de novo"', async () => {
    const query: Query = { data: undefined, isError: true, error: new Error('Sem conexão.'), refetch: jest.fn() };
    // Entre o título e a mensagem vem o ícone do aviso (um caractere da fonte de ícones).
    const text = (await mount(query)).split('\n');
    expect([text[0], ...text.slice(-2)]).toEqual(['Histórico de preço', 'Sem conexão.', 'Tentar de novo']);
    expect(renderer!.root.findAllByType(Chip)).toHaveLength(0);
    act(() => renderer!.root.findByType(ErrorNotice).props.onRetry());
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('atualização que falhou com o histórico já na tela não o tira dela', async () => {
    const text = await mount({ ...loaded(rice()), isError: true, error: new Error('Sem conexão.') });
    expect(text).toContain('4 compras em 6 meses');
    expect(text).not.toContain('Sem conexão.');
    expect(rows()).toHaveLength(4);
  });

  it('sem internet e sem o histórico no aparelho: um aviso no lugar de girar sem fim', async () => {
    const text = (await mount({ data: undefined, isError: false, error: null, fetchStatus: 'paused', refetch: jest.fn() })).split('\n');
    expect([text[0], text.at(-1)]).toEqual(['Histórico de preço', 'Sem internet: o histórico de preço aparece quando a conexão voltar.']);
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(0);
    // A busca segue sozinha quando a conexão volta: não há o que tentar de novo.
    expect(renderer!.root.findByType(ErrorNotice).props.onRetry).toBeUndefined();
  });

  it('produto sem nenhuma nota confirmada: a seção não aparece (a tela já diz isso logo acima)', async () => {
    expect(await mount(loaded([]))).toBe('');
    expect(renderer!.toJSON()).toBeNull();
  });

  it('compra sem valor: fica na lista dizendo "sem valor", e o resumo não a conta como preço', async () => {
    const text = await mount(loaded(toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 0, { quantity: 2, totalPrice: 0 }), line('2026-07-12', 22.9)])));
    expect(text).toContain('Subiu 13% desde 12 jul (era R$ 22,90)');
    expect(text).toContain('Menor: R$ 22,90 (Assaí, 12 jul) · Maior: R$ 25,90 (Assaí, 10 out)');
    expect(text).toContain('2 compras e 1 sem valor em 6 meses');
    expect(text).not.toContain('R$ 0,00');
    expect(rows()).toEqual(['Assaí · 10 out · 1 un · pagou R$ 25,90', 'Assaí · 3 set · 2 un · sem valor', 'Assaí · 12 jul · 1 un · pagou R$ 22,90']);
    // À direita, onde iria o preço.
    expect(text.split('\n').filter((t) => t === 'sem valor')).toHaveLength(1);
  });

  it('produto só com compras sem valor: a lista e uma frase no lugar do resumo, sem gráfico', async () => {
    const text = await mount(loaded(toPurchases([line('2026-10-10', 0, { totalPrice: 0 }), line('2026-09-03', 0, { totalPrice: 0 })])));
    expect(text).toBe(
      ['Histórico de preço', '3 meses', '6 meses', '1 ano', 'Tudo', 'Nenhuma compra com valor ainda.', 'Assaí', '10 out · 1 un · sem valor', 'sem valor', 'Assaí', '3 set · 1 un · sem valor', 'sem valor'].join('\n'),
    );
    expect(renderer!.root.findAllByType(PriceChart)).toHaveLength(0);
    // A frase é um aviso, não a última compra em destaque.
    const notice = renderer!.root.findAllByType(Text).find((node) => node.props.children === 'Nenhuma compra com valor ainda.')!;
    expect(notice.props.variant).toBe('muted');
  });

  it('duas lojas com o mesmo nome: um chip só, que mostra as compras das duas', async () => {
    const sendas = (storeId: string) => ({ storeId, storeName: 'Sendas Distribuidora S/A' });
    const text = await mount(loaded(toPurchases([line('2026-10-10', 25.9, sendas('sendas-1')), line('2026-09-03', 23.9, sendas('sendas-2')), line('2026-08-12', 21.9, atacadao)])));
    expect(chips().slice(4)).toEqual(['[x] Todos', '[ ] Atacadão', '[ ] Sendas Distribuidora S/A']);
    expect(text).not.toContain('em outro mercado: Sendas');
    press('Sendas Distribuidora S/A');
    expect(rows()).toEqual(['Sendas Distribuidora S/A · 10 out · 1 un · pagou R$ 25,90', 'Sendas Distribuidora S/A · 3 set · 1 un · pagou R$ 23,90']);
    expect(page()).toContain('Subiu 8% desde 3 set (era R$ 23,90)');
    expect(page()).not.toContain('outro mercado');
  });

  it('mercado escolhido, depois um período sem ele, depois um período com ele: o filtro não volta sozinho', async () => {
    await mount(
      loaded(
        toPurchases([
          line('2026-10-10', 25.9),
          line('2026-09-03', 27.9),
          line('2026-06-12', 21.9, atacadao),
          line('2025-11-02', 19.9, atacadao),
          line('2026-05-02', 23.9, { storeId: 'extra', storeName: 'Extra' }),
          line('2026-04-02', 22.9, { storeId: null, storeName: null }),
        ]),
      ),
    );
    press('Atacadão');
    expect(chips().slice(4)).toEqual(['[ ] Todos', '[ ] Assaí', '[x] Atacadão', '[ ] Extra']);
    expect(rows()).toEqual(['Atacadão · 12 jun · 1 un · pagou R$ 21,90']);
    // Em 3 meses só há Assaí: sem chips de mercado, todas as compras do período.
    press('3 meses');
    expect(chips()).toEqual(['[x] 3 meses', '[ ] 6 meses', '[ ] 1 ano', '[ ] Tudo']);
    expect(rows()).toHaveLength(2);
    // Em 1 ano o Atacadão volta a ter chip, mas ninguém tocou nele.
    press('1 ano');
    expect(chips().slice(4)).toEqual(['[x] Todos', '[ ] Assaí', '[ ] Atacadão', '[ ] Extra', '[ ] Mercado não informado']);
    expect(rows()).toHaveLength(6);
    expect(page()).toContain('6 compras em 1 ano');
  });

  it('na troca de unidade, o mercado que não tem compra na outra unidade também não volta sozinho', async () => {
    await mount(
      loaded(
        toPurchases([
          line('2026-10-10', 6.99, { unit: 'kg' }),
          line('2026-09-10', 5.99, { unit: 'kg', ...atacadao }),
          line('2026-08-10', 5.49, { unit: 'kg' }),
          line('2026-10-01', 0.9),
          line('2026-09-01', 0.8),
          line('2025-10-20', 0.7, atacadao),
        ]),
      ),
    );
    press('Atacadão');
    expect(rows()).toEqual(['Atacadão · 10 set · 1 kg · pagou R$ 5,99']);
    act(() => renderer!.root.findByType(Segmented).props.onChange('un'));
    // Por unidade, nos 6 meses, só há Assaí.
    expect(chips()).toEqual(['[ ] 3 meses', '[x] 6 meses', '[ ] 1 ano', '[ ] Tudo']);
    expect(rows()).toHaveLength(2);
    press('Tudo');
    expect(chips().slice(4)).toEqual(['[x] Todos', '[ ] Assaí', '[ ] Atacadão']);
    expect(rows()).toHaveLength(3);
  });

  it('nome de mercado comprido: o chip tem a largura da linha como limite (na web ele não encolhe sozinho)', async () => {
    const long = { storeId: 'bh', storeName: 'SUPERMERCADOS BH COMERCIO DE ALIMENTOS S/A' };
    await mount(loaded(toPurchases([line('2026-10-10', 25.9, long), line('2026-09-03', 27.9)])));
    const storeChips = renderer!.root.findAllByType(Chip).slice(4);
    expect(storeChips.map((chip) => chip.props.label)).toEqual(['Todos', 'Assaí', 'SUPERMERCADOS BH COMERCIO DE ALIMENTOS S/A']);
    for (const chip of storeChips) expect(StyleSheet.flatten(chip.parent!.props.style)).toMatchObject({ maxWidth: '100%' });
  });

  it('pacotes de 5 kg e de 1 kg: o resumo compara o preço por kg, e cada compra diz o tamanho', async () => {
    const text = await mount(
      loaded(
        toPurchases([
          line('2026-10-10', 24.9, { description: 'ARROZ TIO JOAO T1 5KG' }),
          line('2026-08-12', 5.49, { description: 'ARROZ TIO JOAO T1 1KG' }),
          // Sem tamanho na nota: fica por unidade, à parte.
          line('2026-07-12', 19.9, { description: 'ARROZ TIO JOAO' }),
        ]),
      ),
    );
    const [toggle] = renderer!.root.findAllByType(Segmented);
    expect(toggle.props.value).toBe('kg');
    expect(text).toContain('R$ 4,98/kg · Assaí · 10 out');
    expect(text).toContain('Caiu 9% desde 12 ago (era R$ 5,49)');
    expect(text).toContain(
      ['10 out · 1 un · pagou R$ 24,90', '5 kg · R$ 4,98/kg', 'R$ 24,90/un', 'Assaí', '12 ago · 1 un · pagou R$ 5,49', '1 kg · R$ 5,49/kg', 'R$ 5,49/un'].join('\n'),
    );
    act(() => toggle.props.onChange('un'));
    expect(page()).toContain('R$ 19,90/un · Assaí · 12 jul');
    expect(page()).not.toContain('/kg');
  });
});
