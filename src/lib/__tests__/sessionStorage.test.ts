import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createEncryptedStorage, type KeyValueStorage, type SecretStore } from '../sessionStorage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function memory(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  };
}

function vault(): SecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItemAsync: async (key) => map.get(key) ?? null,
    setItemAsync: async (key, value) => void map.set(key, value),
    deleteItemAsync: async (key) => void map.delete(key),
  };
}

let seed = 1;
const randomBytes = (count: number) => Uint8Array.from({ length: count }, (_, i) => (i * 7 + seed++) % 256);

const SESSION = JSON.stringify({ access_token: 'a'.repeat(900), refresh_token: 'r'.repeat(60), user: { id: 'u1', email: 'ana@x.y' } });

describe('sessão cifrada no aparelho', () => {
  let plain: ReturnType<typeof memory>;
  let secret: ReturnType<typeof vault>;
  let storage: KeyValueStorage;

  beforeEach(() => {
    plain = memory();
    secret = vault();
    storage = createEncryptedStorage({ plain, secret, randomBytes });
  });

  it('guarda cifrado, com a chave no cofre, e lê de volta', async () => {
    await storage.setItem('sb-auth', SESSION);
    expect(plain.map.get('sb-auth')).not.toContain('access_token');
    expect(plain.map.get('sb-auth')).toMatch(/^[0-9a-f]+$/);
    expect(secret.map.get('sb-auth')).toHaveLength(64);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
  });

  it('chave nova a cada gravação', async () => {
    await storage.setItem('sb-auth', SESSION);
    const first = secret.map.get('sb-auth');
    await storage.setItem('sb-auth', SESSION);
    expect(secret.map.get('sb-auth')).not.toBe(first);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
  });

  it('a sessão guardada em texto puro (versão antiga) é cifrada na primeira leitura', async () => {
    plain.map.set('sb-auth', SESSION);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
    expect(plain.map.get('sb-auth')).not.toContain('access_token');
    expect(secret.map.has('sb-auth')).toBe(true);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
  });

  it('sem chave no cofre, o conteúdo cifrado não vale e sai', async () => {
    await storage.setItem('sb-auth', SESSION);
    secret.map.clear();
    expect(await storage.getItem('sb-auth')).toBeNull();
    expect(plain.map.has('sb-auth')).toBe(false);
  });

  it('conteúdo que não é hexadecimal com a chave presente: sem sessão', async () => {
    await storage.setItem('sb-auth', SESSION);
    plain.map.set('sb-auth', 'zz-nao-hex');
    expect(await storage.getItem('sb-auth')).toBeNull();
  });

  it('remover apaga o conteúdo e a chave', async () => {
    await storage.setItem('sb-auth', SESSION);
    await storage.removeItem('sb-auth');
    expect(plain.map.has('sb-auth')).toBe(false);
    expect(secret.map.has('sb-auth')).toBe(false);
    expect(await storage.getItem('sb-auth')).toBeNull();
  });
});
