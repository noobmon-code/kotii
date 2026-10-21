// Apagar a conta: o que o banco mostra antes (account_deletion_preview: as
// casas da pessoa, se ela é a última em cada uma, se tem o consultor) e o
// pedido à função delete-account, que confere a senha de novo e apaga. Depois,
// o que fica neste aparelho sai como no "Sair" (lib/session: lembretes,
// inscrição dos avisos do navegador, cache, sessão guardada) e mais o que o
// "Sair" deixa para a volta da pessoa: a marca da recuperação de senha (se
// for a dela), as conversas com o Nuke, a casa aberta guardada e os aceites
// dos termos guardados aqui.
//
// O app pode chegar antes da migração e da função: sem a parte do banco, a
// prévia é null; sem a função, o pedido dá AccountDeletionUnavailable. Nos
// dois casos a tela manda escrever para o contato dos termos.
//
// A resposta de uma exclusão que deu certo pode se perder (internet fraca):
// a próxima tentativa recebe 401, porque a conta já não existe. Antes de
// tratar o 401 (ou uma falha sem resposta da função) como erro, o app pergunta
// ao Auth quem é a pessoa: "user_not_found" prova que a conta foi apagada, e
// a limpeza do aparelho roda como numa exclusão que respondeu. Só isso prova:
// a sessão que terminou por outro motivo (saiu de todos os aparelhos, trocou a
// senha) não apaga nada do aparelho. Limite: isso só vale enquanto o token de
// acesso guardado não venceu (cerca de uma hora). Depois, o getUser tenta
// renovar a sessão, o Auth recusa (o usuário não existe) e a resposta é esse
// erro, não "user_not_found": a sessão termina como num login vencido, e as
// conversas, os aceites e a casa guardada da conta apagada ficam no aparelho
// (só dela, por id, que ninguém mais usa).

import { FunctionsHttpError, FunctionsRelayError, isAuthApiError } from '@supabase/supabase-js';
import { useMutation, useQuery } from '@tanstack/react-query';

import { functionErrorDetails } from '@/data/images';
import { isMissingFunction } from '@/data/missingSchema';
import { forgetTermsOnDevice } from '@/data/terms';
import { accountDeletionUnavailable, type DeletionHouse } from '@/domain/account';
import { TERMS_CONTACT } from '@/domain/terms';
import { forgetConversations } from '@/features/nuke/conversation';
import { forgetStoredHousehold } from '@/lib/activeHousehold';
import { forgetRecoveryOf } from '@/lib/passwordRecovery';
import { forgetPendingReceipts } from '@/lib/pendingReceipts';
import { signOut } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';

/** A função delete-account (ou a parte do banco) ainda não foi publicada. */
export class AccountDeletionUnavailable extends Error {
  constructor() {
    super('Apagar a conta pelo app ainda não está disponível.');
  }
}

/** A senha não confere: nada foi apagado. */
export class WrongPasswordError extends Error {}

/** As casas mudaram depois do aviso (uma ficou só com a pessoa, ou ganhou um morador): a tela relê as casas e pede de novo. */
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

const statusOf = (error: { context?: unknown }): number | undefined => (error.context as Response | undefined)?.status;

/** Função não publicada: a plataforma responde 404 (a função nunca responde 404), às vezes como erro do relay. */
function functionMissing(error: unknown): boolean {
  return (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) && statusOf(error) === 404;
}

/**
 * Sem uma resposta da função que diga o que houve: 401 (a função não achou a pessoa), falha de rede ou do
 * relay, erro do servidor. As respostas com motivo (senha errada, casa que mudou, muitas tentativas) não entram.
 */
function outcomeUnknown(error: unknown): boolean {
  if (!(error instanceof FunctionsHttpError)) return true;
  const status = statusOf(error);
  return status === undefined || status === 401 || status >= 500;
}

/** O Auth diz que a conta desta sessão não existe mais. Qualquer outra resposta (ou falha) não prova nada. */
export async function accountIsGone(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.getUser();
    return isAuthApiError(error) && error.code === 'user_not_found';
  } catch {
    return false;
  }
}

/** Pede à função para apagar a conta. `deleteHouseholds`: as casas que a tela avisou que serão apagadas. */
export async function requestAccountDeletion(password: string, deleteHouseholds: string[]): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { body: { password, deleteHouseholds } });
  if (!error) return;
  if (functionMissing(error)) throw new AccountDeletionUnavailable();
  // Uma tentativa anterior apagou a conta e a resposta se perdeu: feito.
  if (outcomeUnknown(error) && (await accountIsGone())) return;
  const { message, code } = await functionErrorDetails(error, FALLBACK);
  if (code === 'wrong_password') throw new WrongPasswordError(message);
  if (code === 'last_member' || code === 'houses_changed') throw new HousesChangedError(message);
  throw new Error(message);
}

/** A conta já não existe: sai daqui e leva o que o aparelho guardava dela. */
export async function forgetDeletedAccount(userId: string): Promise<void> {
  const signedOut = await signOut().then(
    () => true,
    () => false,
  );
  // Depois de sair, como em "Cancelar e sair" da senha nova: a marca nunca sai com a sessão ainda aqui
  // (se a saída falhou, ela fica). Só a marca desta conta: a de outra conta do aparelho continua pedindo a
  // senha nova. O resto sai de todo jeito: é só desta conta, que não existe mais.
  await Promise.all([
    signedOut ? forgetRecoveryOf(userId) : undefined,
    forgetConversations(userId),
    forgetStoredHousehold(userId),
    forgetTermsOnDevice(userId),
    forgetPendingReceipts(userId),
  ]).catch(() => undefined);
}

export function useDeleteAccount(userId: string | undefined) {
  return useMutation({
    mutationFn: async ({ password, deleteHouseholds }: { password: string; deleteHouseholds: string[] }) => {
      if (!userId) throw new Error('Entre na conta de novo.');
      await requestAccountDeletion(password, deleteHouseholds);
    },
    // No hook, e não na chamada: a tela some quando a conta sai.
    onSuccess: async () => {
      // A conta já não existe: uma falha ao sair daqui não vira "não deu para apagar". A sessão que
      // sobrar termina sozinha na próxima renovação, que o Auth recusa.
      if (userId) await forgetDeletedAccount(userId).catch(() => undefined);
      notify('Conta apagada', 'Sua conta foi apagada. Obrigado por ter usado o Kotii.');
    },
    // Também no hook: a resposta chega mesmo se a pessoa já voltou da tela. O que é da tela (reler as
    // casas, trocar pelo aviso do e-mail) fica na chamada, que só roda com ela aberta.
    onError: (err) => {
      if (err instanceof AccountDeletionUnavailable) {
        notify('Ainda não disponível', accountDeletionUnavailable(TERMS_CONTACT));
      } else if (err instanceof WrongPasswordError) {
        notify('Senha errada', 'Confira a senha e tente de novo. Nada foi apagado.');
      } else if (err instanceof HousesChangedError) {
        notify('Suas casas mudaram', err.message);
      } else {
        notify('Não deu para apagar a conta', errorMessage(err));
      }
    },
  });
}
