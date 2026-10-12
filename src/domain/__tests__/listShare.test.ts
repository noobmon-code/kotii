import { describe, expect, it } from '@jest/globals';

import { compareForShopping } from '../listItem';
import { listShareText, SECTIONS_ABOVE, WHATSAPP_MAX_ENCODED, whatsappUrl, type ShareItem } from '../listShare';

const item = (name: string, over: Partial<ShareItem> = {}): ShareItem => ({
  name,
  category: 'outros',
  quantity: 1,
  unit: 'un',
  notes: null,
  priority: 'normal',
  checked_at: null,
  ...over,
});

const inCart = { checked_at: '2026-10-12T10:00:00Z' };
const mercado = { name: 'Mercado' };

/** Uma lista de mercado com 12 itens a comprar, fora de ordem, e 2 no carrinho. */
const longList: ShareItem[] = [
  item('Detergente', { category: 'limpeza', quantity: 2 }),
  item('Arroz', { category: 'graos', quantity: 5, unit: 'kg' }),
  item('Tomate', { category: 'hortifruti', quantity: 0.5, unit: 'kg' }),
  item('Leite integral', { category: 'laticinios', quantity: 6, priority: 'urgente' }),
  item('Banana', { category: 'hortifruti' }),
  item('Queijo minas', { category: 'laticinios', priority: 'se_der' }),
  item('Sabão em pó', { category: 'limpeza', notes: 'o de 1,6 kg, caixa azul', priority: 'promocao' }),
  item('Fralda', { category: 'bebe', notes: 'tamanho G', priority: 'urgente' }),
  item('Suco de uva', { category: 'bebidas', quantity: 1.5, unit: 'l' }),
  item('Presunto', { category: 'frios', quantity: 500, unit: 'g' }),
  item('Feijão', { category: 'graos' }),
  item('Papel higiênico', { category: 'papel' }),
  item('Café', { category: 'cafe_cha', ...inCart }),
  item('Pão francês', { category: 'padaria', quantity: 6, ...inCart }),
];

