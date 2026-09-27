import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';

import { forgetLeftHousehold } from '../household';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/queryClient', () => ({ saveNow: () => undefined }));
jest.mock('@/lib/reminders', () => ({ disableAllReminders: async () => undefined }));
jest.mock('@/features/nuke/conversation', () => ({ clearConversation: () => undefined }));
jest.mock('@/data/images', () => ({ functionErrorMessage: async () => '' }));

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
