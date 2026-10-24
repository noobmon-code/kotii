import { describe, expect, it } from '@jest/globals';

import { compareForShopping } from '../listItem';
import { listShareHint, listShareText, WHATSAPP_MAX_ENCODED, whatsappUrl, type ShareItem } from '../listShare';
import { SECTIONS_ABOVE } from '../listSections';

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
    // O último item é de outra categoria: com uma seção só não haveria título nenhum (ver abaixo).
    const toBuy = (n: number) =>
      Array.from({ length: n }, (_, i) => item(`Item ${i + 1}`, { category: i === n - 1 ? 'bebidas' : 'limpeza' }));
    const cart = Array.from({ length: 5 }, (_, i) => item(`Pego ${i + 1}`, inCart));
    expect(listShareText(mercado, [...toBuy(8), ...cart])).not.toContain('*Limpeza*');
    expect(listShareText(mercado, [...toBuy(9), ...cart])).toContain('\n\n*Limpeza*\n- Item 1\n');
  });

  it('uma seção só não ganha título: a lista toda de limpeza, ou toda em "Outros", vai corrida', () => {
    const all = (category: string) => Array.from({ length: 12 }, (_, i) => item(`Item ${i + 1}`, { category }));
    const lines = listShareText(mercado, all('limpeza'))!.split('\n');
    // O título e os 12 itens, sem linha em branco nem nome de seção.
    expect(lines).toHaveLength(13);
    expect(lines[0]).toBe('*Mercado* · 12 itens');
    expect(lines.slice(1).every((line) => line.startsWith('- Item '))).toBe(true);
    expect(listShareText({ name: 'Festa' }, all('outros'))).not.toContain('*Outros*');
    // Um urgente no meio já faz duas seções (Urgente e Limpeza): aí os títulos voltam.
    const withUrgent = [...all('limpeza').slice(1), item('Item 1', { category: 'limpeza', priority: 'urgente' })];
    expect(listShareText(mercado, withUrgent)).toContain('\n\n*Urgente*\n- Item 1\n\n*Limpeza*\n');
  });

  it('categoria desconhecida entra em "Outros", como na tela', () => {
    const items = [...longList, item('Coisa', { category: 'nao_existe' }), item('Pilha')];
    expect(listShareText(mercado, items)).toMatch(/\n\n\*Outros\*\n- Coisa\n- Pilha$/);
  });

  it('o que está no carrinho não vai no texto: quem recebe não tem carrinho; quem manda é avisado no menu', () => {
    const one = [item('Banana'), item('Café', inCart)];
    const two = [...one, item('Pão', inCart)];
    expect(listShareText(mercado, one)).toBe('*Mercado*\n- Banana');
    expect(listShareText(mercado, two)).toBe('*Mercado*\n- Banana');
    const base = 'Vai só o texto do que falta comprar: sem fotos e sem preços.';
    const bold = 'No WhatsApp, o que está entre asteriscos aparece em negrito.';
    expect(listShareHint([item('Banana')])).toBe(`${base} ${bold}`);
    expect(listShareHint(one)).toBe(`${base} O item que já está no carrinho não vai. ${bold}`);
    expect(listShareHint(two)).toBe(`${base} Os 2 itens que já estão no carrinho não vão. ${bold}`);
  });

  it('a observação já escrita entre parênteses não ganha outro par', () => {
    const line = (notes: string) => listShareText(mercado, [item('Leite', { notes })])!.split('\n')[1];
    expect(line('(sem lactose)')).toBe('- Leite (sem lactose)');
    expect(line('sem lactose')).toBe('- Leite (sem lactose)');
    // Só o par que envolve tudo sai; parênteses no meio ficam como estão.
    expect(line('(a) e (b)')).toBe('- Leite ((a) e (b))');
    expect(line('marca X (ou Y)')).toBe('- Leite (marca X (ou Y))');
    expect(line('()')).toBe('- Leite');
    expect(line('( )')).toBe('- Leite');
  });

  it('metade solta de um emoji sai do texto, e o link continua possível', () => {
    const broken = 'Festa \uD83C';
    const text = listShareText({ name: broken }, [item('Bolo \uD83C\uDF82', { notes: 'de chocolate \uDF82' })])!;
    expect(text).toBe('*Festa*\n- Bolo \uD83C\uDF82 (de chocolate)');
    expect(() => whatsappUrl(text)).not.toThrow();
    expect(whatsappUrl(text)).toContain('https://wa.me/?text=');
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
