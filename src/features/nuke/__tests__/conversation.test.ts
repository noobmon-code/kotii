import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type Conversation = typeof import('../conversation');
interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const KEY = 'nuke:conversation:u1';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let conversation: Conversation;
let storage: Storage;

beforeEach(() => {
  // Módulos novos a cada teste: o estado da conversa vive no módulo.
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  conversation = require('../conversation');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-async-storage/async-storage');
  storage = mod.default ?? mod;
});

describe('clearConversation', () => {
  it('apaga a conversa salva mesmo sem o Nuke ter sido aberto', async () => {
    await storage.setItem(KEY, JSON.stringify([{ id: '1', role: 'user', text: 'Oi' }]));
    conversation.clearConversation('u1');
    await flush();
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('descarta a resposta de uma pergunta feita antes de apagar', async () => {
    const { clearConversation, conversationEpoch, loadConversation, updateConversation } = conversation;
    await loadConversation('u1');
    updateConversation('u1', (m) => [...m, { id: 'q', role: 'user', text: 'O que falta comprar?' }]);
    await flush();
    expect(JSON.parse((await storage.getItem(KEY)) ?? '[]')).toHaveLength(1);

    const since = conversationEpoch();
    clearConversation('u1');
    updateConversation('u1', (m) => [...m, { id: 'r', role: 'assistant', text: 'resposta velha' }], since);
    await flush();
    expect(await storage.getItem(KEY)).toBeNull();

    updateConversation('u1', (m) => [...m, { id: 'n', role: 'user', text: 'nova' }]);
    await flush();
    expect(JSON.parse((await storage.getItem(KEY)) ?? '[]')).toEqual([{ id: 'n', role: 'user', text: 'nova' }]);
  });
});
