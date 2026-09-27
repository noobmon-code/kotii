/** Minúsculas e sem acento, para busca tolerante ("feijao" acha "Feijão"). */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Palavra-chave -> categoria, para itens digitados livremente na lista.
// Ordem importa: a primeira palavra encontrada vence.
const KEYWORDS: [string, string][] = [
  ['agua sanitaria', 'limpeza'],
  ['papel higienico', 'papel'],
  ['papel toalha', 'papel'],
  ['guardanapo', 'papel'],
  ['guarana', 'bebidas'],
  ['cerveja', 'alcoolicas'],
  ['vinho', 'alcoolicas'],
  ['cachaca', 'alcoolicas'],
  ['arroz', 'graos'],
  ['feijao', 'graos'],
  ['macarrao', 'graos'],
  ['massa', 'graos'],
  ['farinha', 'graos'],
  ['aveia', 'graos'],
  ['lentilha', 'graos'],
  ['granola', 'graos'],
  ['cereal', 'graos'],
  ['leite', 'laticinios'],
  ['iogurte', 'laticinios'],
  ['queijo', 'laticinios'],
  ['requeijao', 'laticinios'],
  ['manteiga', 'laticinios'],
  ['creme de leite', 'laticinios'],
  ['ovo', 'ovos'],
  ['ovos', 'ovos'],
  ['pao', 'padaria'],
  ['bolo', 'padaria'],
  ['torrada', 'padaria'],
  ['carne', 'carnes'],
  ['frango', 'carnes'],
  ['patinho', 'carnes'],
  ['alcatra', 'carnes'],
  ['picanha', 'carnes'],
  ['linguica', 'carnes'],
  ['peixe', 'peixes'],
  ['salmao', 'peixes'],
  ['tilapia', 'peixes'],
  ['camarao', 'peixes'],
  ['atum', 'peixes'],
  ['presunto', 'frios'],
  ['mortadela', 'frios'],
  ['salame', 'frios'],
  ['peito de peru', 'frios'],
  ['congelad', 'congelados'],
  ['sorvete', 'congelados'],
  ['pizza', 'congelados'],
  ['chocolate', 'doces'],
  ['biscoito', 'doces'],
  ['bolacha', 'doces'],
  ['acucar', 'doces'],
  ['doce', 'doces'],
  ['salgadinho', 'snacks'],
  ['batata chips', 'snacks'],
  ['pipoca', 'snacks'],
  ['sal', 'temperos'],
  ['tempero', 'temperos'],
  ['molho', 'temperos'],
  ['ketchup', 'temperos'],
  ['maionese', 'temperos'],
  ['vinagre', 'temperos'],
  ['oleo', 'oleos'],
  ['azeite', 'oleos'],
  ['agua', 'bebidas'],
  ['suco', 'bebidas'],
  ['refrigerante', 'bebidas'],
  ['cafe', 'cafe_cha'],
  ['cha', 'cafe_cha'],
  ['detergente', 'limpeza'],
  ['sabao', 'limpeza'],
  ['amaciante', 'limpeza'],
  ['desinfetante', 'limpeza'],
  ['esponja', 'limpeza'],
  ['limpador', 'limpeza'],
  ['saco de lixo', 'limpeza'],
  ['shampoo', 'higiene'],
  ['condicionador', 'higiene'],
  ['sabonete', 'higiene'],
  ['pasta de dente', 'higiene'],
  ['creme dental', 'higiene'],
  ['escova', 'higiene'],
  ['desodorante', 'higiene'],
  ['absorvente', 'higiene'],
  ['fralda', 'bebe'],
  ['lenco umedecido', 'bebe'],
  ['racao', 'pet'],
  ['areia', 'pet'],
  ['dipirona', 'medicamentos'],
  ['paracetamol', 'medicamentos'],
  ['ibuprofeno', 'medicamentos'],
  ['remedio', 'medicamentos'],
  ['vitamina', 'suplementos'],
  ['whey', 'suplementos'],
  ['creatina', 'suplementos'],
  ['curativo', 'primeiros_socorros'],
  ['band-aid', 'primeiros_socorros'],
  ['gaze', 'primeiros_socorros'],
  ['banana', 'hortifruti'],
  ['maca', 'hortifruti'],
  ['laranja', 'hortifruti'],
  ['limao', 'hortifruti'],
  ['tomate', 'hortifruti'],
  ['cebola', 'hortifruti'],
  ['alho', 'hortifruti'],
  ['batata', 'hortifruti'],
  ['cenoura', 'hortifruti'],
  ['alface', 'hortifruti'],
  ['fruta', 'hortifruti'],
  ['verdura', 'hortifruti'],
  ['legume', 'hortifruti'],
];

/**
 * Chute de categoria: palavra inteira, ou prefixo de palavra para palavras-chave
 * com 5+ letras ("congelad" acha "congelados", mas "sal" não acha "salmão").
 */
export function guessCategory(name: string): string {
  const text = ` ${normalizeSearch(name).replace(/[^a-z0-9-]+/g, ' ').trim()} `;
  for (const [keyword, category] of KEYWORDS) {
    if (text.includes(` ${keyword} `) || (keyword.length >= 5 && text.includes(` ${keyword}`))) return category;
  }
  // Abreviação de nota fiscal ("DETERG", "CONGEL"): palavra de 5+ letras que
  // é o começo de uma palavra-chave.
  const words = text.trim().split(' ').filter((word) => word.length >= 5 && /^[a-z]+$/.test(word));
  for (const [keyword, category] of KEYWORDS) {
    if (!keyword.includes(' ') && words.some((word) => keyword.startsWith(word))) return category;
  }
  return 'outros';
}
