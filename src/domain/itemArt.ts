// Ilustração própria para os itens mais comprados (banana, arroz, leite…),
// escolhida pelo nome. Sem regra que case, fica a ilustração da categoria.
// As imagens ficam em src/ui/itemArt.ts; um teste garante uma por chave.
// Estas regras são também o vocabulário do "mesmo item" da lista e da nota
// (domain/sameItem), que separa o que aqui divide um desenho só ("margarina"
// e "manteiga").

import { compileTerms, firstMention, firstProductTerm, termRegex, termText } from './itemTerms';

// Vence o termo que aparece primeiro no nome: o produto vem antes do sabor
// ou do ingrediente ("iogurte de morango" é iogurte, "chocolate ao leite" é
// chocolate). No empate, vale a regra que vem antes, a mais específica
// ("pao de forma" antes de "pao", "couve flor" antes de "couve"). Cada termo
// casa como palavra inteira, no singular ou no plural, no nome sem acento
// (domain/itemTerms).
const RULES = [
  ['agua_sanitaria', ['agua sanitaria', 'alvejante', 'cloro']],
  ['suco', ['suco']],
  ['molho_tomate', ['molho de tomate', 'extrato de tomate', 'polpa de tomate']],
  ['peito_frango', ['peito de frango', 'file de frango', 'sassami']],
  ['pao_forma', ['pao de forma', 'pao integral', 'bisnaguinha']],
  ['pao_frances', ['pao frances', 'pao de hamburguer', 'baguete', 'pao', 'paes']],
  ['papel_higienico', ['papel higienico']],
  ['pasta_dente', ['pasta de dente', 'creme dental']],
  ['sabao_po', ['sabao em po', 'sabao liquido', 'lava roupas', 'sabao']],
  ['banana', ['banana']],
  ['maca', ['maca']],
  ['laranja', ['laranja']],
  ['limao', ['limao', 'limoes', 'lima']],
  ['morango', ['morango']],
  ['uva', ['uva']],
  ['abacaxi', ['abacaxi']],
  ['melancia', ['melancia']],
  ['mamao', ['mamao', 'papaia']],
  ['tomate', ['tomate']],
  ['cebola', ['cebola']],
  ['alho', ['alho']],
  ['batata', ['batata']],
  ['cenoura', ['cenoura']],
  ['alface', ['alface', 'rucula']],
  ['brocolis', ['brocolis', 'couve flor']],
  ['pimentao', ['pimentao']],
  ['abacate', ['abacate']],
  ['bacon', ['bacon']],
  ['hamburguer', ['hamburguer']],
  ['linguica', ['linguica', 'salsicha']],
  ['frango', ['frango', 'coxa', 'sobrecoxa', 'galeto']],
  // "Bombom de alcatra" é um corte: no mesmo lugar, vence o bombom de chocolate, que vem depois.
  ['carne', ['carne', 'bombom de alcatra', 'bombom de picanha', 'bombom de contrafile', 'bife', 'patinho', 'alcatra', 'contrafile', 'picanha', 'acem', 'costela', 'maminha', 'fraldinha', 'musculo', 'coxao', 'lagarto', 'cupim', 'file mignon', 'bisteca', 'lombo', 'pernil', 'figado']],
  ['peixe', ['peixe', 'tilapia', 'salmao', 'merluza', 'pescada', 'bacalhau']],
  ['camarao', ['camarao', 'camaroes']],
  ['atum', ['atum', 'sardinha']],
  ['ovos', ['ovo']],
  ['requeijao', ['requeijao', 'cream cheese']],
  ['iogurte', ['iogurte', 'bebida lactea']],
  ['manteiga', ['manteiga', 'margarina']],
  ['queijo', ['queijo', 'mucarela', 'mussarela', 'parmesao']],
  ['leite', ['leite']],
  ['bolo', ['bolo', 'rosca']],
  ['presunto', ['presunto', 'peito de peru', 'mortadela', 'salame']],
  ['arroz', ['arroz']],
  ['feijao', ['feijao']],
  ['macarrao', ['macarrao', 'espaguete', 'penne', 'talharim']],
  ['farinha', ['farinha', 'fuba', 'amido de milho']],
  ['acucar', ['acucar', 'adocante']],
  ['sal', ['sal']],
  ['oleo', ['oleo']],
  ['cafe', ['cafe']],
  ['agua', ['agua']],
  ['refrigerante', ['refrigerante', 'refri', 'guarana', 'coca', 'fanta', 'sprite', 'pepsi', 'sukita', 'kuat']],
  ['cerveja', ['cerveja']],
  ['chocolate', ['chocolate', 'bombom', 'achocolatado']],
  ['biscoito', ['biscoito', 'bolacha', 'cookie', 'cream cracker']],
  ['detergente', ['detergente']],
  ['amaciante', ['amaciante']],
  ['esponja', ['esponja', 'palha de aco']],
  ['sabonete', ['sabonete']],
  ['shampoo', ['shampoo', 'xampu', 'condicionador']],
  ['pizza', ['pizza']],
  ['sorvete', ['sorvete', 'picole']],
  ['mexerica', ['mexerica', 'tangerina', 'bergamota', 'ponkan']],
  ['melao', ['melao']],
  ['manga', ['manga']],
  ['pepino', ['pepino']],
  ['abobrinha', ['abobrinha']],
  ['beterraba', ['beterraba']],
  ['mandioca', ['mandioca', 'aipim', 'macaxeira']],
  ['repolho', ['repolho', 'couve']],
  ['milho', ['milho']],
  ['cereal', ['cereal', 'aveia', 'granola']],
  ['nuggets', ['nuggets', 'nugget', 'empanado']],
  ['ketchup', ['ketchup', 'mostarda']],
  ['maionese', ['maionese']],
  ['mel', ['mel']],
  ['cha', ['cha']],
  ['escova_dente', ['escova de dente', 'escova dental']],
  ['desodorante', ['desodorante', 'antitranspirante']],
  ['saco_lixo', ['saco de lixo', 'saco para lixo']],
] as const;

