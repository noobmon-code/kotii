// Uso da IA no mês (limite por casa, conferido no servidor): o que mostrar
// na aba Família.

export type AiKind = 'chat' | 'photo' | 'menu' | 'nfce';

const LABELS: Record<AiKind, string> = {
  chat: 'Mensagens com o Nuke',
  photo: 'Leituras de foto (notas e saúde)',
  menu: 'Cardápios montados pelo Nuke',
  nfce: 'Notas lidas pelo QR code',
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

export function aiUsageRows(rows: { kind: string; used: number; lim: number }[]): AiUsageRow[] {
  return rows
    .filter((r): r is { kind: AiKind; used: number; lim: number } => r.kind in LABELS)
    .map((r) => {
      const ratio = r.lim > 0 ? Math.min(1, r.used / r.lim) : 1;
      return {
        kind: r.kind,
        label: LABELS[r.kind],
        used: r.used,
        limit: r.lim,
        ratio,
        level: r.used >= r.lim ? 'acabou' : ratio >= 0.8 ? 'perto' : 'ok',
      };
    });
}
