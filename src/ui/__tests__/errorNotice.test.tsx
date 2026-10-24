import { describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { OFFLINE_TRY_AGAIN } from '@/lib/networkErrors';
import { ErrorNotice } from '../primitives';

// O aviso de erro das telas: a falta de internet em palavras, o resto como veio.

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

async function shown(error: unknown): Promise<string> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<ErrorNotice error={error} />);
  });
  const text = texts(renderer!.toJSON()).join('\n');
  await act(async () => renderer!.unmount());
  return text;
}

describe('ErrorNotice', () => {
  it('o fetch que não chegou (celular e navegador) vira "sem internet"', async () => {
    expect(await shown(new TypeError('Network request failed'))).toBe(OFFLINE_TRY_AGAIN);
    expect(await shown(new TypeError('Failed to fetch'))).toBe(OFFLINE_TRY_AGAIN);
  });

  it('o erro do PostgREST com o texto do fetch, sem código, também', async () => {
    expect(await shown({ message: 'TypeError: Network request failed', details: '', hint: '', code: '' })).toBe(OFFLINE_TRY_AGAIN);
  });

  it('os outros erros aparecem como vieram, também o do servidor que fala em fetch', async () => {
    expect(await shown(new Error('Mercado não encontrado.'))).toBe('Mercado não encontrado.');
    expect(await shown({ message: 'Failed to fetch the row', code: '42501' })).toBe('Failed to fetch the row');
    expect(await shown(null)).toBe('Algo deu errado.');
  });
});
