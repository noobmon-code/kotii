import { afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FinanceMessage } from '@/domain/financeAdvisor';
import { forgetActiveHousehold, setActiveHousehold } from '@/lib/activeHousehold';

import {
  financeConversationOwner,
  openFinanceConversation,
  updateFinanceConversation,
} from '../advisorConversation';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: () => undefined } } }));

afterEach(async () => {
  forgetActiveHousehold();
  await AsyncStorage.clear();
});

/** O que a conversa de `id` tem agora; null quando ela não está aberta na memória. */
function read(id: string): FinanceMessage[] | null {
  let seen: FinanceMessage[] | null = null;
  updateFinanceConversation(id, (current) => (seen = current));
  return seen;
}

describe('conversa com o Nuke consultor (só na memória)', () => {
  it('trocar de casa apaga a conversa; voltar começa outra', async () => {
    const id = financeConversationOwner('u1', 'casa-1');
    await setActiveHousehold('u1', 'casa-1');
    openFinanceConversation(id);
    updateFinanceConversation(id, () => [{ id: 'm1', role: 'user', text: 'Quanto gastei?' }]);
    expect(read(id)).toHaveLength(1);

    await setActiveHousehold('u1', 'casa-2');
    expect(read(id)).toBeNull();

    await setActiveHousehold('u1', 'casa-1');
    openFinanceConversation(id);
    expect(read(id)).toEqual([]);
  });

  it('a mesma casa de novo (abrir o app) não apaga', async () => {
    const id = financeConversationOwner('u1', 'casa-1');
    await setActiveHousehold('u1', 'casa-1');
    openFinanceConversation(id);
    updateFinanceConversation(id, () => [{ id: 'm1', role: 'user', text: 'Oi' }]);
    await setActiveHousehold('u1', 'casa-1');
    expect(read(id)).toHaveLength(1);
  });
});
