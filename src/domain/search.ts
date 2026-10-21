/** Minúsculas e sem acento, para busca tolerante ("feijao" acha "Feijão"). */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Palavra-chave -> categoria, para itens digitados livremente na lista.
// Vence a palavra que aparece primeiro no nome ("Ração sabor frango" é pet);
// no mesmo lugar, a que vem antes aqui ("agua sanitaria" antes de "agua").
const KEYWORDS: [string, string][] = [
  ['agua sanitaria', 'limpeza'],
  // A batata frita é a congelada, não a do hortifruti (que "batata", mais abaixo, pegaria no mesmo lugar).
  ['batata frita', 'congelados'],
  ['batata pre frita', 'congelados'],
  ['batata palito', 'congelados'],
  ['papel higienico', 'papel'],
  ['papel toalha', 'papel'],
  ['guardanapo', 'papel'],
  ['guarana', 'bebidas'],
  // Como a nota abrevia a bebida: o sabor que vem depois ("REFRIG FANTA LARANJA", "REFRIG COCA S/ACUCAR") não decide.
  ['refrig', 'bebidas'],
  ['refri', 'bebidas'],
  ['cerveja', 'alcoolicas'],
  ['cerv', 'alcoolicas'],
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
 * Onde a nota fiscal escreve a palavra-chave de mais de uma palavra com a
 * última cortada ("AGUA SANIT", "PAPEL HIG"), ou -1. As de antes vêm
 * inteiras, e da última ficam 3 letras ou mais.
 */
function cutKeywordAt(text: string, keyword: string): number {
  const words = keyword.split(' ');
  const last = words.pop()!;
  const head = ` ${words.join(' ')} `;
  for (let at = text.indexOf(head); at >= 0; at = text.indexOf(head, at + 1)) {
    const cut = text.slice(at + head.length).split(' ')[0];
    if (cut.length >= 3 && cut.length < last.length && last.startsWith(cut)) return at;
  }
  return -1;
}

/**
 * Chute de categoria: palavra inteira, ou prefixo de palavra para palavras-chave
 * com 5+ letras ("congelad" acha "congelados", mas "sal" não acha "salmão").
 * `abbreviated`: descrição de nota fiscal, que abrevia ("DETERG", "CONGEL");
 * só para ela, porque num nome digitado "guarda chuva" viraria guardanapo.
 */
export function guessCategory(name: string, { abbreviated = false }: { abbreviated?: boolean } = {}): string {
  const text = ` ${normalizeSearch(name).replace(/[^a-z0-9-]+/g, ' ').trim()} `;
  let best: { at: number; category: string } | null = null;
  for (const [keyword, category] of KEYWORDS) {
    const whole = text.indexOf(` ${keyword} `);
    let at = whole >= 0 ? whole : keyword.length >= 5 ? text.indexOf(` ${keyword}`) : -1;
    if (at < 0 && abbreviated && keyword.includes(' ')) at = cutKeywordAt(text, keyword);
    if (at >= 0 && (!best || at < best.at)) best = { at, category };
  }
  if (best) return best.category;
  if (!abbreviated) return 'outros';
  // Palavra de 5+ letras que é o começo de uma palavra-chave; também aqui, vence a que vem primeiro no nome.
  const words = text.trim().split(' ');
  for (const word of words) {
    if (word.length < 5 || !/^[a-z]+$/.test(word)) continue;
    const found = KEYWORDS.find(([keyword]) => !keyword.includes(' ') && keyword.startsWith(word));
    if (found) return found[1];
  }
  return 'outros';
}
