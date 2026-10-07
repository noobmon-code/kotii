// Consultor financeiro (beta): categoria de gasto de um lançamento do banco.
// A Pluggy manda a categoria em inglês ("Groceries", "Food delivery"...);
// quando ela é genérica ou falta (PIX, "Shopping", "Other"), a descrição e a
// loja decidem. Também diz quais lançamentos são sensíveis (saúde, doações,
// religião, sindicato, partido): esses só aparecem como total da categoria.

import type { FinTransaction } from '@/lib/types';

import type { FinanceCategory } from './finance';
import { normalizeSearch } from './search';

/** O que a categoria usa do lançamento. */
export type BankCategoryInput = Pick<FinTransaction, 'category' | 'category_id' | 'description'> &
  Partial<Pick<FinTransaction, 'description_raw' | 'merchant_name' | 'counterparty_name' | 'counterparty_doc_kind'>>;

/** Minúsculas, sem acento e sem pontuação ("MERCADOPAGO*LOJA" -> "mercadopago loja"). */
export function normalizeBankText(...parts: (string | null | undefined)[]): string {
  return normalizeSearch(parts.filter(Boolean).join(' '))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * O texto tem o termo como palavra inteira; termo terminado em "*" vale como
 * começo de palavra ("odonto*" acha "odontologia"). Palavra inteira evita
 * "bar" dentro de "barra" e "tim" dentro de "time".
 */
export function hasTerm(text: string, term: string): boolean {
  const padded = ` ${text} `;
  return term.endsWith('*') ? padded.includes(` ${term.slice(0, -1)}`) : padded.includes(` ${term} `);
}

export function hasAnyTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => hasTerm(text, term));
}

// Nomes da Pluggy (já normalizados) -> categoria. Os genéricos (transferências,
// "Shopping", "Services", "Other") ficam de fora de propósito: aí a descrição decide.
const PLUGGY: Record<string, FinanceCategory> = {
  groceries: 'mercado',
  // Comer fora e delivery entram em Lazer, como no orçamento da casa.
  'food and drinks': 'lazer',
  'eating out': 'lazer',
  restaurants: 'lazer',
  'food delivery': 'lazer',
  leisure: 'lazer',
  tickets: 'lazer',
  'stadiums and arenas': 'lazer',
  'landmarks and museums': 'lazer',
  'cinema theater and concerts': 'lazer',
  travel: 'lazer',
  'airport and airlines': 'lazer',
  accommodation: 'lazer',
  'mileage programs': 'lazer',
  'bus tickets': 'lazer',
  gambling: 'lazer',
  lottery: 'lazer',
  'online bet': 'lazer',
  'digital services': 'assinaturas',
  gaming: 'assinaturas',
  streaming: 'assinaturas',
  'video streaming': 'assinaturas',
  'music streaming': 'assinaturas',
  telecommunications: 'contas',
  internet: 'contas',
  mobile: 'contas',
  tv: 'contas',
  utilities: 'contas',
  water: 'contas',
  electricity: 'contas',
  gas: 'contas',
  housing: 'moradia',
  rent: 'moradia',
  houseware: 'moradia',
  'urban land and building tax': 'moradia',
  'home insurance': 'moradia',
  'real estate financing': 'moradia',
  healthcare: 'saude',
  dentist: 'saude',
  pharmacy: 'saude',
  optometry: 'saude',
  'hospital clinics and labs': 'saude',
  'health insurance': 'saude',
  'wellness and fitness': 'saude',
  'gyms and fitness centers': 'saude',
  'sports practice': 'saude',
  wellness: 'saude',
  education: 'educacao',
  'online courses': 'educacao',
  university: 'educacao',
  school: 'educacao',
  kindergarten: 'educacao',
  bookstore: 'educacao',
  'student loan': 'educacao',
  transportation: 'transporte',
  'taxi and ride hailing': 'transporte',
  'public transportation': 'transporte',
  'car rental': 'transporte',
  bicycle: 'transporte',
  automotive: 'transporte',
  'gas stations': 'transporte',
  parking: 'transporte',
  'tolls and in vehicle payment': 'transporte',
  'vehicle ownership taxes and fees': 'transporte',
  'vehicle maintenance': 'transporte',
  'traffic tickets': 'transporte',
  'vehicle insurance': 'transporte',
  'vehicle financing': 'transporte',
  'pet supplies and vet': 'pet',
};

