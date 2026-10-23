// O nome do mercado. Ele chega com o nome impresso na nota, a razão social do CNPJ ("COMPANHIA BRASILEIRA DE
// DISTRIBUICAO" é o Pão de Açúcar), e a casa pode dar outro. O nome que a casa deu fica em stores.name, que
// todas as telas mostram; o de antes vai para stores.printed_name enquanto o nome for outro. Quem guarda e
// limpa o de antes é o banco (supabase/migrations/20261022170000_store_printed_name.sql): aqui, só o que a tela
// precisa. O mercado com CNPJ veio de uma nota (QR code ou foto), e o nome de antes é o dela; o sem CNPJ pode
// ter sido digitado ("Criar" no seletor), e aí a tela fala do "nome anterior".
//
// O CNPJ também tem um nome padrão (stores.standard_name), o mesmo nas casas que não deram outro: o nome
// fantasia da Receita ou o que a moderação escolheu (20261023120000_store_standard_names.sql). O banco grava o
// nome padrão em stores.name dessas casas; a casa que deu outro nome pode voltar a ele. Puro.

import type { Store } from '@/lib/types';

/** O nome tem de 1 a 60 letras. */
export const STORE_NAME_MAX = 60;

export const STORE_RENAME_TITLE = 'Nome do mercado';
export const STORE_RENAME_LABEL = 'Como vocês chamam este mercado';
export const STORE_CHAIN_TITLE = 'Outras lojas da mesma empresa';
export const STORE_CHAIN_HINT = 'Marque as que também devem ter este nome.';
export const STORE_RENAME_GONE = 'Este mercado não foi encontrado na casa aberta. A lista de mercados foi atualizada.';

/** O nome como ele é gravado: sem espaços nas pontas nem repetidos no meio. */
export function cleanStoreName(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** O que a tela diz do nome digitado, ou null quando ele serve. */
export function storeNameError(text: string): string | null {
  const name = cleanStoreName(text);
  if (!name) return 'Escreva o nome do mercado.';
  if ([...name].length > STORE_NAME_MAX) return `Use até ${STORE_NAME_MAX} letras.`;
  return null;
}

/**
 * Dá para renomear: a leitura dos mercados trouxe a coluna do nome impresso (null, quando ele é o próprio
 * nome). Sem ela (o banco antes da migração, ou o que ficou guardado no aparelho de antes), o nome da nota se
 * perderia na troca, e o botão não aparece.
 */
export function canRenameStore(store: Pick<Store, 'printed_name'>): boolean {
  return store.printed_name !== undefined;
}

/** Embaixo do nome: vale para toda a casa e, no mercado de nota, o nome dela fica guardado. */
export function storeRenameHint(store: Pick<Store, 'cnpj'>): string {
  return store.cnpj ? 'Vale para toda a casa. O nome que vem na nota fica guardado.' : 'Vale para toda a casa.';
}

/**
 * O nome guardado que é o "CNPJ …" que o app põe quando a nota não trouxe nome. O banco o guarda para saber
 * que a nota não tinha nome; a tela não o mostra, nem oferece voltar a ele.
 */
function printedIsPlaceholder(store: Pick<Store, 'printed_name' | 'cnpj'>): boolean {
  return Boolean(store.cnpj) && store.printed_name === `CNPJ ${store.cnpj}`;
}

/** O nome guardado que a tela mostra: nenhum quando não há, ou quando é o "CNPJ …". */
function shownPrinted(store: Pick<Store, 'printed_name' | 'cnpj'>): string | null {
  return store.printed_name && !printedIsPlaceholder(store) ? store.printed_name : null;
}

/**
 * "Na nota: COMPANHIA BRASILEIRA DE DISTRIBUICAO" ("Nome anterior: …" no mercado sem CNPJ), só quando a casa
 * deu outro nome.
 */
export function printedNameLine(store: Pick<Store, 'printed_name' | 'cnpj'>): string | null {
  const printed = shownPrinted(store);
  if (!printed) return null;
  return store.cnpj ? `Na nota: ${printed}` : `Nome anterior: ${printed}`;
}

/** O botão que desfaz a troca, só quando a casa deu outro nome. */
export function backToPrintedLabel(store: Pick<Store, 'printed_name' | 'cnpj'>): string | null {
  if (!shownPrinted(store)) return null;
  return store.cnpj ? 'Voltar ao nome da nota' : 'Voltar ao nome anterior';
}

/**
 * Desfazer a troca: o nome guardado, como está, sem a limpeza nem o limite do nome digitado. O banco o
 * compara letra por letra para limpar o guardado.
 */
export function storeRevertChange(store: Pick<Store, 'id' | 'printed_name' | 'cnpj'>): { name: string; ids: string[] } | null {
  const printed = shownPrinted(store);
  return printed ? { name: printed, ids: [store.id] } : null;
}

/** Embaixo do nome, quando ele é o nome padrão do CNPJ. */
export const STORE_STANDARD_LINE = 'Este é o nome padrão do mercado no Kotii.';
/** "Usar o nome padrão" não gravou: o mercado não tem mais nome padrão (ou não é da casa aberta). */
export const STORE_STANDARD_GONE = 'O nome padrão deste mercado mudou. A lista de mercados foi atualizada.';

/** O mercado está com o nome padrão do CNPJ. */
export function hasStandardName(store: Pick<Store, 'name' | 'standard_name'>): boolean {
  return Boolean(store.standard_name) && store.name === store.standard_name;
}

/** O botão que volta ao nome padrão, só quando há um e a casa usa outro nome. */
export function standardNameLabel(store: Pick<Store, 'name' | 'standard_name'>): string | null {
  return store.standard_name && store.name !== store.standard_name ? `Usar o nome padrão: ${store.standard_name}` : null;
}

/** "47.508.411/0001-56"; o que não tem 14 dígitos, como veio. */
export function formatCnpj(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '');
  return digits.length === 14
    ? `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
    : cnpj;
}

/** A empresa do CNPJ: os 8 primeiros dígitos, os mesmos em todas as lojas dela. */
export function storeCompany(cnpj: string | null): string | null {
  return cnpj && /^\d{14}$/.test(cnpj) ? cnpj.slice(0, 8) : null;
}

/**
 * As outras lojas da casa com a mesma empresa no CNPJ, pelo nome. Uma empresa pode ter mais de uma bandeira
 * (a do Pão de Açúcar tem também o Extra e o Minuto), então a tela só as oferece: quem marca é a pessoa.
 */
export function sameCompanyStores(stores: readonly Store[], store: Pick<Store, 'id' | 'cnpj'>): Store[] {
  const company = storeCompany(store.cnpj);
  if (!company) return [];
  return stores
    .filter((other) => other.id !== store.id && storeCompany(other.cnpj) === company)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * A troca a gravar, ou null quando não há o que gravar: o nome novo para o mercado e para as lojas marcadas da
 * mesma empresa que ainda não se chamam assim.
 */
export function storeRenameChange(
  store: Pick<Store, 'id' | 'name'>,
  text: string,
  others: readonly Pick<Store, 'id' | 'name'>[] = [],
): { name: string; ids: string[] } | null {
  if (storeNameError(text)) return null;
  const name = cleanStoreName(text);
  const ids = [store, ...others].filter((s) => s.name !== name).map((s) => s.id);
  return ids.length ? { name, ids } : null;
}
