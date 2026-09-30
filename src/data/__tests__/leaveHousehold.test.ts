import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';

import { forgetLeftHousehold, householdErrorMessage } from '../household';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/supabase', () => ({ supabase: {}, errorMessage: (e: Error) => e.message }));
jest.mock('@/lib/queryClient', () => ({ saveNow: async () => undefined }));
jest.mock('@/lib/reminders', () => ({ disableHouseholdReminders: async () => undefined }));
jest.mock('@/features/nuke/conversation', () => ({ clearConversation: () => undefined, conversationOwner: (u: string, h: string) => `${u}:${h}` }));
jest.mock('@/data/images', () => ({ functionErrorMessage: async () => '' }));
jest.mock('@/data/market', () => ({ listQueueBusy: () => false }));
jest.mock('@/data/listPhotos', () => ({ photoQueueBusy: () => false }));

const house = (id: string) => ({ household: { id, name: id, invite_code: 'ABC', created_by: 'u1' }, members: [], me: {} });

describe('sair da casa', () => {
  it('a casa deixada vira "sem casa" e o resto do cache sai', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['household', 'u1'], house('h1'));
    queryClient.setQueryData(['lists'], [{ id: 'l1' }]);
    forgetLeftHousehold(queryClient, 'u1', 'h1');
    expect(queryClient.getQueryData(['household', 'u1'])).toBeNull();
    expect(queryClient.getQueryData(['lists'])).toBeUndefined();
    queryClient.clear();
  });

  it('se a pessoa já está em outra casa, ela fica', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['household', 'u1'], house('h2'));
    forgetLeftHousehold(queryClient, 'u1', 'h1');
    expect(queryClient.getQueryData(['household', 'u1'])).toEqual(house('h2'));
    queryClient.clear();
  });
});

describe('criar ou entrar em outra casa', () => {
  it('mensagens dos erros do banco', () => {
    expect(householdErrorMessage(new Error('invalid invite code'))).toBe('Código não encontrado. Confira com quem te convidou.');
    expect(householdErrorMessage(new Error('already a member of this household'))).toBe('Você já está nessa casa.');
    expect(householdErrorMessage(new Error('household limit reached'))).toMatch(/até 5 casas/);
  });
});
