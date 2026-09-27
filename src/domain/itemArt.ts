// Ilustração própria para os itens mais comprados (banana, arroz, leite…),
// escolhida pelo nome. Sem regra que case, fica a ilustração da categoria.
// As imagens ficam em src/ui/itemArt.ts; um teste garante uma por chave.

import { normalizeSearch } from './search';

// Vence o termo que aparece primeiro no nome: o produto vem antes do sabor
// ou do ingrediente ("iogurte de morango" é iogurte, "chocolate ao leite" é
// chocolate). No empate, vale a regra que vem antes, a mais específica
// ("pao de forma" antes de "pao", "couve flor" antes de "couve"). Cada termo
// casa como palavra inteira, com ou sem "s" no fim, no nome sem acento.
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
  ['carne', ['carne', 'bife', 'patinho', 'alcatra', 'contrafile', 'picanha', 'acem', 'costela', 'maminha', 'fraldinha', 'musculo', 'coxao', 'file mignon', 'bisteca', 'lombo', 'pernil', 'figado']],
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
  ['refrigerante', ['refrigerante', 'refri', 'guarana', 'coca']],
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

// Nomes em que a palavra engana: a ilustração da categoria fica melhor.
const EXCEPTIONS = ['caldo', 'filtro de cafe', 'pao de queijo', 'batata palha', 'batata chips', 'batata frita', 'doce de leite', 'leite condensado', 'creme de leite', 'leite de coco', 'agua de coco'];

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRegex = (term: string) => new RegExp(`(?:^|[^a-z0-9])${escape(term)}s?(?=[^a-z0-9]|$)`);

const COMPILED = RULES.map(([key, terms]) => [key, terms.map(wordRegex)] as const);
const EXCEPTION_REGEXES = EXCEPTIONS.map(wordRegex);

/** Chave da ilustração do item pelo nome, ou null para usar a da categoria. */
export function matchItemArt(name: string): ItemArtKey | null {
  const text = normalizeSearch(name).replace(/-/g, ' ');
  if (!text || EXCEPTION_REGEXES.some((re) => re.test(text))) return null;
  let best: { key: ItemArtKey; index: number } | null = null;
  for (const [key, regexes] of COMPILED) {
    for (const re of regexes) {
      const index = re.exec(text)?.index;
      if (index !== undefined && (!best || index < best.index)) best = { key, index };
    }
  }
  return best?.key ?? null;
}
