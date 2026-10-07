import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { type Cipher, createEncryptedStorage, type KeyValueStorage, type SecretStore } from '../sessionStorage';

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

// Cifra de brinquedo com a forma da de verdade: nonce novo a cada fechamento
// e uma etiqueta que prende chave e conteúdo (alterado, não abre).
const tag = (key: string, body: string) => String([...`${key}|${body}`].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 1_000_003, 7));
let nonce = 0;
const fakeCipher: Cipher = {
  newKey: async () => `chave-${++nonce}`,
  seal: async (key, plaintext) => {
    const body = `${++nonce}.${Buffer.from(plaintext, 'utf8').toString('base64')}`;
    return `${body}.${tag(key, body)}`;
  },
  open: async (key, sealed) => {
    const [n, base64, mac] = sealed.split('.');
    const body = `${n}.${base64}`;
    if (!n || !base64 || mac !== tag(key, body)) throw new Error('não abre');
    return Buffer.from(base64, 'base64').toString('utf8');
  },
};

const SESSION = JSON.stringify({ access_token: 'a'.repeat(900), refresh_token: 'r'.repeat(60), user: { id: 'u1', email: 'ana@x.y' } });

describe('sessão cifrada no aparelho', () => {
  let plain: ReturnType<typeof memory>;
  let secret: ReturnType<typeof vault>;
  let storage: KeyValueStorage;

  beforeEach(() => {
    plain = memory();
    secret = vault();
    storage = createEncryptedStorage({ plain, secret, cipher: fakeCipher });
  });

  it('guarda cifrado, com a chave no cofre, e lê de volta', async () => {
    await storage.setItem('sb-auth', SESSION);
    expect(plain.map.get('sb-auth')).not.toContain('access_token');
    expect(secret.map.get('sb-auth.key')).toMatch(/^chave-/);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
  });

  it('a chave é uma só; cada gravação tem nonce novo e vale sozinha', async () => {
    await storage.setItem('sb-auth', SESSION);
    const key = secret.map.get('sb-auth.key');
    const first = plain.map.get('sb-auth');
    await storage.setItem('sb-auth', SESSION);
    expect(secret.map.get('sb-auth.key')).toBe(key);
    expect(plain.map.get('sb-auth')).not.toBe(first);
    // Gravação interrompida: o conteúdo anterior continua abrindo com a mesma chave.
    plain.map.set('sb-auth', first!);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
  });

  it('a sessão guardada em texto puro (versão antiga) é cifrada na primeira leitura', async () => {
    plain.map.set('sb-auth', SESSION);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
    expect(plain.map.get('sb-auth')).not.toContain('access_token');
    expect(secret.map.has('sb-auth.key')).toBe(true);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
  });

  it('migração interrompida (chave criada, texto puro ainda lá) termina na próxima leitura', async () => {
    plain.map.set('sb-auth', SESSION);
    secret.map.set('sb-auth.key', 'chave-antiga');
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
    expect(plain.map.get('sb-auth')).not.toContain('access_token');
    expect(secret.map.get('sb-auth.key')).toBe('chave-antiga');
    expect(secret.map.get('sb-auth.sealed')).toBe('1');
    expect(await createEncryptedStorage({ plain, secret, cipher: fakeCipher }).getItem('sb-auth')).toBe(SESSION);
  });

  it('a marca de cifrado só entra depois do conteúdo cifrado', async () => {
    const calls: string[] = [];
    const failing: KeyValueStorage = {
      ...plain,
      setItem: async () => {
        calls.push('plain.setItem');
        throw new Error('disco cheio');
      },
    };
    const broken = createEncryptedStorage({ plain: failing, secret, cipher: fakeCipher });
    plain.map.set('sb-auth', SESSION);
    await expect(broken.getItem('sb-auth')).rejects.toThrow('disco cheio');
    expect(calls).toEqual(['plain.setItem']);
    expect(secret.map.has('sb-auth.key')).toBe(true);
    expect(secret.map.has('sb-auth.sealed')).toBe(false);
    // O texto puro continua lá e a próxima leitura (com o disco bom) migra.
    expect(plain.map.get('sb-auth')).toBe(SESSION);
    expect(await storage.getItem('sb-auth')).toBe(SESSION);
    expect(secret.map.get('sb-auth.sealed')).toBe('1');
  });

  it('com a marca de cifrado no cofre, texto puro plantado no AsyncStorage não vale', async () => {
    await storage.setItem('sb-auth', SESSION);
    expect(secret.map.get('sb-auth.sealed')).toBe('1');
    const planted = JSON.stringify({ access_token: 'x', refresh_token: 'y', user: { id: 'intruso' } });
    plain.map.set('sb-auth', planted);
    expect(await storage.getItem('sb-auth')).toBeNull();
    expect(plain.map.has('sb-auth')).toBe(false);
    // Nem depois de sair da conta: a marca fica no cofre.
    await storage.setItem('sb-auth', SESSION);
    await storage.removeItem('sb-auth');
    plain.map.set('sb-auth', planted);
    expect(await createEncryptedStorage({ plain, secret, cipher: fakeCipher }).getItem('sb-auth')).toBeNull();
  });

  it('conteúdo alterado não abre: a sessão sai', async () => {
    await storage.setItem('sb-auth', SESSION);
    const sealed = plain.map.get('sb-auth')!;
    plain.map.set('sb-auth', sealed.replace(/^(\d+)\.(.{10})/, (_, n, head) => `${n}.${head.replace(/[A-Za-z]/, (c: string) => (c === 'A' ? 'B' : 'A'))}`));
    expect(await storage.getItem('sb-auth')).toBeNull();
    expect(plain.map.has('sb-auth')).toBe(false);
  });

  it('sem chave no cofre, o conteúdo cifrado não vale e sai', async () => {
    await storage.setItem('sb-auth', SESSION);
    secret.map.clear();
    const fresh = createEncryptedStorage({ plain, secret, cipher: fakeCipher });
    expect(await fresh.getItem('sb-auth')).toBeNull();
    expect(plain.map.has('sb-auth')).toBe(false);
  });

  it('remover apaga o conteúdo; a chave e a marca ficam no cofre', async () => {
    await storage.setItem('sb-auth', SESSION);
    await storage.removeItem('sb-auth');
    expect(plain.map.has('sb-auth')).toBe(false);
    expect(secret.map.has('sb-auth.key')).toBe(true);
    expect(secret.map.has('sb-auth.sealed')).toBe(true);
    expect(await storage.getItem('sb-auth')).toBeNull();
  });
});