// Só o nome some às vezes; o id da Pluggy começa pelo grupo (10000000 = Groceries).
const PLUGGY_GROUPS: Record<string, FinanceCategory> = {
  '09': 'assinaturas',
  '10': 'mercado',
  '11': 'lazer',
  '12': 'lazer',
  '14': 'lazer',
  '17': 'moradia',
  '18': 'saude',
  '19': 'transporte',
  '21': 'lazer',
};

// Palavra -> categoria. A primeira que aparece vence, então o mais
// específico vem antes ("uber eats" antes de "uber").
const KEYWORDS: [FinanceCategory, string[]][] = [
  ['pet', ['petshop', 'pet shop', 'petz', 'cobasi', 'petlove', 'veterinari*', 'racao', 'pet']],
  ['lazer', ['uber eats', 'ifood', 'ifd', 'rappi', 'ze delivery', 'aiqfome']],
  [
    'saude',
    [
      'farmacia*', 'drogaria*', 'droga raia', 'drogasil', 'pague menos', 'panvel', 'drogao', 'ultrafarma',
      'hospital', 'clinica*', 'laboratorio*', 'consultorio', 'medico', 'medica', 'dentista', 'odonto*',
      'unimed', 'amil', 'hapvida', 'notredame', 'plano de saude', 'sulamerica saude', 'bradesco saude',
      'psicolog*', 'psiquiatr*', 'terapia', 'fisioterap*', 'fleury', 'otica', 'oticas', 'academia',
      'smart fit', 'smartfit', 'bluefit', 'gympass', 'wellhub', 'totalpass', 'crossfit', 'pilates',
    ],
  ],
  [
    'educacao',
    [
      'escola', 'colegio', 'faculdade', 'universidade', 'curso', 'cursos', 'creche', 'livraria', 'papelaria',
      'material escolar', 'udemy', 'alura', 'coursera', 'duolingo', 'kumon',
    ],
  ],
  [
    'assinaturas',
    [
      'netflix', 'spotify', 'disney', 'hbo', 'hbomax', 'prime video', 'primevideo', 'amazon prime', 'globoplay',
      'deezer', 'youtube', 'apple com bill', 'icloud', 'google one', 'paramount', 'crunchyroll', 'telecine',
      'assinatura',
    ],
  ],
  [
    'transporte',
    [
      'uber', '99app', '99 app', '99pop', '99 pop', '99 taxi', '99taxi', '99 tecnologia', 'cabify', 'indrive',
      'taxi', 'posto', 'postos', 'auto posto', 'combustive*', 'gasolina', 'etanol', 'shell', 'ipiranga',
      'petrobras', 'raizen', 'estacionamento', 'estapar', 'zona azul', 'sem parar', 'conectcar', 'veloe',
      'pedagio', 'metro', 'bilhete unico', 'cptm', 'sptrans', 'onibus', 'riocard', 'detran', 'ipva',
      'oficina', 'auto pecas', 'autopecas', 'pneus', 'localiza', 'movida', 'unidas', 'lava jato', 'lavajato',
      'borracharia', 'mecanica',
    ],
  ],
  [
    'contas',
    [
      'enel', 'cemig', 'copel', 'celesc', 'cpfl', 'coelba', 'celpe', 'cosern', 'energisa', 'equatorial',
      'neoenergia', 'eletropaulo', 'light servicos', 'light sa', 'edp', 'sabesp', 'cedae', 'aguas do rio',
      'copasa', 'sanepar', 'embasa', 'caesb', 'compesa', 'cagece', 'comgas', 'naturgy', 'ultragaz', 'liquigas',
      'supergasbras', 'energia eletrica', 'conta de luz', 'conta de agua', 'agua e esgoto', 'saneamento',
      'vivo', 'telefonica', 'claro', 'tim', 'oi fibra', 'oi movel', 'net servicos', 'sky', 'internet',
      'telefone', 'telecom', 'fibra',
    ],
  ],
  [
    'moradia',
    [
      'aluguel', 'condominio', 'iptu', 'quintoandar', 'quinto andar', 'imobiliaria', 'leroy merlin',
      'telhanorte', 'tok stok', 'camicado', 'material de construcao',
    ],
  ],
  [
    'mercado',
    [
      'supermerc*', 'mercado', 'mercadinho', 'minimercado', 'mercearia', 'hipermercado', 'atacadao', 'assai',
      'carrefour', 'pao de acucar', 'hortifrut*', 'sacolao', 'acougue', 'padaria', 'panificadora', 'emporio',
      'quitanda', 'atacarejo', 'sams club', 'makro', 'st marche', 'zaffari', 'guanabara', 'prezunic',
      'savegnago', 'muffato', 'bistek', 'sonda',
    ],
  ],
  [
    'lazer',
    [
      'restaurante*', 'restaurant', 'lanchonete', 'lanches', 'pizzaria', 'pizza', 'hamburgueria', 'burger',
      'burguer', 'churrascaria', 'sushi', 'bar', 'boteco', 'choperia', 'cervejaria', 'cafeteria', 'sorveteria',
      'doceria', 'confeitaria', 'mcdonalds', 'mc donalds', 'burger king', 'subway', 'starbucks', 'outback',
      'habibs', 'giraffas', 'spoleto', 'madero', 'cinema', 'cinemark', 'cinepolis', 'kinoplex', 'ingresso*',
      'sympla', 'eventim', 'ticketmaster', 'teatro', 'show', 'hotel', 'hoteis', 'pousada', 'airbnb', 'booking',
      'decolar', 'latam', 'azul linhas', 'gol linhas', 'smiles', 'viagem', 'turismo', 'steam', 'playstation',
      'xbox', 'nintendo',
    ],
  ],
];

