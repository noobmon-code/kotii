// "Mesmo item": a lista diz "Leite" e a nota traz "LEITE UHT PARMALAT CX". A
// marca, a embalagem e o tamanho não mudam o item; o tipo e o sabor mudam
// (integral não é desnatado, Coca não é Guaraná, batata doce não é batata).
// Cada nome vira um item (`itemIdentity`) com o vocabulário dos desenhos
// (domain/itemArt), separando aqui o que lá divide um desenho só ("margarina"
// e "manteiga", "peito de peru" e "presunto"), mais alguns itens sem desenho
// (salsa, cebolinha, papel toalha…). Serve à revisão da nota (que item da
// lista a compra cumpriu, em domain/listLinks) e à despensa (a mesma compra
// pelo carrinho e pela nota, em domain/cartPantry).

import { categoryGroup, isHouseArt, ITEM_ART_EXCEPTIONS, ITEM_ART_RULES } from './itemArt';
import { compileTerms, firstMention, firstProductTerm, termRegex, termText } from './itemTerms';
import { LOOSE_UNITS, OTHER_THING, PACKAGING, singular } from './nameWords';
import { packageSize, samePackageSize } from './packageSize';

// ---------------------------------------------------------------------------
// Abreviações e outros nomes

// Trechos de nota fiscal e nomes regionais, por extenso. Casam palavras inteiras do texto de termText, na ordem
// (o mais longo antes). Não é para cobrir toda abreviação: só as comuns e sem outra leitura ("SAB" pode ser sabão
// ou sabonete, "COND" pode ser condensado ou condicionador: ficam de fora sozinhas).
const SPELLED_OUT: readonly (readonly [string, string])[] = [
  // Nomes regionais do mesmo item.
  ['pao de caixa', 'pao de forma'],
  ['pao caixa', 'pao de forma'],
  ['pao de sal', 'pao frances'],
  ['pao carioquinha', 'pao frances'],
  ['cacetinho', 'pao frances'],
  ['jerimum', 'abobora'],
  ['salsinha', 'salsa'],
  ['lava loucas', 'detergente'],
  ['lava louca', 'detergente'],
  // Abreviações de NFC-e.
  ['refrig', 'refrigerante'],
  ['refri', 'refrigerante'],
  ['lte cond', 'leite condensado'],
  ['leite cond', 'leite condensado'],
  ['lt longa vida', 'leite longa vida'],
  ['lte', 'leite'],
  ['cr leite', 'creme de leite'],
  ['cr dental', 'creme dental'],
  ['cr dent', 'creme dental'],
  ['sab po', 'sabao em po'],
  ['sab barra', 'sabao em barra'],
  ['lava roup', 'lava roupas'],
  ['lava roupa', 'lava roupas'],
  ['papel hig', 'papel higienico'],
  ['pap hig', 'papel higienico'],
  ['papel toal', 'papel toalha'],
  ['pap toalha', 'papel toalha'],
  ['ag sanit', 'agua sanitaria'],
  ['agua sanit', 'agua sanitaria'],
  ['esc dental', 'escova dental'],
  ['esc dent', 'escova dental'],
  ['liq', 'liquido'],
  ['det', 'detergente'],
  ['deterg', 'detergente'],
  ['amac', 'amaciante'],
  ['desinf', 'desinfetante'],
  ['iog', 'iogurte'],
  ['marg', 'margarina'],
  ['margar', 'margarina'],
  ['mant', 'manteiga'],
  ['req', 'requeijao'],
  ['qj', 'queijo'],
  ['qjo', 'queijo'],
  ['muss', 'mussarela'],
  ['bisc', 'biscoito'],
  ['rech', 'recheado'],
  ['achoc', 'achocolatado'],
  ['choc', 'chocolate'],
  ['frg', 'frango'],
  ['fgo', 'frango'],
  ['sobrec', 'sobrecoxa'],
  ['bov', 'bovina'],
  ['resf', 'resfriado'],
  ['cong', 'congelado'],
  ['pres', 'presunto'],
  ['mort', 'mortadela'],
  ['ling', 'linguica'],
  ['feij', 'feijao'],
  ['mac', 'macarrao'],
  ['espag', 'espaguete'],
  ['inst', 'instantaneo'],
  ['far', 'farinha'],
  ['acuc', 'acucar'],
  ['caf', 'cafe'],
  ['torr', 'torrado'],
  ['moid', 'moido'],
  ['desn', 'desnatado'],
  ['semidesn', 'semidesnatado'],
  ['int', 'integral'],
  ['cerv', 'cerveja'],
  ['desod', 'desodorante'],
  ['shamp', 'shampoo'],
  ['esponj', 'esponja'],
  ['espo', 'esponja'],
  ['sabon', 'sabonete'],
  ['s acucar', 'sem acucar'],
];
const SPELLED_OUT_REGEXES = SPELLED_OUT.map(([from, to]) => [new RegExp(`(^| )${from}(?= |$)`, 'g'), `$1${to}`] as const);

