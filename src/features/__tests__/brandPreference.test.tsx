import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { brandChoice } from '@/domain/genericItem';
import { ListItemEditor, type ItemDetails } from '@/features/ListItemEditor';
import type { ShoppingListItem } from '@/lib/types';
import { Button, Chip, Text, TextField } from '@/ui/primitives';

// "Marca preferida" nos detalhes do item da lista: ligada, o nome do item vira o do produto (com a marca);
// desligada, o nome sem a marca. Sem coluna no banco: o estado é o próprio nome.

jest.mock('@/data/images', () => ({ pickImages: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

const MILK = { id: 'il', name: 'Leite IL Desnatado', category: 'laticinios' };

const listItem = (name: string, product_id: string | null = MILK.id): ShoppingListItem => ({
  id: 'a',
  list_id: 'l1',
  product_id,
  name,
  category: 'laticinios',
  quantity: 1,
  unit: 'un',
  notes: null,
  priority: 'normal',
  photo_path: null,
  checked_at: null,
  checked_by: null,
  toggle_token: 'selo',
  created_at: '2026-10-01T12:00:00Z',
});

async function open(item: ShoppingListItem, product: { name: string; category: string } | null = MILK) {
  const onSave = jest.fn<(details: ItemDetails) => void>();
  await act(async () => {
    renderer = create(
      <ListItemEditor
        item={item}
        photoUri={null}
        photoPending={false}
        brand={brandChoice(product)}
        onSave={onSave}
        onRemove={jest.fn()}
        onClose={jest.fn()}
      />,
    );
  });
  return onSave;
}

const brandChip = () => renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === 'Marca preferida');
const nameField = () => renderer!.root.findAllByType(TextField).find((field) => field.props.label === 'Nome')!;
const texts = () => renderer!.root.findAllByType(Text).map((text) => [text.props.children].flat().join(''));
const save = () => act(() => renderer!.root.findAllByType(Button).find((button) => button.props.title === 'Salvar')!.props.onPress());

describe('"Marca preferida" nos detalhes do item', () => {
  it('item sem marca: desligada; ligar põe o nome do produto, e salvar grava esse nome', async () => {
    const onSave = await open(listItem('Leite desnatado'));
    expect(brandChip()!.props.selected).toBe(false);
    expect(texts()).toContain('Qualquer marca serve. Ligue para pedir Leite IL Desnatado.');
    act(() => brandChip()!.props.onPress());
    expect(nameField().props.value).toBe('Leite IL Desnatado');
    expect(brandChip()!.props.selected).toBe(true);
    expect(texts()).toContain('A lista pede Leite IL Desnatado. Na nota, só esse produto tira o item da lista.');
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite IL Desnatado' }), { kind: 'keep' });
  });

  it('item com a marca (ou de antes, com o nome do produto): ligada; desligar volta ao nome sem a marca', async () => {
    const onSave = await open(listItem('Leite IL Desnatado'));
    expect(brandChip()!.props.selected).toBe(true);
    act(() => brandChip()!.props.onPress());
    expect(nameField().props.value).toBe('Leite desnatado');
    expect(brandChip()!.props.selected).toBe(false);
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite desnatado' }), { kind: 'keep' });
  });

  it('o nome que a pessoa deu ao item volta quando ela desliga', async () => {
    await open(listItem('Leite da vovó'));
    act(() => brandChip()!.props.onPress());
    expect(nameField().props.value).toBe('Leite IL Desnatado');
    act(() => brandChip()!.props.onPress());
    expect(nameField().props.value).toBe('Leite da vovó');
  });

  it('sem produto, ou com um produto sem marca para tirar, não há o que escolher', async () => {
    await open(listItem('Leite desnatado', null), null);
    expect(brandChip()).toBeUndefined();
    await act(async () => renderer?.unmount());
    await open(listItem('Requeijão', 'req'), { name: 'Requeijão', category: 'laticinios' });
    expect(brandChip()).toBeUndefined();
  });
});
