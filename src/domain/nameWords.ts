// Palavras que dizem algo sobre um nome de item sem dizer o que ele é
// (embalagem, unidade solta) e as que, logo depois do nome, fazem outra coisa
// ("Leite coco"). Valem para os nomes parecidos (similarNames) e para o "mesmo
// item" da lista e da nota (sameItem): uma lista só, nos dois lugares.

// Embalagem: não muda o produto.
export const PACKAGING: ReadonlySet<string> = new Set([
  'lata', 'latinha', 'garrafa', 'pet', 'vidro', 'frasco', 'pote', 'caixa', 'caixinha', 'pacote', 'pack', 'fardo', 'sache',
  'refil', 'bandeja', 'barra', 'tablete', 'rolo', 'embalagem', 'granel', 'long', 'neck', 'tetra', 'pak',
]);

// Logo depois do nome do item, fazem outra coisa mesmo sem "de" ou "em", que a nota fiscal corta ("Leite coco",
// "Batata palha", "Água tônica", "Óleo motor"). No singular e sem acento. É uma lista fechada, só para o que o app
// faz sem a pessoa pedir (a sugestão de nome, a marca do "mesmo item"): não é para crescer junto com o catálogo de
// itens comuns.
export const OTHER_THING: ReadonlySet<string> = new Set([
  'coco', 'soja', 'queijo', 'palha', 'tonica', 'oxigenada', 'sanitaria', 'poro', 'cacau', 'fruta', 'lactea', 'fermentado',
  'condensado', 'evaporado', 'toalha', 'higienico', 'po', 'doce', 'instantaneo', 'vegetal', 'ingles', 'chips', 'alho',
  'motor', 'passa', 'empanado', 'frita', 'frito',
]);

// Unidade solta ("Banana Prata Kg", "Alface Unidade") não diz o que é o item nem o tamanho.
export const LOOSE_UNITS: ReadonlySet<string> = new Set([
  'kg', 'gr', 'mg', 'ml', 'lt', 'un', 'und', 'unid', 'pct', 'pc', 'cx', 'fd', 'cm', 'mm',
  'litro', 'litros', 'quilo', 'quilos', 'kilo', 'kilos', 'grama', 'gramas', 'unidade', 'unidades',
]);

/** A palavra no singular ("limoes" -> "limao", "papeis" -> "papel", "bananas" -> "banana"). */
export function singular(word: string): string {
  // "sem-gas" já está pronto (ver parseName em similarNames).
  if (word.startsWith('sem-')) return word;
  if (word.length >= 4 && /[ao]es$/.test(word)) return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && word.endsWith('eis')) return `${word.slice(0, -3)}el`;
  if (word.length > 4 && word.endsWith('ais')) return `${word.slice(0, -3)}al`;
  if (word.length > 4 && word.endsWith('ois')) return `${word.slice(0, -3)}ol`;
  if (word.length > 3 && word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (word.length > 4 && /[rz]es$/.test(word)) return word.slice(0, -2);
  // Plural em "s" só depois de vogal: "sals" é abreviação, não plural de "sal".
  if (word.length > 3 && /[aeiou]s$/.test(word)) return word.slice(0, -1);
  return word;
}
