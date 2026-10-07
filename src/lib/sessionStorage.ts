// Onde a sessão do Supabase (os tokens da conta) fica no aparelho.
//
// No celular, cifrada: a chave (AES-256) fica no cofre do sistema (Keychain
// no iOS, Keystore no Android, via expo-secure-store) e o conteúdo cifrado
// no AsyncStorage. O cofre não aceita valores grandes (o iOS recusa acima
// de ~2 KB) e a sessão passa disso; é o arranjo que a Supabase recomenda
// para o Expo. No navegador não há cofre: fica o localStorage, como antes.
//
// A sessão guardada antes desta versão (texto puro no AsyncStorage) é
// cifrada na primeira leitura, sem pedir para entrar de novo.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** O cofre do sistema, só com o que este módulo usa. */
export interface SecretStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface EncryptedStorageDeps {
  /** Onde fica o conteúdo cifrado. */
  plain: KeyValueStorage;
  /** Onde fica a chave. */
  secret: SecretStore;
  /** Bytes aleatórios para a chave. */
  randomBytes: (count: number) => Uint8Array;
}

/** Chave nova a cada gravação: o contador fixo do CTR nunca se repete com a mesma chave. */
const KEY_BYTES = 32;

/** Era a sessão guardada em texto puro (antes de cifrar): um JSON. */
const isPlainSession = (value: string) => value.startsWith('{');

export function createEncryptedStorage({ plain, secret, randomBytes }: EncryptedStorageDeps): KeyValueStorage {
  async function encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = randomBytes(KEY_BYTES);
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await secret.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encrypted);
  }

  function decrypt(keyHex: string, value: string): string {
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }

  async function setItem(key: string, value: string): Promise<void> {
    await plain.setItem(key, await encrypt(key, value));
  }

  return {
    async getItem(key) {
      const stored = await plain.getItem(key);
      if (stored === null) return null;
      const keyHex = await secret.getItemAsync(key);
      if (keyHex) {
        try {
          return decrypt(keyHex, stored);
        } catch {
          // Conteúdo que não bate com a chave (gravação pela metade): sem sessão.
          await plain.removeItem(key);
          return null;
        }
      }
      // Sessão de antes de cifrar: passa a cifrada agora.
      if (isPlainSession(stored)) {
        await setItem(key, stored);
        return stored;
      }
      // Cifrado sem chave (o cofre perdeu a chave): não dá para ler.
      await plain.removeItem(key);
      return null;
    },
    setItem,
    async removeItem(key) {
      await plain.removeItem(key);
      await secret.deleteItemAsync(key).catch(() => undefined);
    },
  };
}

/** A sessão: cifrada no celular; localStorage (pelo AsyncStorage) no navegador. */
export const sessionStorage: KeyValueStorage =
  Platform.OS === 'web'
    ? AsyncStorage
    : createEncryptedStorage({ plain: AsyncStorage, secret: SecureStore, randomBytes: (count) => Crypto.getRandomBytes(count) });