/** O nome sem acento, só com letras e números, e com as abreviações e os nomes regionais por extenso. */
export function spelledOut(name: string): string {
  let text = termText(name);
  for (const [re, to] of SPELLED_OUT_REGEXES) text = text.replace(re, to);
  return text;
}

// ---------------------------------------------------------------------------
// O vocabulário

type Group = 'casa' | 'comida' | 'pet';

// O termo dos desenhos que aqui é outro item; os outros termos ficam com a chave do desenho.
const ART_TERM_KEYS: Readonly<Record<string, string>> = {
  'extrato de tomate': 'extrato_tomate',
  'polpa de tomate': 'polpa_tomate',
  sassami: 'sassami',
  'pao integral': 'pao_forma',
  bisnaguinha: 'bisnaguinha',
  'pao de hamburguer': 'pao_hamburguer',
  baguete: 'baguete',
  pao: 'pao',
  paes: 'pao',
  'sabao em po': 'sabao',
  'sabao liquido': 'sabao',
  'lava roupas': 'sabao',
  sabao: 'sabao',
  lima: 'lima',
  rucula: 'rucula',
  'couve flor': 'couve_flor',
  couve: 'couve',
  salsicha: 'salsicha',
  coxa: 'coxa',
  sobrecoxa: 'sobrecoxa',
  galeto: 'galeto',
  bife: 'carne',
  'bombom de alcatra': 'alcatra',
  'bombom de picanha': 'picanha',
  'bombom de contrafile': 'contrafile',
  'file mignon': 'file_mignon',
  tilapia: 'tilapia',
  salmao: 'salmao',
  merluza: 'merluza',
  pescada: 'pescada',
  bacalhau: 'bacalhau',
  camaroes: 'camarao',
  sardinha: 'sardinha',
  'cream cheese': 'cream_cheese',
  'bebida lactea': 'bebida_lactea',
  margarina: 'margarina',
  mucarela: 'mussarela',
  mussarela: 'mussarela',
  parmesao: 'parmesao',
  rosca: 'rosca',
  'peito de peru': 'peito_peru',
  mortadela: 'mortadela',
  salame: 'salame',
  espaguete: 'espaguete',
  penne: 'penne',
  talharim: 'talharim',
  fuba: 'fuba',
  'amido de milho': 'amido_milho',
  adocante: 'adocante',
  bombom: 'bombom',
  achocolatado: 'achocolatado',
  cookie: 'biscoito',
  'cream cracker': 'biscoito',
  'palha de aco': 'palha_aco',
  condicionador: 'condicionador',
  aveia: 'aveia',
  granola: 'granola',
  mostarda: 'mostarda',
  alvejante: 'alvejante',
  cloro: 'cloro',
  picole: 'picole',
  limoes: 'limao',
};
// Os cortes de carne viram cada um o seu item, da família "carne".
const MEAT_CUTS = [
  'patinho', 'alcatra', 'contrafile', 'picanha', 'acem', 'costela', 'maminha', 'fraldinha', 'musculo', 'coxao', 'lagarto',
  'cupim', 'bisteca', 'lombo', 'pernil', 'figado',
];

type Def = readonly [key: string, terms: readonly string[], group?: Group];

