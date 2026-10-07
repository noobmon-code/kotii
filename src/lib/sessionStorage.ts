// Onde a sessão do Supabase (os tokens da conta) fica no aparelho.
//
// No celular, cifrada com AES-256-GCM (expo-crypto): a chave fica no cofre
// do sistema (Keychain no iOS, Keystore no Android, via expo-secure-store)
// e o conteúdo cifrado no AsyncStorage. O cofre não aceita valores grandes
// (o iOS recusa acima de ~2 KB) e a sessão passa disso; é o arranjo que a
// Supabase recomenda para o Expo. A chave é uma só, gerada na primeira vez;
// cada gravação usa um nonce novo e grava num lugar só (o AsyncStorage),
// então uma gravação interrompida deixa a sessão anterior inteira. O GCM
// autentica o conteúdo: alterado, não abre, e a sessão é descartada.
// No navegador não há cofre: fica o localStorage, como antes.
//
// A sessão guardada antes desta versão (texto puro no AsyncStorage) é
// cifrada na primeira leitura, sem pedir para entrar de novo. Terminada a
// primeira gravação cifrada, o cofre recebe a marca de "já cifrado" do
// item, e ela fica para sempre (sair da conta apaga só o conteúdo): com a
// marca, texto puro é recusado, e quem só escreve no AsyncStorage não
// planta uma sessão. A marca vem depois do conteúdo cifrado, não antes:
// uma migração interrompida no meio (chave já no cofre, texto puro ainda
// no AsyncStorage) termina na próxima leitura em vez de perder a sessão.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
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

/** A cifra autenticada: fecha e abre com a chave (texto, em base64). */
export interface Cipher {
  /** Uma chave nova, em base64. */
  newKey(): Promise<string>;
  /** Fecha o texto com a chave; devolve nonce, conteúdo e etiqueta num texto só. */
  seal(key: string, plaintext: string): Promise<string>;
  /** Abre; rejeita se a chave não bate ou o conteúdo foi alterado. */
  open(key: string, sealed: string): Promise<string>;
}

export interface EncryptedStorageDeps {
  /** Onde fica o conteúdo cifrado. */
  plain: KeyValueStorage;
  /** Onde fica a chave. */
  secret: SecretStore;
  cipher: Cipher;
}

/** Parece a sessão guardada em texto puro (antes de cifrar): um JSON. */
const looksPlain = (value: string) => value.startsWith('{');

/** Chave do cofre para a chave de cifra de cada item (o cofre aceita letras, números, ".", "-" e "_"). */
const keyName = (key: string) => `${key}.key`;
/** Chave do cofre para a marca de que o item já foi gravado cifrado. */
const sealedName = (key: string) => `${key}.sealed`;

export function createEncryptedStorage({ plain, secret, cipher }: EncryptedStorageDeps): KeyValueStorage {
  // A chave é lida (ou criada) uma vez por item e fica em memória.
  const keys = new Map<string, Promise<string>>();
  function keyOf(key: string, { create }: { create: boolean }): Promise<string | null> {
    const cached = keys.get(key);
    if (cached) return cached;
    const loaded = (async () => {
      const existing = await secret.getItemAsync(keyName(key));
      if (existing) return existing;
      if (!create) return null;
      const fresh = await cipher.newKey();
      await secret.setItemAsync(keyName(key), fresh);
      return fresh;
    })();
    const promise = loaded.then((value) => {
      if (value === null) keys.delete(key);
      return value;
    });
    // Só fica em memória quando a chave existe; sem ela, a próxima chamada lê de novo.
    keys.set(key, promise as Promise<string>);
    promise.catch(() => keys.delete(key));
    return promise;
  }

  // A marca de "já cifrado" de cada item, lida uma vez e guardada em memória.
  const sealed = new Map<string, Promise<boolean>>();
  function isSealed(key: string): Promise<boolean> {
    const cached = sealed.get(key);
    if (cached) return cached;
    const promise = secret.getItemAsync(sealedName(key)).then((value) => value !== null);
    sealed.set(key, promise);
    promise.then((value) => value || sealed.delete(key)).catch(() => sealed.delete(key));
    return promise;
  }
  async function markSealed(key: string): Promise<void> {
    if (await isSealed(key)) return;
    await secret.setItemAsync(sealedName(key), '1');
    sealed.set(key, Promise.resolve(true));
  }

  async function setItem(key: string, value: string): Promise<void> {
    const encryptionKey = (await keyOf(key, { create: true }))!;
    await plain.setItem(key, await cipher.seal(encryptionKey, value));
    // Só com o conteúdo cifrado já gravado: a partir daqui texto puro não vale.
    await markSealed(key);
  }

  return {
    async getItem(key) {
      const stored = await plain.getItem(key);
      if (stored === null) return null;
      if (looksPlain(stored)) {
        // A sessão de antes de cifrar passa a cifrada agora (mesmo que uma
        // migração anterior tenha parado depois de criar a chave). Com a
        // marca no cofre não é migração: é conteúdo plantado, e sai.
        if (await isSealed(key)) {
          await plain.removeItem(key);
          return null;
        }
        await setItem(key, stored);
        return stored;
      }
      const encryptionKey = await keyOf(key, { create: false });
      if (!encryptionKey) {
        // Cifrado sem chave (o cofre a perdeu): não abre.
        await plain.removeItem(key);
        return null;
      }
      try {
        const opened = await cipher.open(encryptionKey, stored);
        // Gravação cifrada que ficou sem a marca (parou antes dela): marca agora.
        await markSealed(key);
        return opened;
      } catch {
        await plain.removeItem(key);
        return null;
      }
    },
    setItem,
    async removeItem(key) {
      // A chave e a marca ficam: texto puro não volta a ser aceito neste aparelho.
      await plain.removeItem(key);
    },
  };
}

/** AES-256-GCM do expo-crypto; o texto vai e volta em base64 (nonce + conteúdo + etiqueta juntos). */
export const aesGcmCipher: Cipher = {
  newKey: async () => (await AESEncryptionKey.generate(256)).encoded('base64'),
  seal: async (key, plaintext) => {
    const sealed = await aesEncryptAsync(utf8ToBase64(plaintext), await AESEncryptionKey.import(key, 'base64'));
    return sealed.combined('base64');
  },
  open: async (key, sealed) => {
    const opened = await aesDecryptAsync(AESSealedData.fromCombined(sealed), await AESEncryptionKey.import(key, 'base64'), { output: 'base64' });
    return base64ToUtf8(opened);
  },
};

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A sessão: cifrada no celular; localStorage (pelo AsyncStorage) no navegador. */
export const sessionStorage: KeyValueStorage =
  Platform.OS === 'web' ? AsyncStorage : createEncryptedStorage({ plain: AsyncStorage, secret: SecureStore, cipher: aesGcmCipher });
