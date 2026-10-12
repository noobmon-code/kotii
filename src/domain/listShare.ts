// A lista de compras em texto, para mandar a quem não tem o app (a avó, a
// babá, o vizinho que está no mercado): pelo WhatsApp, por outro app ou
// copiando. Vai só o que falta comprar, na ordem da tela; nada de preço,
// despensa, foto, quem pôs o item, nome da casa ou o que já está no carrinho
// (isso quem manda vê no menu, não quem recebe). O app só monta o texto: não
// guarda nem envia nada.

import { getCategory } from './categories';
import { compareForShopping, PRIORITIES } from './listItem';
import { formatQuantity } from './money';

/** Até aqui a lista vai corrida; com mais itens a comprar, ganha os nomes das seções. */
export const SECTIONS_ABOVE = 8;

/**
 * Tamanho máximo do texto, já codificado, num link do WhatsApp. Links maiores
 * falham de um jeito ou de outro (navegador, WhatsApp Web): acima disso o
 * texto é copiado e a pessoa cola na conversa.
 */
export const WHATSAPP_MAX_ENCODED = 6000;

/** O que o texto usa de cada item da lista. */
export interface ShareItem {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  notes?: string | null;
  priority?: string | null;
  checked_at?: string | null;
}

const URGENT = 'urgente';

const count = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/**
 * Texto digitado pela pessoa numa linha só. A crase vira apóstrofo: três
 * seguidas abrem no WhatsApp um bloco que atravessa as linhas. Os outros
 * sinais (*, _, ~) ficam como foram digitados: lá a formatação não passa de
 * uma linha para a outra, então não alcançam o título nem as seções.
 */
function oneLine(text: string): string {
  return wellFormed(text).replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Metade solta de um emoji (texto cortado no meio) não tem como ir num link:
 * sai aqui, para a prévia, a cópia e o link levarem o mesmo texto.
 */
function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (match) => (match.length === 2 ? match : ''));
}

/** O nome da lista vai em negrito: um sinal de formatação dentro dele quebraria o negrito. */
function plainTitle(name: string): string {
  return wellFormed(name).replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim() || 'Lista de compras';
}

/** A observação que a pessoa já escreveu entre parênteses não ganha outro par. */
function plainNote(notes: string | null | undefined): string {
  const note = oneLine(notes ?? '');
  return /^\([^()]*\)$/.test(note) ? note.slice(1, -1).trim() : note;
}

/** As palavras da prioridade, como na tela dos detalhes do item; normal não tem. */
function priorityWords(priority: string | null | undefined): string | null {
  const found = PRIORITIES.find((p) => p.key === priority);
  return found && found.key !== 'normal' ? found.label.toLocaleLowerCase('pt-BR') : null;
}

/** Com seções, os urgentes (que a tela põe no topo) ficam na seção deles; o resto, na da categoria. */
function sectionOf(item: ShareItem): string {
  return item.priority === URGENT ? PRIORITIES.find((p) => p.key === URGENT)!.label : getCategory(item.category).label;
}

function itemLine(item: ShareItem, underUrgent: boolean): string {
  const quantity = Number(item.quantity);
  // "1 un" é o item sem mais: sai só o nome.
  const amount = quantity > 0 && !(quantity === 1 && item.unit === 'un') ? `${formatQuantity(quantity, item.unit)} ` : '';
  const notes = plainNote(item.notes);
  // Debaixo do título "Urgente" a palavra não se repete em cada linha.
  const priority = underUrgent && item.priority === URGENT ? null : priorityWords(item.priority);
  return `- ${amount}${oneLine(item.name)}${notes ? ` (${notes})` : ''}${priority ? ` · ${priority}` : ''}`;
}

/**
 * O texto da lista, com as marcas de negrito do WhatsApp no nome da lista e
 * nas seções. Os itens vêm na ordem de "Para comprar" (compareForShopping, a
 * mesma da tela); os do carrinho ficam de fora. Sem nada para comprar, não há
 * o que mandar: null.
 */
export function listShareText(list: { name: string }, items: readonly ShareItem[]): string | null {
  const toBuy = items.filter((i) => !i.checked_at).sort(compareForShopping);
  if (!toBuy.length) return null;
  // Uma seção só (lista toda de limpeza, ou toda em "Outros") seria um título a mais sem dizer nada.
  const sections = toBuy.length > SECTIONS_ABOVE && new Set(toBuy.map(sectionOf)).size > 1;

  const title = `*${plainTitle(list.name)}*`;
  // A quantidade ajuda quem recebe a conferir se pegou tudo; com um item só, não diz nada.
  const lines = [toBuy.length > 1 ? `${title} · ${count(toBuy.length)}` : title];
  let current: string | null = null;
  for (const item of toBuy) {
    const section = sections ? sectionOf(item) : null;
    if (section !== current) {
      lines.push('', `*${section}*`);
      current = section;
    }
    lines.push(itemLine(item, sections));
  }
  return lines.join('\n');
}

/**
 * Para quem manda, no menu: o que fica de fora do texto. Fotos e preços nunca
 * vão; o que já está no carrinho também não (quem recebe não tem carrinho).
 */
export function listShareHint(items: readonly Pick<ShareItem, 'checked_at'>[]): string {
  const inCart = items.filter((i) => i.checked_at).length;
  const cart = inCart ? ` ${inCart === 1 ? 'O item que já está no carrinho não vai' : `Os ${inCart} itens que já estão no carrinho não vão`}.` : '';
  return `Vai só o texto do que falta comprar: sem fotos e sem preços.${cart} No WhatsApp, o que está entre asteriscos aparece em negrito.`;
}

/** Link que abre o WhatsApp com o texto pronto, para escolher a conversa; null quando o texto não cabe num link. */
export function whatsappUrl(text: string): string | null {
  const encoded = encodeURIComponent(text);
  return encoded.length > WHATSAPP_MAX_ENCODED ? null : `https://wa.me/?text=${encoded}`;
}