// Antes dos desenhos: no mesmo lugar, vencem ("batata palha" não é batata; "carne seca" não é a carne fresca).
const FIRST: readonly Def[] = [
  ...ITEM_ART_EXCEPTIONS.map((term): Def => [term.replace(/ (?:de |da |do )?/g, '_'), [term]]),
  ['filtro_cafe', ['filtro de papel']],
  ['ovo_codorna', ['ovo de codorna']],
  ['ovo_pascoa', ['ovo de pascoa']],
  ['barra_cereal', ['barra de cereal']],
  ['carne_seca', ['carne seca', 'carne de sol', 'charque']],
  ['mandioquinha', ['batata baroa', 'batata salsa', 'mandioquinha']],
  ['papel_toalha', ['papel toalha', 'toalha de papel'], 'casa'],
  ['papel_aluminio', ['papel aluminio'], 'casa'],
  ['filme_plastico', ['papel filme', 'filme plastico'], 'casa'],
];
// Depois dos desenhos: itens sem desenho próprio.
const LAST: readonly Def[] = [
  ['salsa', ['salsa']],
  ['cebolinha', ['cebolinha']],
  ['coentro', ['coentro']],
  ['cheiro_verde', ['cheiro verde']],
  ['manjericao', ['manjericao']],
  ['hortela', ['hortela']],
  ['polpa_fruta', ['polpa de fruta', 'polpa']],
  ['margarina', ['creme vegetal']],
  ['ricota', ['ricota']],
  ['cheddar', ['cheddar']],
  ['provolone', ['provolone']],
  ['gorgonzola', ['gorgonzola']],
  ['cottage', ['cottage']],
  ['azeite', ['azeite']],
  ['vinagre', ['vinagre']],
  ['fermento', ['fermento']],
  ['gelatina', ['gelatina']],
  ['tapioca', ['tapioca']],
  ['cuscuz', ['cuscuz', 'flocao', 'flocos de milho']],
  ['abobora', ['abobora']],
  ['chuchu', ['chuchu']],
  ['quiabo', ['quiabo']],
  ['berinjela', ['berinjela']],
  ['inhame', ['inhame']],
  ['goiaba', ['goiaba']],
  ['maracuja', ['maracuja']],
  ['kiwi', ['kiwi']],
  ['pera', ['pera']],
  ['coco', ['coco']],
  ['vinho', ['vinho']],
  ['pipoca', ['pipoca']],
  ['salgadinho', ['salgadinho']],
  ['torrada', ['torrada']],
  ['guardanapo', ['guardanapo'], 'casa'],
  ['luva', ['luva'], 'casa'],
  ['barbear', ['aparelho de barbear', 'barbeador', 'lamina de barbear'], 'casa'],
  ['limpador', ['limpador', 'multiuso'], 'casa'],
  ['desinfetante', ['desinfetante'], 'casa'],
  ['absorvente', ['absorvente', 'protetor diario'], 'casa'],
  ['fralda', ['fralda'], 'casa'],
  ['lenco_umedecido', ['lenco umedecido'], 'casa'],
  ['racao', ['racao'], 'pet'],
];

const DEFS: readonly Def[] = [
  ...FIRST,
  ...ITEM_ART_RULES.flatMap(([artKey, terms]) =>
    terms.map((term): Def => [ART_TERM_KEYS[term] ?? (MEAT_CUTS.includes(term) ? term : artKey), [term], isHouseArt(artKey) ? 'casa' : 'comida']),
  ),
  ...LAST,
];
const COMPILED = compileTerms(DEFS.map(([key, terms]) => [key, terms] as const));
const GROUPS = new Map<string, Group>(DEFS.map(([key, , group]) => [key, group ?? 'comida']));

