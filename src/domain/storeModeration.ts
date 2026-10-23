// A moderação dos nomes dos mercados (supabase/migrations/20261023120000_store_standard_names.sql). Cada CNPJ de
// mercado tem um nome padrão, o mesmo nas casas que não deram outro. O nome fantasia da Receita entra sozinho; o
// resto (sem nome fantasia, cadastro de pessoa, sem resposta da Receita) espera a moderação, que escolhe o nome
// ou fica com o da nota. A tela é app/moderacao; aqui, o que ela mostra de cada CNPJ. Puro.

import { formatCnpj, STORE_NAME_MAX } from './storeName';

/** O que a consulta à Receita (BrasilAPI) deu. */
export type ReceitaStatus = 'pendente' | 'ok' | 'sem_fantasia' | 'pessoa' | 'sem_dados' | 'nao_achou' | 'erro';

/** Um CNPJ, como a store_names_for_review devolve. */
export interface StoreNameReview {
  cnpj: string;
  /** O nome padrão; null: nenhum. */
  name: string | null;
  /** 'receita': o nome fantasia, sozinho; 'revisao': a moderação decidiu (o nome, ou nenhum). */
  source: 'receita' | 'revisao' | null;
  reviewed_at: string | null;
  receita_status: ReceitaStatus;
  receita_name: string | null;
  receita_trade_name: string | null;
  receita_activity: string | null;
  /** O nome impresso nas notas, o mais comum entre as casas. */
  note_name: string | null;
  address: string | null;
  /** Em quantas casas o mercado está. */
  households: number;
  /** Os nomes que as casas deram ao mercado, com quantas deram cada um (nunca quais). Sem CPF, como o da nota. */
  nicknames: { name: string; households: number }[];
  /** Os nomes padrão das outras lojas da mesma empresa (a raiz do CNPJ), com quantas lojas têm cada um. */
  company_names: { name: string; stores: number }[];
}

/** As abas da tela. */
export type ReviewGroup = 'revisar' | 'consultando' | 'decididos';

export const REVIEW_GROUP_LABELS: Record<ReviewGroup, string> = {
  revisar: 'Para revisar',
  consultando: 'Na Receita',
  decididos: 'Com nome',
};

export const MODERATION_TITLE = 'Nomes dos mercados';
export const MODERATION_ABOUT =
  'O nome padrão vale em todas as casas que não deram outro nome ao mercado. O nome fantasia da Receita entra sozinho; aqui ficam os CNPJs sem ele.';
export const MODERATION_ONLY = 'Só a moderação vê esta tela.';
export const MODERATION_NAME_LABEL = 'Nome padrão';
export const MODERATION_EMPTY: Record<ReviewGroup, string> = {
  revisar: 'Nenhum mercado esperando revisão.',
  consultando: 'Nenhum CNPJ esperando a Receita.',
  decididos: 'Nenhum mercado com nome padrão ainda.',
};

/**
 * A aba do CNPJ: com nome padrão, ou já revisado (também sem nome), "Com nome"; esperando a Receita, "Na Receita";
 * o resto, "Para revisar".
 */
export function reviewGroup(row: Pick<StoreNameReview, 'name' | 'reviewed_at' | 'receita_status'>): ReviewGroup {
  if (row.name || row.reviewed_at) return 'decididos';
  if (row.receita_status === 'pendente') return 'consultando';
  return 'revisar';
}

/** O título do cartão: o nome padrão, o da nota ou o CNPJ. */
export function reviewTitle(row: Pick<StoreNameReview, 'name' | 'note_name' | 'cnpj'>): string {
  return row.name ?? row.note_name ?? `CNPJ ${formatCnpj(row.cnpj)}`;
}

/** Os CNPJs de uma aba, primeiro os que estão em mais casas, depois pelo título. */
export function reviewRows(rows: readonly StoreNameReview[], group: ReviewGroup): StoreNameReview[] {
  return rows
    .filter((row) => reviewGroup(row) === group)
    .sort((a, b) => b.households - a.households || reviewTitle(a).localeCompare(reviewTitle(b), 'pt-BR') || a.cnpj.localeCompare(b.cnpj));
}

/** Quantos CNPJs há em cada aba. */
export function reviewCounts(rows: readonly StoreNameReview[]): Record<ReviewGroup, number> {
  const counts: Record<ReviewGroup, number> = { revisar: 0, consultando: 0, decididos: 0 };
  for (const row of rows) counts[reviewGroup(row)] += 1;
  return counts;
}

