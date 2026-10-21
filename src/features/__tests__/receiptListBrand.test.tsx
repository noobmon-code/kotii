import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { OpenListEntry } from '@/data/market';
import { LinkIndex, matchListItems } from '@/domain/listLinks';
import { ReceiptListSection } from '@/features/ReceiptListSection';

// Revisão da nota com "Marca preferida": a ligação com outra marca (aprendida antes da escolha) vem como pergunta.

jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

describe('a ligação com outra marca num item com "Marca preferida"', () => {
  const item: OpenListEntry = {
    id: 'l1',
    list_id: 'm1',
    list_name: 'Mercado',
    name: 'Leite IL Desnatado',
    category: 'laticinios',
    product_id: 'il',
    checked_at: null,
    brand: true,
  };
  const line = { id: 'r1', productId: 'italac', name: 'Leite Italac Desnatado', names: ['Leite Italac Desnatado'], category: 'laticinios' };
  const links = new LinkIndex([{ name_key: 'leite il desnatado', product_id: 'italac' }]);

  const shown = async (entry: OpenListEntry) => {
    const matches = matchListItems([entry], [line], links);
    await act(async () => {
      renderer = create(<ReceiptListSection listItems={[entry]} matches={matches} receipt={[line]} onChoose={() => undefined} />);
    });
    return texts(renderer!.toJSON()).join('\n');
  };

  it('vem desmarcada, dizendo que é outra marca, com "Comprou este?"', async () => {
    const page = await shown(item);
    expect(page).toContain('Na nota: Leite Italac Desnatado');
    expect(page).toContain('Ligado numa nota anterior, mas é outra marca: confira');
    expect(page).toContain('Comprou este?');
  });

  it('sem a escolha, a ligação vem marcada como sempre', async () => {
    const page = await shown({ ...item, brand: false });
    expect(page).toContain('Comprado: Leite Italac Desnatado');
    expect(page).toContain('Ligado numa nota anterior');
    expect(page).not.toContain('outra marca');
  });
});