// Famílias: o nome genérico da lista ("Carne", "Frango", "Queijo") e um corte
// ou uma variedade dela na nota ("Bombom da Alcatra", "Filé de peito",
// "Mussarela") podem ser a mesma compra, mas não com certeza: só sugestão.
// `context`: palavras que só dizem a parte junto do nome da família ("queijo
// prato", "asa de frango"), não sozinhas.
const FAMILIES: Readonly<Record<string, { members: readonly string[]; context?: Readonly<Record<string, readonly string[]>> }>> = {
  carne: { members: [...MEAT_CUTS, 'file_mignon', 'carne_seca'], context: { paleta: ['paleta'] } },
  frango: {
    members: ['peito_frango', 'sassami', 'coxa', 'sobrecoxa', 'galeto'],
    context: { peito_frango: ['peito', 'file de peito'], asa: ['asa', 'asinha'], coracao: ['coracao'], moela: ['moela'] },
  },
  peixe: { members: ['tilapia', 'salmao', 'merluza', 'pescada', 'bacalhau'], context: { cacao: ['cacao'], pintado: ['pintado'] } },
  queijo: {
    members: ['mussarela', 'parmesao', 'ricota', 'cheddar', 'provolone', 'gorgonzola', 'cottage'],
    context: { prato: ['prato'], coalho: ['coalho'], minas: ['minas'], reino: ['reino'], brie: ['brie'] },
  },
  pao: { members: ['pao_frances', 'pao_forma', 'pao_hamburguer', 'baguete', 'bisnaguinha'] },
  macarrao: { members: ['espaguete', 'penne', 'talharim'], context: { parafuso: ['parafuso'], fusilli: ['fusilli'], lasanha: ['lasanha'] } },
  chocolate: { members: ['bombom'] },
};
const FAMILY_OF = new Map<string, string>();
for (const [head, { members, context }] of Object.entries(FAMILIES)) {
  FAMILY_OF.set(head, head);
  for (const member of [...members, ...Object.keys(context ?? {})]) FAMILY_OF.set(member, head);
}
// Onde cada parte da família aparece no nome, sabor ou não ("Bife de lagarto", "Carne moída de patinho").
const MEMBER_TERMS = new Map<string, { key: string; re: RegExp }[]>(
  Object.entries(FAMILIES).map(([head, { members, context }]) => [
    head,
    [
      ...DEFS.filter(([key]) => members.includes(key)).flatMap(([key, terms]) => terms.map((term) => ({ key, re: termRegex(term) }))),
      ...Object.entries(context ?? {}).flatMap(([key, terms]) => terms.map((term) => ({ key, re: termRegex(term) }))),
    ],
  ]),
);

// ---------------------------------------------------------------------------
// Tipo, sabor e versão

interface KindDimension {
  /** Os itens (ou famílias) em que o tipo vale; "*": todos. */
  keys: readonly string[] | '*';
  values: Readonly<Record<string, readonly string[]>>;
  /** Valores que fazem outra versão do item: dito só na nota, o item da lista genérico fica em dúvida ("Coca" e "COCA ZERO"). */
  strict?: readonly string[];
  /** O que a nota quer dizer quando não diz o tipo: café é em pó, água é sem gás. */
  lineDefault?: string;
  /** Variedades da mesma fruta ou verdura ("Banana prata" e "BANANA NANICA"): se não batem, pode ser, mas não com certeza. */
  soft?: boolean;
}

const FLAVORS: Readonly<Record<string, readonly string[]>> = {
  natural: ['natural'],
  morango: ['morango'],
  uva: ['uva'],
  laranja: ['laranja'],
  limao: ['limao'],
  maracuja: ['maracuja'],
  abacaxi: ['abacaxi'],
  manga: ['manga'],
  pessego: ['pessego'],
  goiaba: ['goiaba'],
  caju: ['caju'],
  acerola: ['acerola'],
  banana: ['banana'],
  maca: ['maca'],
  coco: ['coco'],
  chocolate: ['chocolate'],
  baunilha: ['baunilha'],
  ameixa: ['ameixa'],
  frutas_vermelhas: ['frutas vermelhas'],
  creme: ['creme'],
  flocos: ['flocos'],
  napolitano: ['napolitano'],
};

