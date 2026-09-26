// Itens comuns de uma casa brasileira, para montar listas sem digitar.
// Nomes genéricos (sem marca): a marca aparece quando a nota fiscal liga o
// item a um produto.

import type { Unit } from '@/lib/types';

import { CATEGORIES, getCategory } from './categories';
import { normalizeSearch } from './search';

export interface CommonItem {
  name: string;
  category: string;
  unit: Unit;
}

type Entry = string | [name: string, unit: Unit];

const BY_CATEGORY: Record<string, Entry[]> = {
  hortifruti: [
    ['Banana', 'kg'], ['Maçã', 'kg'], ['Laranja', 'kg'], ['Limão', 'kg'], ['Mexerica', 'kg'], ['Uva', 'kg'],
    'Mamão', 'Melancia', 'Melão', 'Abacaxi', 'Manga', 'Abacate', 'Morango',
    ['Tomate', 'kg'], ['Cebola', 'kg'], 'Alho', ['Batata', 'kg'], ['Batata-doce', 'kg'], ['Cenoura', 'kg'],
    ['Mandioca', 'kg'], ['Abobrinha', 'kg'], ['Abóbora', 'kg'], ['Chuchu', 'kg'], ['Beterraba', 'kg'],
    ['Berinjela', 'kg'], ['Pepino', 'kg'], 'Pimentão', 'Alface', 'Rúcula', 'Couve', 'Brócolis', 'Couve-flor',
    'Repolho', 'Espinafre', 'Cheiro-verde', 'Gengibre',
  ],
  carnes: [
    ['Carne moída', 'kg'], ['Patinho', 'kg'], ['Alcatra', 'kg'], ['Contrafilé', 'kg'], ['Picanha', 'kg'],
    ['Acém', 'kg'], ['Costela bovina', 'kg'], ['Fígado', 'kg'], 'Frango inteiro', ['Peito de frango', 'kg'],
    ['Filé de frango', 'kg'], ['Coxa e sobrecoxa', 'kg'], ['Asa de frango', 'kg'], ['Linguiça toscana', 'kg'],
    ['Lombo suíno', 'kg'], ['Bisteca suína', 'kg'], 'Bacon', 'Hambúrguer',
  ],
  peixes: [['Filé de tilápia', 'kg'], ['Salmão', 'kg'], ['Merluza', 'kg'], ['Camarão', 'kg'], 'Sardinha em lata', 'Atum em lata'],
  laticinios: [
    ['Leite integral', 'l'], ['Leite desnatado', 'l'], ['Leite sem lactose', 'l'], 'Leite em pó', 'Iogurte natural',
    'Iogurte', 'Bebida láctea', ['Queijo muçarela', 'kg'], ['Queijo prato', 'kg'], 'Queijo minas', 'Queijo coalho',
    'Queijo parmesão ralado', 'Requeijão', 'Cream cheese', 'Manteiga', 'Margarina', 'Creme de leite', 'Leite condensado',
  ],
  ovos: ['Ovos (dúzia)', 'Ovos (30 un)'],
  padaria: ['Pão francês', 'Pão de forma', 'Pão integral', 'Bisnaguinha', 'Pão de hambúrguer', 'Torrada', 'Bolo', 'Rosca'],
  graos: [
    'Arroz', 'Arroz integral', 'Feijão carioca', 'Feijão preto', 'Macarrão espaguete', 'Macarrão parafuso',
    'Macarrão instantâneo', 'Farinha de trigo', 'Farinha de mandioca', 'Farofa pronta', 'Fubá', 'Amido de milho',
    'Aveia', 'Granola', 'Cereal matinal', 'Lentilha', 'Grão-de-bico', 'Milho de pipoca', 'Goma de tapioca',
  ],
  congelados: [
    'Pão de queijo congelado', 'Batata frita congelada', 'Pizza congelada', 'Lasanha congelada', 'Nuggets',
    'Hambúrguer congelado', 'Polpa de fruta', 'Legumes congelados', 'Sorvete',
  ],
  frios: [['Presunto', 'kg'], ['Peito de peru', 'kg'], ['Mortadela', 'kg'], ['Salsicha', 'kg'], 'Salame'],
  doces: [
    'Açúcar', 'Açúcar mascavo', 'Adoçante', 'Achocolatado em pó', 'Chocolate', 'Biscoito recheado',
    'Biscoito de maisena', 'Gelatina', 'Doce de leite', 'Geleia', 'Mel',
  ],
  snacks: ['Biscoito cream cracker', 'Salgadinho', 'Batata chips', 'Amendoim', 'Pipoca de micro-ondas', 'Barra de cereal'],
  temperos: [
    'Sal', 'Pimenta-do-reino', 'Orégano', 'Colorau', 'Caldo de galinha', 'Caldo de carne', 'Tempero pronto',
    'Molho de tomate', 'Extrato de tomate', 'Ketchup', 'Mostarda', 'Maionese', 'Vinagre', 'Shoyu', 'Azeitona',
  ],
  oleos: ['Óleo de soja', 'Azeite de oliva'],
  bebidas: [
    'Água mineral', 'Água com gás', 'Refrigerante', 'Suco de caixinha', 'Suco concentrado', 'Água de coco',
  ],
  alcoolicas: ['Cerveja', 'Vinho', 'Espumante'],
  cafe_cha: ['Café em pó', 'Café em cápsula', 'Café solúvel', 'Chá (sachê)'],
  limpeza: [
    'Detergente', 'Sabão em pó', 'Sabão líquido para roupas', 'Amaciante', 'Sabão em barra', 'Água sanitária',
    'Desinfetante', 'Limpador multiuso', 'Álcool 70%', 'Limpa-vidros', 'Lustra-móveis', 'Tira-manchas',
    'Esponja', 'Palha de aço', 'Pano de chão', 'Pano multiuso', 'Luvas de limpeza', 'Saco de lixo',
    'Pedra sanitária', 'Inseticida',
  ],
  higiene: [
    'Sabonete', 'Sabonete líquido', 'Shampoo', 'Condicionador', 'Creme dental', 'Escova de dente', 'Fio dental',
    'Enxaguante bucal', 'Desodorante', 'Absorvente', 'Aparelho de barbear', 'Hidratante', 'Protetor solar',
    'Algodão', 'Cotonete',
  ],
  papel: [
    'Papel higiênico', 'Papel toalha', 'Guardanapo', 'Filtro de café', 'Filme plástico', 'Papel-alumínio',
    'Saco para freezer', 'Copo descartável',
  ],
  bebe: ['Fralda', 'Lenço umedecido', 'Pomada para assadura', 'Papinha'],
  pet: ['Ração para cachorro', 'Ração para gato', 'Areia para gato', 'Petisco para pet', 'Tapete higiênico'],
  medicamentos: ['Dipirona', 'Paracetamol', 'Ibuprofeno', 'Antialérgico', 'Antiácido', 'Soro fisiológico'],
  suplementos: ['Multivitamínico', 'Vitamina C', 'Vitamina D', 'Ômega 3', 'Whey protein', 'Creatina'],
  primeiros_socorros: ['Curativo adesivo', 'Gaze', 'Esparadrapo', 'Antisséptico', 'Termômetro'],
  outros: [
    'Milho em conserva', 'Ervilha em conserva', 'Palmito', 'Pilhas', 'Lâmpada', 'Fósforo', 'Vela', 'Carvão',
  ],
};