/** "CNPJ 47.508.411/0001-56 · em 2 casas". */
export function reviewSubtitle(row: Pick<StoreNameReview, 'cnpj' | 'households'>): string {
  return `CNPJ ${formatCnpj(row.cnpj)} · em ${row.households} ${row.households === 1 ? 'casa' : 'casas'}`;
}

/** O que a Receita disse. */
export function receitaLine(row: Pick<StoreNameReview, 'receita_status' | 'receita_trade_name'>): string {
  switch (row.receita_status) {
    case 'pendente':
      return 'Consultando a Receita…';
    case 'ok':
      return `Nome fantasia na Receita: ${row.receita_trade_name}`;
    case 'sem_fantasia':
      return row.receita_trade_name
        ? `Nome fantasia na Receita: ${row.receita_trade_name} (igual à razão social ou longo demais)`
        : 'Sem nome fantasia na Receita.';
    case 'pessoa':
      return 'Cadastro de pessoa (MEI ou individual): nada da Receita é guardado.';
    case 'sem_dados':
      return 'A Receita não disse se é empresa ou pessoa.';
    case 'nao_achou':
      return 'CNPJ não encontrado na Receita.';
    case 'erro':
      return 'A Receita não respondeu depois de 5 tentativas.';
  }
}

/** A razão social da Receita, quando ela não é o próprio nome da nota. */
export function legalNameLine(row: Pick<StoreNameReview, 'receita_name' | 'note_name'>): string | null {
  return row.receita_name && row.receita_name !== row.note_name ? `Razão social: ${row.receita_name}` : null;
}

/** "Apelidos nas casas: Pão de Açúcar (2 casas), Pão de Açúcar Miramar". */
export function nicknamesLine(row: Pick<StoreNameReview, 'nicknames'>): string | null {
  if (!row.nicknames.length) return null;
  const names = row.nicknames.map((n) => (n.households > 1 ? `${n.name} (${n.households} casas)` : n.name));
  return `Apelidos nas casas: ${names.join(', ')}`;
}

/**
 * Os nomes padrão das outras lojas da empresa, para um toque pôr no campo: "Pão de Açúcar (3 lojas)". Só
 * sugestões: uma empresa pode ter mais de uma bandeira (a do Pão de Açúcar tem também o Extra).
 */
export function companyNameOptions(row: Pick<StoreNameReview, 'company_names'>): { name: string; label: string }[] {
  return row.company_names.map((c) => ({ name: c.name, label: c.stores > 1 ? `${c.name} (${c.stores} lojas)` : c.name }));
}

export const COMPANY_NAMES_TITLE = 'Nomes de outras lojas da empresa';

/** A decisão de agora: o nome padrão e de onde veio, ou o nome da nota que ficou. null: nenhuma ainda. */
export function decisionLine(row: Pick<StoreNameReview, 'name' | 'source' | 'reviewed_at'>): string | null {
  if (row.name) return `Nome padrão: ${row.name} (${row.source === 'receita' ? 'da Receita' : 'revisado'})`;
  if (row.reviewed_at) return 'Revisado: fica o nome da nota.';
  return null;
}

/**
 * O nome que o campo já traz: o padrão de agora; senão o apelido que mais casas deram; senão o nome fantasia da
 * Receita, se couber; senão nada.
 */
export function suggestedName(row: Pick<StoreNameReview, 'name' | 'nicknames' | 'receita_trade_name'>): string {
  if (row.name) return row.name;
  if (row.nicknames.length) return row.nicknames[0].name;
  if (row.receita_trade_name && [...row.receita_trade_name].length <= STORE_NAME_MAX) return row.receita_trade_name;
  return '';
}

/** Consultar a Receita de novo: quando ela não deu o nome (não esperando a resposta). */
export function canLookupAgain(row: Pick<StoreNameReview, 'receita_status'>): boolean {
  return row.receita_status !== 'pendente' && row.receita_status !== 'ok';
}

/**
 * O endereço no mapa, para ver a fachada da loja. Só o endereço: o nome da nota de um MEI é o nome da pessoa.
 * null sem endereço.
 */
export function mapsUrl(row: Pick<StoreNameReview, 'address'>): string | null {
  if (!row.address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.address)}`;
}

/** O CNPJ numa busca da web (os sites de cadastro mostram o nome da loja). */
export function cnpjSearchUrl(row: Pick<StoreNameReview, 'cnpj'>): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`CNPJ ${formatCnpj(row.cnpj)}`)}`;
}