export type ItemArtKey = (typeof RULES)[number][0];
export const ITEM_ART_KEYS: readonly ItemArtKey[] = RULES.map(([key]) => key);
/** As regras dos desenhos, na ordem em que valem. */
export const ITEM_ART_RULES: readonly (readonly [ItemArtKey, readonly string[]])[] = RULES;

// Nomes em que a palavra engana: a ilustração da categoria fica melhor. Só
// valem quando são o próprio produto ("leite condensado"), não o sabor de
// outro que vem antes ("bolo de leite condensado" é bolo).
export const ITEM_ART_EXCEPTIONS: readonly string[] = ['caldo', 'filtro de cafe', 'pao de queijo', 'batata palha', 'batata chips', 'batata frita', 'doce de leite', 'leite condensado', 'creme de leite', 'leite de coco', 'agua de coco'];

const COMPILED = compileTerms(RULES);
const EXCEPTION_REGEXES = ITEM_ART_EXCEPTIONS.map(termRegex);

// Desenhos de casa (limpeza, higiene, papel); os outros são de comida e
// bebida. Com a categoria do item, o desenho precisa ser do mesmo grupo:
// "Água oxigenada" em higiene não vira garrafa d'água, nem "Leite de
// magnésia" em remédios vira leite.
const HOUSE_KEYS: ReadonlySet<ItemArtKey> = new Set<ItemArtKey>([
  'agua_sanitaria', 'amaciante', 'desodorante', 'detergente', 'escova_dente', 'esponja', 'papel_higienico',
  'pasta_dente', 'sabao_po', 'sabonete', 'saco_lixo', 'shampoo',
]);
const HOUSE_CATEGORIES = new Set(['limpeza', 'higiene', 'papel', 'bebe']);
const FOOD_CATEGORIES = new Set([
  'hortifruti', 'carnes', 'peixes', 'laticinios', 'ovos', 'padaria', 'graos', 'congelados', 'frios', 'doces', 'snacks',
  'temperos', 'oleos', 'bebidas', 'alcoolicas', 'cafe_cha',
]);

/** O grupo da categoria: casa (limpeza, higiene, papel, bebê), comida e bebida, ou nenhum dos dois (pet, remédios…). */
export function categoryGroup(category: string): 'casa' | 'comida' | null {
  return HOUSE_CATEGORIES.has(category) ? 'casa' : FOOD_CATEGORIES.has(category) ? 'comida' : null;
}

/** O desenho é de casa (limpeza, higiene, papel) ou de comida. */
export const isHouseArt = (key: ItemArtKey) => HOUSE_KEYS.has(key);

function fitsCategory(key: ItemArtKey, category: string | null | undefined): boolean {
  if (!category || category === 'outros') return true;
  return categoryGroup(category) === (HOUSE_KEYS.has(key) ? 'casa' : 'comida');
}

/**
 * Chave da ilustração do item pelo nome, ou null para usar a da categoria.
 * Com `category`, só vale um desenho do mesmo grupo (comida ou casa).
 */
export function matchItemArt(name: string, category?: string | null): ItemArtKey | null {
  // A lista redesenha todos os itens a cada toque: o resultado fica guardado.
  const cacheKey = `${category ?? ''}\u0000${name}`;
  const cached = CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const key = matchByName(name);
  const result = key && fitsCategory(key, category) ? key : null;
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  CACHE.set(cacheKey, result);
  return result;
}

const CACHE_LIMIT = 2000;
const CACHE = new Map<string, ItemArtKey | null>();

function matchByName(name: string): ItemArtKey | null {
  const text = termText(name);
  if (!text) return null;
  const best = firstProductTerm(COMPILED, text);
  if (!best) return null;
  // A exceção no mesmo lugar ou antes do produto é o próprio produto.
  return firstMention(EXCEPTION_REGEXES, text) <= best.index ? null : best.key;
}