export const COMMON_ITEMS: readonly CommonItem[] = CATEGORIES.flatMap((category) =>
  (BY_CATEGORY[category.key] ?? []).map((entry) =>
    typeof entry === 'string'
      ? { name: entry, category: category.key, unit: 'un' as const }
      : { name: entry[0], category: category.key, unit: entry[1] },
  ),
);

// Farmácia mostra primeiro o que se compra na farmácia.
const PHARMACY_FIRST = ['medicamentos', 'suplementos', 'primeiros_socorros', 'higiene', 'bebe'];

/** Itens agrupados por categoria, na ordem que faz sentido para o tipo de lista. */
export function commonItemsByCategory(listKind: string): { category: string; items: CommonItem[] }[] {
  const order = CATEGORIES.map((c) => c.key);
  if (listKind === 'farmacia') order.sort((a, b) => rank(a) - rank(b));
  return order
    .map((category) => ({ category, items: COMMON_ITEMS.filter((i) => i.category === category) }))
    .filter((group) => group.items.length > 0);
}

function rank(category: string): number {
  const index = PHARMACY_FIRST.indexOf(category);
  return index === -1 ? PHARMACY_FIRST.length : index;
}

/** Busca por trecho do nome ou da categoria, sem acento. Nome que começa com a busca vem antes. */
export function searchCommonItems(query: string, limit = 8): CommonItem[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const scored: [number, CommonItem][] = [];
  for (const item of COMMON_ITEMS) {
    const name = normalizeSearch(item.name);
    if (name.startsWith(q)) scored.push([0, item]);
    else if (name.includes(q)) scored.push([1, item]);
    else if (normalizeSearch(getCategory(item.category).label).includes(q)) scored.push([2, item]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'pt-BR'))
    .slice(0, limit)
    .map(([, item]) => item);
}