// A ordem conta: o que uma dimensão leu sai do texto para as seguintes ("zero lactose" não é "zero" açúcar).
const KINDS: readonly KindDimension[] = [
  {
    keys: ['leite', 'iogurte', 'bebida_lactea', 'queijo', 'requeijao', 'manteiga', 'creme_leite', 'leite_condensado', 'leite+po', 'doce_leite', 'cream_cheese'],
    values: { sem_lactose: ['sem lactose', 'zero lactose', 'lactose free'] },
    strict: ['sem_lactose'],
  },
  { keys: ['cerveja'], values: { sem_alcool: ['sem alcool', 'zero alcool'] }, strict: ['sem_alcool'] },
  {
    keys: ['leite', 'iogurte', 'leite+po'],
    values: { integral: ['integral'], desnatado: ['desnatado'], semidesnatado: ['semidesnatado', 'semi desnatado'] },
  },
  {
    keys: '*',
    values: { zero: ['zero', 'sem acucar', 'zero acucar', 'diet'], light: ['light', 'lite'], normal: ['original'] },
    strict: ['zero', 'light'],
  },
  {
    keys: ['refrigerante'],
    values: {
      coca: ['coca', 'coca cola'],
      guarana: ['guarana', 'kuat'],
      pepsi: ['pepsi'],
      laranja: ['laranja', 'sukita'],
      uva: ['uva'],
      limao: ['limao', 'sprite', 'soda limonada'],
      tonica: ['tonica'],
    },
  },
  { keys: ['suco', 'iogurte', 'bebida_lactea', 'biscoito', 'sorvete', 'picole', 'bolo', 'gelatina'], values: FLAVORS },
  { keys: ['iogurte', 'bebida_lactea'], values: { grego: ['grego'] }, strict: ['grego'] },
  {
    keys: ['feijao'],
    values: {
      carioca: ['carioca', 'carioquinha'],
      preto: ['preto'],
      branco: ['branco'],
      fradinho: ['fradinho'],
      verde: ['verde'],
      macassar: ['macassar', 'macacar', 'corda'],
      jalo: ['jalo'],
      rajado: ['rajado'],
      vermelho: ['vermelho'],
      bolinha: ['bolinha'],
    },
  },
  {
    keys: ['arroz'],
    values: {
      integral: ['integral'],
      parboilizado: ['parboilizado', 'parbolizado'],
      arboreo: ['arboreo', 'risoto'],
      japones: ['japones', 'gohan', 'sushi'],
      negro: ['negro', 'preto', 'selvagem'],
      sete_graos: ['7 graos', 'sete graos'],
    },
    strict: ['integral', 'parboilizado', 'arboreo', 'japones', 'negro', 'sete_graos'],
  },
  { keys: ['pao', 'macarrao', 'biscoito', 'farinha', 'torrada'], values: { integral: ['integral'] }, strict: ['integral'] },
  {
    keys: ['farinha'],
    values: { trigo: ['trigo'], mandioca: ['mandioca'], milho: ['milho'], rosca: ['rosca'], aveia: ['aveia'], arroz: ['arroz'], panko: ['panko'] },
  },
  {
    keys: ['acucar'],
    values: { refinado: ['refinado'], cristal: ['cristal'], mascavo: ['mascavo'], demerara: ['demerara'], confeiteiro: ['confeiteiro'] },
    strict: ['mascavo', 'demerara', 'confeiteiro'],
  },
  { keys: ['sal'], values: { grosso: ['grosso'], refinado: ['refinado'], rosa: ['rosa', 'himalaia'], marinho: ['marinho'] }, strict: ['grosso', 'rosa'] },
  {
    keys: ['cafe'],
    values: {
      po: ['po', 'moido'],
      capsula: ['capsula', 'caps', 'dolce gusto', 'nespresso'],
      soluvel: ['soluvel', 'instantaneo'],
      grao: ['grao', 'graos'],
    },
    lineDefault: 'po',
  },
  { keys: ['cafe'], values: { descafeinado: ['descafeinado'] }, strict: ['descafeinado'] },
  {
    keys: ['sabao'],
    values: { po: ['po'], liquido: ['liquido'], barra: ['barra'], pasta: ['pasta'] },
    strict: ['po', 'liquido', 'barra', 'pasta'],
  },
  { keys: ['sabonete'], values: { intimo: ['intimo'], liquido: ['liquido'], barra: ['barra'], infantil: ['infantil'] }, strict: ['intimo'] },
  {
    keys: ['oleo'],
    values: { soja: ['soja'], girassol: ['girassol'], milho: ['milho'], canola: ['canola'], algodao: ['algodao'], vegetal: ['vegetal'], coco: ['coco'] },
    strict: ['coco'],
  },
  { keys: ['agua'], values: { com_gas: ['com gas', 'c gas', 'gaseificada'], sem_gas: ['sem gas', 's gas'] }, strict: ['com_gas'], lineDefault: 'sem_gas' },
  { keys: ['ovos'], values: { caipira: ['caipira'], branco: ['branco'], vermelho: ['vermelho'] } },
  {
    keys: ['carne'],
    values: { moida: ['moida', 'moido'], bife: ['bife'], cubos: ['cubos', 'picadinho'], iscas: ['iscas', 'tiras'], peca: ['peca'] },
  },
  { keys: ['carne'], values: { bovina: ['bovina', 'bovino', 'boi'], suina: ['suina', 'suino', 'porco'] } },
  { keys: ['queijo', 'presunto', 'peito_peru', 'mortadela', 'salame'], values: { ralado: ['ralado'], fatiado: ['fatiado', 'fatias', 'fat'], peca: ['peca'] } },
  { keys: ['tomate'], values: { cereja: ['cereja', 'grape'], italiano: ['italiano'] }, strict: ['cereja'] },
  { keys: ['banana'], values: { prata: ['prata'], nanica: ['nanica', 'dagua'], maca: ['maca'], terra: ['terra'], ouro: ['ouro'] }, soft: true },
  { keys: ['laranja'], values: { pera: ['pera'], lima: ['lima'], bahia: ['bahia'], seleta: ['seleta'] }, soft: true },
  { keys: ['limao'], values: { tahiti: ['tahiti', 'taiti'], siciliano: ['siciliano'], galego: ['galego'], cravo: ['cravo'] }, soft: true },
  { keys: ['maca'], values: { fuji: ['fuji'], gala: ['gala'], verde: ['verde'] }, soft: true },
  { keys: ['uva'], values: { verde: ['verde', 'italia', 'thompson'], roxa: ['roxa', 'preta', 'niagara', 'rubi', 'crimson', 'vitoria'] }, soft: true },
  { keys: ['mexerica'], values: { murcote: ['murcote', 'murkot', 'murcott'], ponkan: ['ponkan'] }, soft: true },
  { keys: ['alface'], values: { americana: ['americana'], crespa: ['crespa'], lisa: ['lisa'], roxa: ['roxa'], romana: ['romana'] }, soft: true },
  { keys: ['cebola'], values: { roxa: ['roxa'], branca: ['branca'] }, soft: true },
  { keys: ['pimentao'], values: { verde: ['verde'], vermelho: ['vermelho'], amarelo: ['amarelo'] }, soft: true },
  { keys: ['milho'], values: { verde: ['verde'], pipoca: ['pipoca'], canjica: ['canjica'] } },
];
const COMPILED_KINDS = KINDS.map((dimension) => ({
  ...dimension,
  values: Object.entries(dimension.values).map(([value, terms]) => ({ value, res: terms.map(termRegex) })),
}));

