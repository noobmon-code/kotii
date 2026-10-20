// Quem já não é da casa e apagar a conta. Quem saiu da casa (ou apagou a
// conta) continua nos registros que fez: o nome dele já não está entre os
// moradores, e a tela mostra "Ex-morador". Nos acertos da divisão, quem
// apagou a conta fica sem id (o banco põe nulo), e também é "Ex-morador".

/** Como aparece quem não está mais na casa. */
export const FORMER_MEMBER = 'Ex-morador';

/**
 * O nome de quem fez um registro: o do morador, "Ex-morador" para quem não
 * está mais entre eles, e null sem ninguém marcado (aí a tela não mostra nome).
 */
export function memberName(
  members: readonly { user_id: string; display_name: string }[],
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return members.find((m) => m.user_id === userId)?.display_name ?? FORMER_MEMBER;
}

/** Uma casa da pessoa, como o banco mostra antes de apagar a conta (account_deletion_preview). */
export interface DeletionHouse {
  id: string;
  name: string;
  role: 'owner' | 'member';
  /** A pessoa é a última da casa: a casa é apagada junto. */
  last: boolean;
  /** Tem o consultor financeiro (beta) nessa casa. */
  finance: boolean;
}

/** "A", "A e B", "A, B e C", com as aspas dos nomes das casas. */
export function houseList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} e ${quoted.at(-1)}`;
}

/** As casas que o app avisa que serão apagadas (vão para a função, que só apaga essas). */
export function housesToDelete(houses: readonly DeletionHouse[]): string[] {
  return houses.filter((h) => h.last).map((h) => h.id);
}

/** O que acontece ao apagar a conta, parágrafo por parágrafo, para estas casas. */
export function accountDeletionNotes(houses: readonly DeletionHouse[]): string[] {
  const kept = houses.filter((h) => !h.last);
  const gone = houses.filter((h) => h.last);
  const notes = [
    `Apagar a conta ${houses.length ? 'tira você de todas as suas casas e apaga' : 'apaga'} o seu login. Não tem volta: para usar o Kotii de novo, só criando outra conta.`,
  ];
  if (kept.length) {
    const owned = kept.filter((h) => h.role === 'owner');
    notes.push(
      `${kept.length === 1 ? 'Em' : 'Nas casas'} ${houseList(kept.map((h) => h.name))}, o que você registrou continua com a casa: listas, notas, gastos, tarefas. A sua ficha de saúde vira a ficha de um dependente, e nos acertos da divisão de gastos você aparece como "${FORMER_MEMBER}".` +
        (owned.length
          ? ` ${owned.length === 1 ? 'A casa em que você é responsável passa' : 'As casas em que você é responsável passam'} para o morador mais antigo.`
          : ''),
    );
  }
  if (gone.length) {
    notes.push(
      gone.length === 1
        ? `Você é a última pessoa em ${houseList(gone.map((h) => h.name))}: a casa é apagada junto, com tudo o que tem (listas, notas, despensa, tarefas, saúde, documentos e fotos).`
        : `Você é a última pessoa em ${houseList(gone.map((h) => h.name))}: essas casas são apagadas junto, com tudo o que têm (listas, notas, despensa, tarefas, saúde, documentos e fotos).`,
    );
  }
  if (houses.some((h) => h.finance)) {
    notes.push(
      'O consultor financeiro sai junto: os bancos conectados e os lançamentos deles são apagados do Kotii. No MeuPluggy a conexão continua; para encerrá-la, é lá.',
    );
  }
  notes.push(
    'Neste aparelho, a conta sai e os avisos param. Em outro aparelho em que a conta esteja aberta, ela sai sozinha quando o app conferir o login. Os preços que já entraram na base compartilhada ficam, porque não estão ligados a você.',
  );
  return notes;
}

/** Sem a função no servidor (ou sem a parte do banco): o pedido vai pelo e-mail. */
export function accountDeletionUnavailable(contact: string): string {
  return `Apagar a conta pelo app ainda não está disponível. Para apagar agora, escreva para ${contact} a partir do e-mail da conta.`;
}
