// Uso da IA no mês (limite por casa, conferido no servidor): o que mostrar
// na aba Família.

// 'finance' só vem para quem tem o consultor financeiro (beta) na casa aberta.
export type AiKind = 'chat' | 'photo' | 'menu' | 'nfce' | 'finance';

/** O nome de cada uso da IA, como a aba Família e o painel do app mostram. */
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
