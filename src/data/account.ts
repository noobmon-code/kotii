// Apagar a conta: o que o banco mostra antes (account_deletion_preview: as
// casas da pessoa, se ela é a última em cada uma, se tem o consultor) e o
// pedido à função delete-account, que confere a senha de novo e apaga. Depois,
// o que fica neste aparelho sai como no "Sair" (lib/session: lembretes,
// inscrição dos avisos do navegador, cache, sessão guardada) e mais o que o
// "Sair" deixa para a volta da pessoa: a marca da recuperação de senha (se
// for a dela), as conversas com o Nuke e a casa aberta guardada.
//
// O app pode chegar antes da migração e da função: sem a parte do banco, a
// prévia é null; sem a função, o pedido dá AccountDeletionUnavailable. Nos
// dois casos a tela manda escrever para o contato dos termos.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation, useQuery } from '@tanstack/react-query';

import { functionErrorDetails } from '@/data/images';
import { isMissingFunction } from '@/data/missingSchema';
import type { DeletionHouse } from '@/domain/account';
import { forgetConversations } from '@/features/nuke/conversation';
import { forgetStoredHousehold } from '@/lib/activeHousehold';
import { forgetRecoveryOf } from '@/lib/passwordRecovery';
import { signOut } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';

/** A função delete-account (ou a parte do banco) ainda não foi publicada. */
export class AccountDeletionUnavailable extends Error {
  constructor() {
    super('Apagar a conta pelo app ainda não está disponível.');
  }
}

/** A senha não confere: nada foi apagado. */
export class WrongPasswordError extends Error {}

/** Uma casa ficou só com a pessoa depois do aviso: a tela relê as casas e pede de novo. */
export class HousesChangedError extends Error {}

const FALLBACK = 'Não deu para apagar a conta agora. Tente de novo.';

/** As casas como ficam se a conta for apagada agora; null sem a parte do banco. Não fica guardado no aparelho. */
export function useAccountDeletionPreview(userId: string | undefined) {
  return useQuery({
    queryKey: ['accountDeletion', userId],
    enabled: Boolean(userId),
    // O aviso precisa ser o de agora: sempre relido ao abrir a tela.
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<DeletionHouse[] | null> => {
      const { data, error } = await supabase.rpc('account_deletion_preview');
      if (error) {
        if (isMissingFunction(error, 'account_deletion_preview')) return null;
        throw error;
      }
      return (data ?? []) as DeletionHouse[];
    },
  });
}

/** Pede à função para apagar a conta. `deleteHouseholds`: as casas que a tela avisou que serão apagadas. */
export async function requestAccountDeletion(password: string, deleteHouseholds: string[]): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { body: { password, deleteHouseholds } });
  if (!error) return;
  // Função não publicada: a plataforma responde 404 (a função nunca responde 404).
  if (error instanceof FunctionsHttpError && (error.context as Response | undefined)?.status === 404) {
    throw new AccountDeletionUnavailable();
  }
  const { message, code } = await functionErrorDetails(error, FALLBACK);
  if (code === 'wrong_password') throw new WrongPasswordError(message);
  if (code === 'last_member') throw new HousesChangedError(message);
  throw new Error(message);
}

/** A conta já não existe: sai daqui e leva o que o aparelho guardava dela. */
export async function forgetDeletedAccount(userId: string): Promise<void> {
  await signOut();
  // Depois de sair, como em "Cancelar e sair" da senha nova: a marca nunca sai com a sessão ainda aqui.
  // Só a marca desta conta: a de outra conta do aparelho continua pedindo a senha nova.
  await Promise.all([forgetRecoveryOf(userId), forgetConversations(userId), forgetStoredHousehold(userId)]).catch(
    () => undefined,
  );
}

export function useDeleteAccount(userId: string | undefined) {
  return useMutation({
    mutationFn: async ({ password, deleteHouseholds }: { password: string; deleteHouseholds: string[] }) => {
      if (!userId) throw new Error('Entre na conta de novo.');
      await requestAccountDeletion(password, deleteHouseholds);
    },
    // No hook, e não na chamada: a tela some quando a conta sai.
    onSuccess: async () => {
      if (userId) await forgetDeletedAccount(userId);
      notify('Conta apagada', 'Sua conta foi apagada. Obrigado por ter usado o Kotii.');
    },
  });
}
