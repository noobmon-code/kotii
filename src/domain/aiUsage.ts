// Uso da IA no mês (limite por casa, conferido no servidor): o que mostrar
// em Configurações.

// 'finance' só vem para quem tem o consultor financeiro (beta) na casa aberta.
export type AiKind = 'chat' | 'photo' | 'menu' | 'nfce' | 'finance';

/** O nome de cada uso da IA, como Configurações e o painel do app mostram. */
export const AI_KIND_LABELS: Record<AiKind, string> = {
  chat: 'Mensagens com o Nuke',
  photo: 'Leituras de foto (notas e saúde)',
  menu: 'Cardápios montados pelo Nuke',
  nfce: 'Notas lidas pelo QR code',
  finance: 'Mensagens com o consultor financeiro',
};

export interface AiUsageRow {
  kind: AiKind;
  label: string;
  used: number;
  limit: number;
  /** 0 a 1, para a barra. */
  ratio: number;
  level: 'ok' | 'perto' | 'acabou';
}

/**
 * As linhas que a aba mostra, na ordem em que vêm. Sem Finanças (`finance` false, a chave de lib/features), sem a
 * do consultor financeiro: o servidor continua mandando a linha para quem tem o beta, mas o consultor está atrás da
 * chave e a pessoa não chega a ele. O painel do app lê AI_KIND_LABELS por conta própria e não passa por aqui.
 */
export function aiUsageRows(rows: { kind: string; used: number; lim: number }[], { finance }: { finance: boolean }): AiUsageRow[] {
  return rows
    .filter((r): r is { kind: AiKind; used: number; lim: number } => r.kind in AI_KIND_LABELS && (finance || r.kind !== 'finance'))
    .map((r) => {
      const ratio = r.lim > 0 ? Math.min(1, r.used / r.lim) : 1;
      return {
        kind: r.kind,
        label: AI_KIND_LABELS[r.kind],
        used: r.used,
        limit: r.lim,
        ratio,
        level: r.used >= r.lim ? 'acabou' : ratio >= 0.8 ? 'perto' : 'ok',
      };
    });
}

/** A primeira letra em minúscula: o nome do uso no meio da frase ("o limite de mensagens com o Nuke"). */
const midSentence = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * O que a linha "Uso da IA neste mês" diz fechada, em Configurações → Sobre o Kotii (as barras ficam para quando ela
 * abre): o limite que acabou, ou o que está perto do fim, que é o que a pessoa precisa saber sem abrir; com tudo
 * longe do limite, só o que ela mostra.
 */
export function aiUsageSubtitle(rows: AiUsageRow[]): string {
  const over = rows.filter((row) => row.level === 'acabou');
  if (over.length === 1) return `Acabou o limite de ${midSentence(over[0].label)}`;
  if (over.length > 1) return `${over.length} limites acabaram neste mês`;
  const near = rows.filter((row) => row.level === 'perto');
  if (near.length === 1) return `Perto do limite de ${midSentence(near[0].label)}`;
  if (near.length > 1) return `${near.length} usos perto do limite`;
  return 'Quanto a casa já usou do limite do mês';
}