// Carteiras e marketplaces com "mercado" no nome não são supermercado.
const NOT_GROCERY = /\b(mercado ?pago|mercado ?livre|mercado ?bitcoin)\b/g;

/** Texto em que as palavras-chave são procuradas: nome de pessoa (CPF) fica de fora. */
function keywordText(tx: BankCategoryInput): string {
  const party = tx.counterparty_doc_kind === 'CPF' ? null : tx.counterparty_name;
  return normalizeBankText(tx.description, tx.description_raw, tx.merchant_name, party, tx.category)
    .replace(NOT_GROCERY, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Categoria só pelo que a Pluggy disse (nome ou id); null quando ela é genérica. */
export function pluggyFinanceCategory(category: string | null | undefined, categoryId?: string | null): FinanceCategory | null {
  const byName = category ? PLUGGY[normalizeBankText(category)] : undefined;
  if (byName) return byName;
  if (categoryId && /^\d{8,9}$/.test(categoryId)) return PLUGGY_GROUPS[categoryId.slice(0, 2)] ?? null;
  return null;
}

function keywordCategory(text: string): FinanceCategory | null {
  for (const [category, terms] of KEYWORDS) if (hasAnyTerm(text, terms)) return category;
  return null;
}

/** Categoria de gasto do Nooky para um lançamento do banco; sem pista, 'outros'. */
export function financeCategoryOfBank(tx: BankCategoryInput): FinanceCategory {
  return pluggyFinanceCategory(tx.category, tx.category_id) ?? keywordCategory(keywordText(tx)) ?? 'outros';
}

// Categorias da Pluggy que nunca vão com detalhe para a IA.
const SENSITIVE_PLUGGY = new Set(['donations', 'alimony']);

const SENSITIVE_TERMS = [
  'doacao', 'doacoes', 'dizimo*', 'oferta', 'ofertas', 'vaquinha', 'ong', 'igreja', 'paroquia', 'templo',
  'congregacao', 'ministerio', 'assembleia de deus', 'universal do reino', 'evangelica', 'batista',
  'presbiteriana', 'catolica', 'mitra', 'diocese', 'arquidiocese', 'espirita', 'terreiro', 'umbanda',
  'candomble', 'sinagoga', 'mesquita', 'sindicato', 'sindical', 'partido', 'diretorio', 'campanha eleitoral',
  'pensao alimenticia',
];

/**
 * Saúde, doações, religião, sindicato, partido e pensão: no retrato da IA só
 * entram somados na categoria, sem loja nem descrição. Na dúvida, marca.
 */
export function isSensitiveBankTx(tx: BankCategoryInput): boolean {
  if (financeCategoryOfBank(tx) === 'saude') return true;
  if (tx.category && SENSITIVE_PLUGGY.has(normalizeBankText(tx.category))) return true;
  // 13000000 = Donations na Pluggy.
  if (tx.category_id && /^13\d{6}$/.test(tx.category_id)) return true;
  return hasAnyTerm(keywordText(tx), SENSITIVE_TERMS);
}
