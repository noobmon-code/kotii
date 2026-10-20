// Apagar a conta: a ordem dos passos e as respostas ao app, sem rede (as
// partes que falam com o Supabase chegam prontas em DeleteAccountDeps;
// testado em account.test.ts). Quem é a pessoa vem só do token conferido:
// o corpo do pedido não diz de quem é a conta, então ninguém apaga outra.
//
// 1. A senha de novo, com o e-mail da própria conta: um token esquecido
//    num aparelho não basta para apagar a conta. Cada tentativa conta antes
//    (até 5 por hora por conta, no banco), e a senha certa zera a conta.
// 2. O banco (delete_account_data, uma transação): sai de cada casa, apaga
//    a casa em que ela é a última (só as que o app avisou), solta o dono
//    dos arquivos e apaga o que é só dela.
// 3. As fotos das casas apagadas (a fila de limpeza; o que falhar, o
//    agendamento de leave-household pega).
// 4. O usuário no Auth. Se só isto falhar, a pessoa já saiu das casas: tentar
//    de novo refaz o 2 sem nada a fazer e chega aqui outra vez.

/** O que o app manda: a senha e as casas que ele avisou que serão apagadas. */
export interface DeleteAccountRequest {
  password: string;
  deleteHouseholds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O limite de casas por conta é 5: mais do que isso não é um pedido do app. */
const MAX_HOUSEHOLDS = 10;
const MAX_PASSWORD = 200;

/** null: pedido sem senha ou com casas que não são ids. */
export function parseDeleteAccountRequest(body: unknown): DeleteAccountRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { password, deleteHouseholds = [] } = body as { password?: unknown; deleteHouseholds?: unknown };
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD) return null;
  if (!Array.isArray(deleteHouseholds) || deleteHouseholds.length > MAX_HOUSEHOLDS) return null;
  if (!deleteHouseholds.every((id): id is string => typeof id === 'string' && UUID.test(id))) return null;
  return { password, deleteHouseholds: [...new Set(deleteHouseholds.map((id) => id.toLowerCase()))] };
}

export type PasswordCheck = 'ok' | 'wrong' | 'too_many' | 'failed';

/** O erro do banco quando uma casa ficou só com a pessoa sem o app ter avisado (leave_household). */
export const LAST_MEMBER_CODE = 'NK001';
/** O erro do banco quando uma casa que o app avisou que seria apagada ganhou um morador. */
export const NOT_LAST_CODE = 'NK011';

export interface DeleteAccountDeps {
  /** Conta uma tentativa de senha desta conta; false quando já passou do limite (e não conta). */
  countAttempt(userId: string): Promise<boolean>;
  /** A senha conferiu: a contagem recomeça. */
  clearAttempts(userId: string): Promise<void>;
  /** Entra com o e-mail e a senha; 'ok' só se a conta que entrou é a de `userId`. */
  checkPassword(userId: string, email: string, password: string): Promise<PasswordCheck>;
  /** delete_account_data; lança o erro do banco (com `code`). */
  deleteData(userId: string, deleteHouseholds: string[]): Promise<{ deleted: string[]; left: string[] }>;
  /** Apaga as fotos das casas da fila. */
  cleanFiles(): Promise<void>;
  /** Apaga o usuário no Auth; já apagado conta como feito. */
  deleteUser(userId: string): Promise<void>;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, code: string, error: string): Reply => ({ status, body: { code, error } });

const codeOf = (err: unknown): string | null =>
  err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : null;

export async function deleteAccount(
  user: { id: string; email?: string | null },
  request: DeleteAccountRequest,
  deps: DeleteAccountDeps,
): Promise<Reply> {
  if (!user.email) {
    return fail(400, 'no_email', 'Esta conta não tem e-mail para conferir a senha.');
  }
  // Conta antes de conferir: pedidos ao mesmo tempo também passam pelo limite.
  const allowed = await deps.countAttempt(user.id).catch((err) => {
    console.error('attempt count failed', err);
    return null;
  });
  const check: PasswordCheck =
    allowed === null
      ? 'failed'
      : !allowed
        ? 'too_many'
        : await deps.checkPassword(user.id, user.email, request.password).catch((err) => {
            console.error('password check failed', err);
            return 'failed' as const;
          });
  if (check === 'wrong') return fail(403, 'wrong_password', 'Senha errada. Nada foi apagado.');
  if (check === 'too_many') {
    return fail(429, 'too_many_attempts', 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.');
  }
  if (check !== 'ok') return fail(503, 'check_failed', 'Não deu para conferir a senha agora. Nada foi apagado. Tente de novo.');
  // Se não zerar, a pessoa só tem uma tentativa a menos nesta hora.
  await deps.clearAttempts(user.id).catch((err) => console.error('attempt clear failed', err));

  let result: { deleted: string[]; left: string[] };
  try {
    result = await deps.deleteData(user.id, request.deleteHouseholds);
  } catch (err) {
    if (codeOf(err) === LAST_MEMBER_CODE) {
      return fail(
        409,
        'last_member',
        'Uma das suas casas ficou só com você desde o aviso, e ela seria apagada. Confira de novo antes de apagar a conta.',
      );
    }
    if (codeOf(err) === NOT_LAST_CODE) {
      return fail(
        409,
        'houses_changed',
        'Uma das casas que seriam apagadas tem um morador novo desde o aviso, e ela ficaria com ele. Confira de novo antes de apagar a conta.',
      );
    }
    console.error('delete_account_data failed', err);
    return fail(500, 'failed', 'Não deu para apagar a conta agora. Nada foi apagado. Tente de novo.');
  }

  // A limpeza das fotos não muda a resposta: o que sobrar, o agendamento pega.
  if (result.deleted.length) await deps.cleanFiles().catch((err) => console.error('file cleanup failed', err));

  try {
    await deps.deleteUser(user.id);
  } catch (err) {
    console.error('auth deleteUser failed', err);
    return fail(
      500,
      'auth_failed',
      'Você já saiu das suas casas, mas a conta não terminou de ser apagada. Tente de novo.',
    );
  }
  return { status: 200, body: { status: 'deleted', deletedHouseholds: result.deleted.length } };
}
