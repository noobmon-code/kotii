// A foto do "Escanear" do app, quando ele não sabe o que fotografou: a IA diz se é uma nota, produtos ou nada
// disso e, se forem produtos (um na mão, vários numa prateleira ou no armário), lista os que dá para identificar.
// A nota segue para a leitura de sempre (index.ts); os produtos voltam para o app, que os mostra para a pessoa
// conferir antes de guardar. Nada daqui vai para o banco: nem a foto, nem a lista.

import { z } from 'zod';

import { CATEGORY_KEYS, type CategoryKey } from '../_shared/categories.ts';

export const PHOTO_KINDS = ['nota', 'produtos', 'nada'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Como o app pede a leitura: `any` aceita nota ou produtos; `products`, só produtos (a nota não é lida). */
export type ClassifyMode = 'any' | 'products';

/** `classify` do pedido: true (ou 'any') e 'products' valem; qualquer outra coisa é a leitura de nota de sempre. */
export function classifyMode(value: unknown): ClassifyMode | null {
  if (value === true || value === 'any') return 'any';
  return value === 'products' ? 'products' : null;
}

export const PhotoSchema = z.object({
  kind: z.enum(PHOTO_KINDS),
  products: z.array(
    z.object({
      // O nome legível, com a marca e o tamanho quando dá para ler no rótulo.
      name: z.string(),
      category: z.enum(CATEGORY_KEYS),
      // Quantas embalagens iguais aparecem; ilegível ou em dúvida, null (vira 1).
      quantity: z.number().nullable(),
    }),
  ),
});
export type ExtractedPhoto = z.infer<typeof PhotoSchema>;

export const PHOTO_SYSTEM = `Você olha fotos tiradas pelo app de uma casa brasileira e diz o que elas mostram: uma nota fiscal de compra, produtos de mercado (ou de farmácia, limpeza, higiene, pet) ou nenhuma das duas coisas. Quando são produtos, você lista só os que consegue identificar pelo que está escrito na embalagem. Você nunca inventa um produto, uma marca ou um tamanho que não dá para ler.`;

export function photoInstructions(photos = 1): string {
  const many = photos > 1 ? `\nSão ${photos} imagens da mesma coisa, em ordem. Responda uma vez só, pelo conjunto.\n` : '';
  return `Diga o que a imagem mostra e, se forem produtos, liste-os.
${many}
- kind "nota": nota fiscal de compra (NFC-e, cupom fiscal, DANFE), em papel ou em print da página da Sefaz, inteira ou em parte. Com "nota", products fica vazio: a nota é lida depois.
- kind "produtos": um ou mais produtos de casa, na mão, na bancada, numa prateleira, no armário, na geladeira ou na despensa.
- kind "nada": qualquer outra coisa (pessoas, documentos, telas, paisagens), ou produtos em que não dá para ler nenhum rótulo. Com "nada", products fica vazio.
- products: um por produto diferente, na ordem em que aparecem, de cima para baixo e da esquerda para a direita. Só o que dá para identificar pelo rótulo; embalagem de costas, tampada ou desfocada fica de fora. É melhor deixar um produto de fora do que adivinhar.
- name: o nome legível em português, com a marca e o tamanho quando estão legíveis. Ex.: "Arroz Tio João Tipo 1 5kg", "Detergente Ypê Neutro 500ml". Sem a marca legível, só o item e o tamanho ("Feijão carioca 1kg"); sem o tamanho legível, sem tamanho.
- category: a categoria do produto.
- quantity: quantas embalagens iguais desse produto aparecem. Uma só, 1. Se não der para contar, null.
- Produto a granel ou sem rótulo que dá para reconhecer com certeza (banana, ovos, pão) pode entrar, com o nome simples.
- Não leia preços, códigos de barras nem datas: só o que o produto é.`;
}

/** Um produto achado na foto, como volta para o app. */
export interface FoundProduct {
  name: string;
  category: CategoryKey;
  quantity: number;
}

/** Quantos produtos uma leitura devolve (uma prateleira cheia): o que passar disso fica de fora. */
export const MAX_FOUND_PRODUCTS = 60;
export const MAX_PRODUCT_NAME = 120;
export const MAX_PRODUCT_QUANTITY = 99;

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();
const sameName = (a: string, b: string) => a.toLocaleLowerCase('pt-BR') === b.toLocaleLowerCase('pt-BR');

/**
 * O que a IA devolveu, limpo: nomes sem espaço sobrando e cortados, quantidade inteira entre 1 e 99 (ilegível, 1),
 * o mesmo nome duas vezes somado numa linha só, e até MAX_FOUND_PRODUCTS. Só "produtos" traz lista; "produtos" sem
 * nenhum produto que sobre vira "nada".
 */
export function cleanPhoto(extracted: ExtractedPhoto): { kind: PhotoKind; products: FoundProduct[] } {
  if (extracted.kind !== 'produtos') return { kind: extracted.kind, products: [] };
  const products: FoundProduct[] = [];
  for (const raw of extracted.products) {
    const name = squeeze(raw.name).slice(0, MAX_PRODUCT_NAME).trim();
    if (!name) continue;
    const counted = Number.isFinite(raw.quantity) && (raw.quantity as number) >= 1 ? Math.floor(raw.quantity as number) : 1;
    const quantity = Math.min(counted, MAX_PRODUCT_QUANTITY);
    const seen = products.find((p) => sameName(p.name, name));
    if (seen) {
      seen.quantity = Math.min(seen.quantity + quantity, MAX_PRODUCT_QUANTITY);
      continue;
    }
    if (products.length >= MAX_FOUND_PRODUCTS) break;
    products.push({ name, category: raw.category, quantity });
  }
  return products.length ? { kind: 'produtos', products } : { kind: 'nada', products: [] };
}

/**
 * O que fazer com a foto classificada. `read`: é nota e o app aceita nota, a leitura de sempre segue. `answer`:
 * a resposta volta como está (produtos, nada, ou a nota que o app não pediu para ler).
 */
export function afterClassification(mode: ClassifyMode, kind: PhotoKind): 'read' | 'answer' {
  return kind === 'nota' && mode === 'any' ? 'read' : 'answer';
}