describe('listShareText', () => {
  it('lista curta: o nome em negrito com a contagem e os itens na ordem dos corredores, sem seções', () => {
    const text = listShareText(mercado, [
      item('Detergente', { category: 'limpeza' }),
      item('Leite integral', { category: 'laticinios', quantity: 2 }),
      item('Banana', { category: 'hortifruti' }),
    ]);
    expect(text).toBe(['*Mercado* · 3 itens', '- Banana', '- 2 un Leite integral', '- Detergente'].join('\n'));
  });

  it('um item só: sem a contagem', () => {
    expect(listShareText({ name: 'Farmácia' }, [item('Dipirona', { category: 'medicamentos', notes: 'em gotas' })])).toBe(
      '*Farmácia*\n- Dipirona (em gotas)',
    );
  });

  it('quantidade e unidade como no resto do app; 1 un sai só com o nome', () => {
    const lines = (over: Partial<ShareItem>) => listShareText(mercado, [item('Item', over)])!.split('\n')[1];
    expect(lines({ quantity: 1, unit: 'un' })).toBe('- Item');
    expect(lines({ quantity: 2, unit: 'un' })).toBe('- 2 un Item');
    expect(lines({ quantity: 0.5, unit: 'kg' })).toBe('- 0,5 kg Item');
    expect(lines({ quantity: 500, unit: 'g' })).toBe('- 500 g Item');
    expect(lines({ quantity: 1.5, unit: 'l' })).toBe('- 1,5 l Item');
    // Só "1 un" some: 1 kg é uma medida.
    expect(lines({ quantity: 1, unit: 'kg' })).toBe('- 1 kg Item');
    // O banco pode entregar o número como texto.
    expect(lines({ quantity: '2' as unknown as number, unit: 'un' })).toBe('- 2 un Item');
    expect(lines({ quantity: '1' as unknown as number, unit: 'un' })).toBe('- Item');
  });

  it('a descrição vai entre parênteses, numa linha só', () => {
    const text = listShareText(mercado, [
      item('Sabão em pó', { notes: ' o de 1,6 kg,\ncaixa azul ' }),
      item('Sal', { notes: '   ' }),
    ]);
    expect(text).toBe(['*Mercado* · 2 itens', '- Sabão em pó (o de 1,6 kg, caixa azul)', '- Sal'].join('\n'));
  });

  it('prioridade com as palavras do app; normal não diz nada e os urgentes vêm primeiro', () => {
    const text = listShareText(mercado, [
      item('Arroz', { category: 'graos' }),
      item('Chocolate', { category: 'doces', priority: 'se_der' }),
      item('Sabão em pó', { category: 'limpeza', notes: 'caixa azul', priority: 'promocao' }),
      item('Leite', { category: 'laticinios', quantity: 2, priority: 'urgente' }),
      item('Sal', { category: 'temperos', priority: null }),
    ]);
    expect(text).toBe(
      [
        '*Mercado* · 5 itens',
        '- 2 un Leite · urgente',
        '- Arroz',
        '- Chocolate · se der',
        '- Sal',
        '- Sabão em pó (caixa azul) · só em promoção',
      ].join('\n'),
    );
  });

  it('lista longa: seções com os nomes das categorias, na ordem da tela, e os urgentes na seção deles', () => {
    expect(listShareText(mercado, longList)).toBe(
      [
        '*Mercado* · 12 itens',
        '',
        '*Urgente*',
        '- 6 un Leite integral',
        '- Fralda (tamanho G)',
        '',
        '*Frutas e verduras*',
        '- Banana',
        '- 0,5 kg Tomate',
        '',
        '*Laticínios*',
        '- Queijo minas · se der',
        '',
        '*Grãos, massas e cereais*',
        '- 5 kg Arroz',
        '- Feijão',
        '',
        '*Frios e embutidos*',
        '- 500 g Presunto',
        '',
        '*Bebidas*',
        '- 1,5 l Suco de uva',
        '',
        '*Limpeza*',
        '- 2 un Detergente',
        '- Sabão em pó (o de 1,6 kg, caixa azul) · só em promoção',
        '',
        '*Papel e descartáveis*',
        '- Papel higiênico',
        '',
        'Já no carrinho: 2 itens',
      ].join('\n'),
    );
  });

  it('os itens saem na mesma ordem de "Para comprar" na tela, com ou sem seções', () => {
    const names = (items: ShareItem[]) =>
      listShareText(mercado, items)!
        .split('\n')
        .filter((line) => line.startsWith('- '))
        // O nome é o que sobra depois da quantidade e antes da descrição ou da prioridade.
        .map((line) => line.replace(/^- (\d+(,\d+)? (un|kg|g|l|ml) )?/, '').replace(/ [(·].*$/, ''));
    const onScreen = (items: ShareItem[]) => items.filter((i) => !i.checked_at).sort(compareForShopping).map((i) => i.name);
    expect(names(longList)).toEqual(onScreen(longList));
    const short = longList.slice(0, 6);
    expect(names(short)).toEqual(onScreen(short));
  });

  it(`as seções só aparecem com mais de ${SECTIONS_ABOVE} itens a comprar (os do carrinho não contam)`, () => {
    expect(SECTIONS_ABOVE).toBe(8);
    const toBuy = (n: number) => Array.from({ length: n }, (_, i) => item(`Item ${i + 1}`, { category: 'limpeza' }));
    const cart = Array.from({ length: 5 }, (_, i) => item(`Pego ${i + 1}`, inCart));
    expect(listShareText(mercado, [...toBuy(8), ...cart])).not.toContain('*Limpeza*');
    expect(listShareText(mercado, [...toBuy(9), ...cart])).toContain('\n\n*Limpeza*\n- Item 1\n');
  });

  it('categoria desconhecida entra em "Outros", como na tela', () => {
    const items = [...longList, item('Coisa', { category: 'nao_existe' }), item('Pilha')];
    expect(listShareText(mercado, items)).toContain('\n\n*Outros*\n- Coisa\n- Pilha\n');
  });

  it('o que está no carrinho não é listado: só a contagem, na última linha', () => {
    const text = listShareText(mercado, [item('Banana'), item('Café', inCart)])!;
    expect(text).toBe('*Mercado*\n- Banana\n\nJá no carrinho: 1 item');
    expect(listShareText(mercado, [item('Banana'), item('Café', inCart), item('Pão', inCart)])).toMatch(
      /\n\nJá no carrinho: 2 itens$/,
    );
    expect(listShareText(mercado, [item('Banana')])).not.toContain('carrinho');
  });

  it('sem nada para comprar não há texto: lista vazia ou tudo no carrinho', () => {
    expect(listShareText(mercado, [])).toBeNull();
    expect(listShareText(mercado, [item('Café', inCart), item('Pão', inCart)])).toBeNull();
  });

  it('não mexe na lista que recebeu', () => {
    const items = [item('Sal', { category: 'temperos' }), item('Banana', { category: 'hortifruti' })];
    listShareText(mercado, items);
    expect(items.map((i) => i.name)).toEqual(['Sal', 'Banana']);
  });

  it('sinais de formatação do WhatsApp no nome da lista não quebram o negrito do título', () => {
    const title = (name: string) => listShareText({ name }, [item('Banana')])!.split('\n')[0];
    expect(title('Mercado *do mês*')).toBe('*Mercado do mês*');
    expect(title('*Feira*')).toBe('*Feira*');
    expect(title('Compras_da_semana')).toBe('*Compras da semana*');
    expect(title('~Farmácia~ `já`')).toBe('*Farmácia já*');
    // O negrito do WhatsApp não aceita espaço colado nos asteriscos.
    expect(title('  Mercado  ')).toBe('*Mercado*');
    expect(title('***')).toBe('*Lista de compras*');
    // Em toda linha de título, os asteriscos são só os dois do negrito.
    for (const name of ['Mercado *do mês*', '*', 'a*b*c', '`~_*']) {
      expect(title(name)).toMatch(/^\*[^*_~`]+\*$/);
    }
  });

  it('nos itens, os sinais ficam como foram digitados, cada um na sua linha; a crase vira apóstrofo', () => {
    const text = listShareText(mercado, [
      item('Leite *sem lactose*', { notes: '~1 l, marca_x ou marca_y' }),
      item('Queijo ```ralado', { notes: 'caixa d`água ```' }),
    ])!;
    expect(text.split('\n')).toEqual([
      '*Mercado* · 2 itens',
      '- Leite *sem lactose* (~1 l, marca_x ou marca_y)',
      "- Queijo '''ralado (caixa d'água ''')",
    ]);
    expect(text).not.toContain('`');
  });
});

describe('whatsappUrl', () => {
  const sentText = (url: string) => decodeURIComponent(url.slice('https://wa.me/?text='.length));

  it('link do WhatsApp sem número, com o texto codificado', () => {
    expect(whatsappUrl('*Mercado*\n- Banana')).toBe('https://wa.me/?text=*Mercado*%0A-%20Banana');
  });

  it('acentos, quebras de linha e sinais chegam inteiros', () => {
    const text = listShareText({ name: 'Farmácia & cia' }, [
      ...longList,
      item('Pão de açúcar #2', { notes: '50% + 1? "já" = não/sim; a&b' }),
    ])!;
    const url = whatsappUrl(text)!;
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(sentText(url)).toBe(text);
    // Nada no texto escapa da codificação e vira outro parâmetro ou âncora do link.
    expect(url.slice('https://wa.me/?text='.length)).not.toMatch(/[&#\s]/);
    expect(new URL(url).searchParams.get('text')).toBe(text);
  });

  it('o limite vale para o texto já codificado: até ele sai o link, acima dele não', () => {
    expect(WHATSAPP_MAX_ENCODED).toBe(6000);
    expect(whatsappUrl('a'.repeat(6000))).toBe(`https://wa.me/?text=${'a'.repeat(6000)}`);
    expect(whatsappUrl('a'.repeat(6001))).toBeNull();
    // "ã" ocupa 6 caracteres no link (%C3%A3): mil deles cabem, mil e um não.
    expect(whatsappUrl('ã'.repeat(1000))).not.toBeNull();
    expect(whatsappUrl('ã'.repeat(1001))).toBeNull();
  });
});