// ---------------------------------------------------------------------------
// O item de cada nome

export interface ItemIdentity {
  /** O item, o mesmo para marcas e embalagens diferentes: "leite", "pao_forma", "alcatra", "batata+doce". */
  key: string;
  /** A família, quando o item é ela ("carne") ou uma parte dela ("alcatra"). */
  family: string | null;
  /** O que o nome diz de cada tipo (pelo lugar do tipo em KINDS): integral, zero, Coca, em pó… */
  kinds: ReadonlyMap<number, ReadonlySet<string>>;
  /** O tamanho da embalagem, quando o nome diz sem dúvida. */
  size: ReturnType<typeof packageSize>;
}

// Ligações que a nota pode trazer entre o item e a palavra que faz outra coisa ("Leite em pó", "Batata doce").
const LINK_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'em']);

const dimensionFits = (dimension: Pick<KindDimension, 'keys'>, key: string, family: string | null) =>
  dimension.keys === '*' || dimension.keys.includes(key) || (family != null && dimension.keys.includes(family));

/** Os tipos que o texto diz para este item; o que uma dimensão leu sai do texto das seguintes. */
function readKinds(text: string, key: string, family: string | null): Map<number, Set<string>> {
  const kinds = new Map<number, Set<string>>();
  let rest = ` ${text} `;
  COMPILED_KINDS.forEach((dimension, at) => {
    if (!dimensionFits(dimension, key, family)) return;
    const found = new Set<string>();
    for (const { value, res } of dimension.values) {
      for (const re of res) {
        if (!re.test(rest)) continue;
        found.add(value);
        rest = rest.replace(re, ' ');
      }
      for (const re of res) re.lastIndex = 0;
    }
    if (found.size) kinds.set(at, found);
  });
  return kinds;
}

/** Um valor de tipo que este item conhece ("pó" do café, "soja" do óleo): aí a palavra não faz outra coisa. */
function isKindWord(word: string, key: string, family: string | null): boolean {
  return KINDS.some((dimension) => dimensionFits(dimension, key, family) && Object.values(dimension.values).some((terms) => terms.includes(word)));
}

function fitsGroup(key: string, category: string | null | undefined): boolean {
  if (!category || category === 'outros') return true;
  const group = GROUPS.get(key.split('+')[0]) ?? 'comida';
  const of = categoryGroup(category);
  return group === 'pet' ? category === 'pet' : of === group;
}

