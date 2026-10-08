// Erros de acesso que a pessoa precisa entender em vez do texto cru do
// banco: a casa deixou de ser dela (foi tirada com o app aberto) ou a sessão
// acabou (no servidor, mas o token ainda vale aqui por até 1 h). Puro: quem
// confere a casa é o queryClient, e a sessão, o lib/session.

/** Escrita barrada e a casa conferida: a pessoa não está mais nela. */
export const REMOVED_FROM_HOUSEHOLD = 'Você não faz mais parte desta casa.';
/** Escrita barrada sem confirmar a saída da casa: não dá para dizer mais que isso. */
export const NO_HOUSEHOLD_ACCESS = 'Você não tem permissão para fazer isso nesta casa.';
/** A sessão acabou no servidor; o app já saiu da conta neste aparelho. */
export const SESSION_ENDED = 'Sua sessão terminou. Entre de novo.';

function messageOf(error: unknown): string | null {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return null;
}

/**
 * Escrita barrada pela casa: a regra de acesso (RLS) de uma tabela ou do
 * storage, ou uma função do banco que não achou a casa da pessoa ("sem
 * casa"). Só pela mensagem: o código 42501 sozinho também vem de "only the
 * household owner can do this" e "not authenticated", que têm outro sentido.
 * Só INSERT/upsert e as funções do banco dão esse erro: UPDATE e DELETE em
 * linhas que a RLS esconde passam sem erro, com 0 linhas (ver wroteNoRows).
 */
export function isHouseholdAccessError(error: unknown): boolean {
  const message = messageOf(error);
  if (!message) return false;
  // A mensagem já traduzida (um erro refeito a partir dela) continua sendo deste tipo.
  return /row-level security/i.test(message) || message === 'sem casa' || message === NO_HOUSEHOLD_ACCESS;
}

/** Uma casa da pessoa, como vem na consulta da casa. */
interface HouseholdRef {
  id: string;
}

/**
 * Conferidas as casas de novo: a casa em que a escrita foi barrada
 * (`householdId`) não está mais entre as da pessoa. `state` nulo: nenhuma
 * casa. Sem saber qual casa estava aberta, não dá para afirmar.
 */
export function leftHousehold(
  householdId: string | null,
  state: { household: HouseholdRef; households?: HouseholdRef[] } | null,
): boolean {
  if (!state) return true;
  if (!householdId) return false;
  return !(state.households ?? [state.household]).some((h) => h.id === householdId);
}

// Erros cuja casa foi conferida e não é mais da pessoa (marcados pelo
// queryClient antes de a tela mostrar o erro).
const removed = new WeakSet<object>();

export function markRemovedFromHousehold(error: unknown) {
  if (error && typeof error === 'object') removed.add(error);
}

/** A mensagem para um erro de acesso à casa; null para os outros erros. */
export function accessErrorMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && removed.has(error)) return REMOVED_FROM_HOUSEHOLD;
  if (isHouseholdAccessError(error)) return NO_HOUSEHOLD_ACCESS;
  return null;
}

/** O app saiu da conta porque a sessão acabou (o erro já traz a mensagem). */
export function isSessionEndedError(error: unknown): boolean {
  return messageOf(error) === SESSION_ENDED;
}

/** O que o Supabase disse ao renovar a sessão: vale, acabou, ou não deu para saber (sem internet). */
export type SessionCheck = 'valid' | 'ended' | 'unknown';

export interface SessionGuardDeps {
  /** Renova a sessão com o Supabase. */
  check(): Promise<SessionCheck>;
  /** Sai da conta só neste aparelho. */
  end(): Promise<void>;
}

/**
 * Para o 401 de uma função: a sessão pode ter acabado no servidor (a pessoa
 * saiu de todos os aparelhos, a sessão venceu) com o token ainda valendo
 * aqui. Renova; se o Supabase disser que acabou, sai neste aparelho e
 * devolve true. Vários 401 ao mesmo tempo conferem uma vez só.
 *
 * `beforeEnd` é a limpeza de quem chamou (as fotos enviadas para a função):
 * só roda se a sessão acabou, antes de sair, porque depois não há token
 * para apagar nada. As de todas as chamadas que esperavam a mesma
 * conferência rodam.
 */
export function createSessionGuard({ check, end }: SessionGuardDeps): (beforeEnd?: () => Promise<unknown>) => Promise<boolean> {
  let running: Promise<boolean> | null = null;
  let cleanups: (() => Promise<unknown>)[] = [];
  return (beforeEnd) => {
    if (beforeEnd) cleanups.push(beforeEnd);
    running ??= (async () => {
      try {
        if ((await check().catch((): SessionCheck => 'unknown')) !== 'ended') return false;
        // Inclui as que chegarem enquanto as primeiras rodam.
        while (cleanups.length) {
          const batch = cleanups.splice(0);
          await Promise.all(batch.map((cleanup) => cleanup().catch(() => undefined)));
        }
        await end().catch(() => undefined);
        return true;
      } finally {
        // Sessão válida (ou sem resposta): quem chamou cuida do que enviou.
        cleanups = [];
        running = null;
      }
    })();
    return running;
  };
}

/**
 * Mudança ou exclusão (com `.select`) que não alcançou nenhuma linha. A RLS
 * não dá erro nesses casos: para quem foi tirada da casa, as linhas somem e
 * o PostgREST responde 200 com 0 linhas. Vale buscar as casas de novo, mas
 * sem aviso: 0 linhas também é o selo da marcação que mudou ou o item que
 * outra pessoa apagou.
 */
export function wroteNoRows(result: unknown): boolean {
  return Array.isArray(result) && result.length === 0;
}

/** `meta` das mutações que devolvem as linhas alcançadas (ver wroteNoRows). */
export const EXPECTS_ROWS_META = { expectsRows: true } as const;