function identify(name: string, category: string | null | undefined): ItemIdentity | null {
  const text = spelledOut(name);
  if (!text) return null;
  const first = firstProductTerm(COMPILED, text);
  if (!first) return null;
  let key: string = first.key;
  let family = FAMILY_OF.get(key) ?? null;
  // O nome genérico da família com a parte escrita depois: "Carne moída de patinho" é patinho, "Queijo prato" é prato.
  if (family === key) {
    const members = (MEMBER_TERMS.get(family) ?? []).map(({ key: member, re }) => ({ member, at: firstMention([re], text) }));
    const part = members.filter(({ at }) => at < Infinity).sort((a, b) => a.at - b.at)[0];
    if (part) key = part.member;
  }
  // Logo depois do item, uma palavra que faz outra coisa ("Batata doce", "Alho poró", "Leite em pó"): outro item,
  // a não ser que seja um tipo que o próprio item conhece (o café em pó é café).
  const after = text.slice(first.end).trim().split(' ').filter(Boolean);
  while (after.length && LINK_WORDS.has(after[0])) after.shift();
  const next = after[0] ? singular(after[0]) : '';
  if (next && (OTHER_THING.has(next) || OTHER_THING.has(after[0])) && !isKindWord(next, key, family) && !isKindWord(after[0], key, family)) {
    key = `${key}+${next}`;
    family = null;
  }
  if (!fitsGroup(key, category)) return null;
  return { key, family, kinds: readKinds(text, key, family), size: packageSize(name) };
}

const IDENTITIES = new Map<string, ItemIdentity | null>();
const IDENTITIES_LIMIT = 4000;

/**
 * Que item o nome diz, sem a marca, a embalagem nem o tamanho, ou null quando
 * o app não sabe ("Pastilha Mentos"). Com `category`, só vale um item do
 * mesmo grupo (comida, casa ou pet), como nos desenhos.
 */
export function itemIdentity(name: string, category?: string | null): ItemIdentity | null {
  // A revisão da nota compara os mesmos nomes a cada toque: o resultado fica guardado.
  const cacheKey = `${category ?? ''}\u0000${name}`;
  const known = IDENTITIES.get(cacheKey);
  if (known !== undefined) return known;
  const identity = identify(name, category);
  if (IDENTITIES.size >= IDENTITIES_LIMIT) IDENTITIES.clear();
  IDENTITIES.set(cacheKey, identity);
  return identity;
}

// ---------------------------------------------------------------------------
// O item da lista e o da nota

/**
 * `mesmo`: o mesmo item, de qualquer marca. `talvez`: pode ser (um corte ou
 * uma variedade da família, um tipo que a lista pede e a nota não diz, outro
 * tamanho). `outro`: com certeza outra coisa (outro item, ou um tipo que não
 * bate: integral e desnatado, Coca e Guaraná).
 */
export type ItemFit = 'mesmo' | 'talvez' | 'outro';

/** Os tipos do item da lista contra os do item da nota: bate, fica em dúvida ou não bate. */
function kindsFit(wanted: ItemIdentity, found: ItemIdentity): 'mesmo' | 'talvez' | 'outro' {
  let fit: 'mesmo' | 'talvez' = 'mesmo';
  const dimensions = new Set([...wanted.kinds.keys(), ...found.kinds.keys()]);
  for (const at of dimensions) {
    const { strict = [], lineDefault, soft } = KINDS[at];
    const want = wanted.kinds.get(at);
    const have = found.kinds.get(at);
    if (want && have) {
      if ([...want].some((value) => have.has(value))) continue;
      if (!soft) return 'outro';
      fit = 'talvez';
    } else if (want) {
      // A lista pede um tipo que a nota não diz: só se a nota, calada, quer dizer esse mesmo (café em pó).
      if (!(lineDefault && want.has(lineDefault))) fit = 'talvez';
    } else if (have && [...have].some((value) => strict.includes(value))) {
      // A nota diz uma versão que a lista não pediu ("COCA ZERO" para "Coca"): pode ser, mas não com certeza.
      fit = 'talvez';
    }
  }
  return fit;
}

// Vendidos a peso: o tamanho escrito é o desta compra, não da embalagem ("Banana 700g" e "BANANA KG").
const WEIGHED = new Set(['hortifruti', 'carnes', 'peixes']);

function identityFit(wanted: ItemIdentity, found: ItemIdentity, weighed: boolean): ItemFit {
  let fit: ItemFit;
  if (wanted.key === found.key) fit = kindsFit(wanted, found);
  else if (wanted.family != null && wanted.family === found.family && (wanted.key === wanted.family || found.key === found.family)) {
    // O nome da família de um lado e uma parte dela do outro ("Carne" e "Bombom da Alcatra"): só pode ser.
    fit = kindsFit(wanted, found) === 'outro' ? 'outro' : 'talvez';
  } else return 'outro';
  // Os dois dizem o tamanho, e não é o mesmo ("Arroz 5kg" e "ARROZ 1KG"): pode ser, mas não com certeza.
  if (fit === 'mesmo' && !weighed && wanted.size && found.size && !samePackageSize(wanted.size, found.size)) fit = 'talvez';
  return fit;
}

/**
 * O item da lista e o item da nota (com todos os nomes dele: o produto, a
 * sugestão da leitura e o texto da nota) são o mesmo item? null quando um
 * dos dois não diz que item é. Um nome da nota que diz outra coisa decide
 * ("LEITE PIRAC INT" com o produto "Leite Piracanjuba" não é leite
 * desnatado): na dúvida, não junta.
 */
export function sameItemFit(
  wanted: { name: string; category?: string | null },
  found: { names: readonly string[]; category?: string | null },
): ItemFit | null {
  const want = itemIdentity(wanted.name, wanted.category);
  if (!want) return null;
  const weighed = WEIGHED.has(wanted.category ?? '') || WEIGHED.has(found.category ?? '');
  let best: ItemFit | null = null;
  for (const name of found.names) {
    const have = itemIdentity(name, found.category);
    if (!have) continue;
    const fit = identityFit(want, have, weighed);
    if (fit === 'outro') return 'outro';
    if (fit === 'mesmo' || best == null) best = fit;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Palavras em comum

/** As duas categorias podem ser do mesmo item: alguma é "outros", ou as duas são de comida, ou as duas de casa. */
export function categoriesMayMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a === 'outros' || b === 'outros' || a === b) return true;
  const group = categoryGroup(a);
  return group != null && group === categoryGroup(b);
}

// Não dizem o que é o item: ligações, tamanho, embalagem e o que a loja online acrescenta ("Peso variável").
const NOT_THE_ITEM = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para', 'em', 'a', 'o', 'g', 'l', 'un', 'maco', 'peso', 'variavel', 'aprox',
  'tradicional', 'organico', 'organica', 'grande', 'pequeno', 'medio', 'tipo', 'cada', 'leve', 'pague', 'gratis', 'unidade',
]);

function itemWords(name: string): string[] {
  return spelledOut(name)
    .split(' ')
    .filter((word) => word.length > 1 && !/\d/.test(word) && !NOT_THE_ITEM.has(word) && !PACKAGING.has(word) && !LOOSE_UNITS.has(word))
    .map(singular);
}
const WORDS = new Map<string, string[]>();
const wordsOf = (name: string) => {
  let words = WORDS.get(name);
  if (!words) {
    if (WORDS.size >= IDENTITIES_LIMIT) WORDS.clear();
    words = itemWords(name);
    WORDS.set(name, words);
  }
  return words;
};

// A mesma palavra, ou uma abreviação dela de 3 letras ou mais ("DET" e "detergente", "MARGAR" e "margarina").
const wordHit = (word: string, have: readonly string[]) =>
  have.some((other) => other === word || (other.length >= 3 && word.startsWith(other)) || (word.length >= 3 && other.startsWith(word)));

/**
 * Quanto das palavras do item da lista está num dos nomes do item da nota
 * (de 0 a 1), contando abreviação; a primeira palavra da lista é o item
 * ("Salsa" de "Salsa maço") e precisa estar lá.
 */
export function wordOverlap(listName: string, receiptNames: readonly string[]): number {
  const want = wordsOf(listName);
  if (!want.length) return 0;
  let best = 0;
  for (const name of receiptNames) {
    const have = wordsOf(name);
    if (!wordHit(want[0], have)) continue;
    best = Math.max(best, want.filter((word) => wordHit(word, have)).length / want.length);
  }
  return best;
}
