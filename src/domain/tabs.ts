// As partes (sub-abas) das abas Compras, Casa e Saúde, guardadas na URL (?aba=), e os endereços antigos de partes
// que mudaram de lugar. Favoritos do navegador e o app instalado na tela inicial guardam o endereço de quando foram
// criados: /casa?aba=compras e /casa?aba=despensa eram a Casa de antes, que tinha as compras e a despensa;
// /casa?aba=tarefas e /casa?aba=agenda, de quando as tarefas e a agenda eram cada uma uma parte da Casa; /financas, de
// quando Finanças era uma aba; e /saude?aba=treino e /saude?aba=dieta, a Saúde de antes, que tinha o treino e a dieta
// cada um numa parte.

/** Compras: o ciclo do que entra na casa (lista, compra, nota, despensa), nesta ordem na barra das partes. */
export const COMPRAS_TABS = [
  { value: 'listas', label: 'Listas' },
  { value: 'notas', label: 'Notas' },
  { value: 'despensa', label: 'Despensa' },
] as const;

export type ComprasTab = (typeof COMPRAS_TABS)[number]['value'];

/**
 * Casa: o que mantém a casa funcionando, nesta ordem na barra das partes. O Dia a dia junta as tarefas e a agenda
 * (o que tem para fazer e quando), e Finanças, que já foi uma aba, é uma parte daqui.
 */
export const CASA_TABS = [
  { value: 'dia', label: 'Dia a dia' },
  { value: 'financas', label: 'Finanças' },
  { value: 'aparelhos', label: 'Aparelhos' },
  { value: 'documentos', label: 'Documentos' },
] as const;

export type CasaTab = (typeof CASA_TABS)[number]['value'];

/** As partes da Casa que esta versão mostra: sem a chave de Finanças (lib/features), a parte dela não existe. */
export function casaTabs(finance: boolean): readonly { value: CasaTab; label: string }[] {
  return finance ? CASA_TABS : CASA_TABS.filter((tab) => tab.value !== 'financas');
}

/**
 * A largura de tela a partir da qual as quatro partes da Casa cabem com folga no seletor. Em Nunito 15 Bold os
 * quatro rótulos somam 281; num celular de 360 o seletor tem 310 por dentro, e com o recuo de cada parte sobraria
 * menos do que nada: ele cortaria os quatro com "…". Abaixo desta largura o seletor fica apertado (rótulos um ponto
 * menores, metade do recuo), e num de 360 cada rótulo fica com 6 de cada lado, como antes de Finanças entrar aqui.
 * Com três partes (sem Finanças) cabem sempre. As medidas estão em features/__tests__/tabTops.test.tsx.
 */
export const CASA_ROOMY_WIDTH = 375;

/**
 * Abaixo desta largura nem apertado os quatro cabem (num celular de 320 o seletor tem 270 por dentro, e apertados
 * eles pedem 278): o seletor fica justo, com os rótulos dois pontos menores.
 */
export const CASA_NARROW_WIDTH = 340;

/** Como o seletor de partes se ajusta à largura: o `fit` do Segmented (ui/primitives). */
export type SegmentedFit = 'normal' | 'dense' | 'tight';

/**
 * O ajuste do seletor das partes da Casa. `parts`: quantas partes ele mostra; `width`: a largura da janela.
 */
export function casaTabsFit(parts: number, width: number): SegmentedFit {
  if (parts <= 3 || width >= CASA_ROOMY_WIDTH) return 'normal';
  return width < CASA_NARROW_WIDTH ? 'tight' : 'dense';
}

/** Casa → Dia a dia, no seletor dela e na URL (?dia=): as tarefas, que são a que abre, e a agenda. */
export const DIA_A_DIA = [
  { value: 'tarefas', label: 'Tarefas' },
  { value: 'agenda', label: 'Agenda' },
] as const;

export type DiaADia = (typeof DIA_A_DIA)[number]['value'];

/** Casa → Finanças, no seletor dela e na URL (?financas=): o resumo, que é a que abre, e as contas. */
export const FINANCAS = [
  { value: 'resumo', label: 'Resumo' },
  { value: 'contas', label: 'Contas' },
] as const;

export type Financas = (typeof FINANCAS)[number]['value'];

/**
 * Saúde, nesta ordem na barra das partes: o Resumo (o que pede atenção), os Remédios (o item de uso diário, numa
 * parte própria), os Cuidados (consultas, vacinas, exames e a ficha de cada um) e os Planos (treino e dieta).
 */
export const SAUDE_TABS = [
  { value: 'resumo', label: 'Resumo' },
  { value: 'remedios', label: 'Remédios' },
  { value: 'cuidados', label: 'Cuidados' },
  { value: 'planos', label: 'Planos' },
] as const;

export type SaudeTab = (typeof SAUDE_TABS)[number]['value'];

/** Os planos de Saúde → Planos, no seletor dela e na URL (?plano=): a ficha de treino e o plano alimentar. */
export const PLANOS = [
  { value: 'treino', label: 'Treino' },
  { value: 'dieta', label: 'Dieta' },
] as const;

export type Plano = (typeof PLANOS)[number]['value'];

/** A parte pedida na URL; sem ela, ou com um valor que não existe, a primeira (a de abrir). */
export function tabFromParam<T extends string>(tabs: readonly { value: T }[], value: string | string[] | undefined): T {
  const wanted = Array.isArray(value) ? value[0] : value;
  return tabs.find((tab) => tab.value === wanted)?.value ?? tabs[0].value;
}

/** Para onde vai um endereço antigo: a aba (o caminho) e, quando não é a primeira, a parte dela. */
export interface MovedTo {
  pathname: '/compras';
  aba: ComprasTab | null;
}

/**
 * A parte que a Casa tinha e passou para Compras: as listas (/casa?aba=compras) e a despensa
 * (/casa?aba=despensa). Qualquer outro ?aba= fica na Casa (null): as partes de hoje e as que não existem, que
 * abrem a primeira.
 */
export function movedFromCasa(value: string | string[] | undefined): MovedTo | null {
  const wanted = Array.isArray(value) ? value[0] : value;
  if (wanted === 'compras') return { pathname: '/compras', aba: null };
  if (wanted === 'despensa') return { pathname: '/compras', aba: 'despensa' };
  return null;
}

/**
 * A parte que Finanças tinha e passou para Compras: as notas (/financas?aba=notas). Só conta com a chave de
 * Finanças ligada (sem ela, o endereço nem abre).
 */
export function movedFromFinance(value: string | string[] | undefined): MovedTo | null {
  const wanted = Array.isArray(value) ? value[0] : value;
  return wanted === 'notas' ? { pathname: '/compras', aba: 'notas' } : null;
}

/** O endereço de uma parte de Casa → Finanças: sempre com a parte, para a aba já montada trocar para ela. */
export interface FinanceAddress {
  pathname: '/casa';
  params: { aba: 'financas'; financas: Financas };
}

export const financeAddress = (part: Financas): FinanceAddress => ({ pathname: '/casa', params: { aba: 'financas', financas: part } });

/**
 * Para onde vai o endereço da aba Finanças de antes (/financas, com ou sem ?aba=): as notas foram para Compras
 * (movedFromFinance) e o resto, para Casa → Finanças, no resumo ou nas contas.
 */
export function movedFinanceTab(value: string | string[] | undefined): { compras: MovedTo } | { casa: FinanceAddress } {
  const compras = movedFromFinance(value);
  return compras ? { compras } : { casa: financeAddress(tabFromParam(FINANCAS, value)) };
}

/** O que a Casa abre; `moved`: o endereço era um dos antigos, e a tela troca para o de agora. */
export interface CasaParts {
  tab: CasaTab;
  day: DiaADia;
  money: Financas;
  moved: boolean;
}

/**
 * O que a Casa abre com os parâmetros da URL. O ?dia= vale só no Dia a dia e o ?financas= só em Finanças; sem eles,
 * ou com um valor que não existe, a primeira de cada (as tarefas, o resumo). Os endereços antigos ?aba=tarefas e
 * ?aba=agenda, de quando cada uma era uma parte, abrem o Dia a dia naquela, qualquer que seja o ?dia= que venha
 * junto. Sem a chave de Finanças, ?aba=financas abre a primeira parte, como qualquer parte que não existe.
 */
export function casaParts(
  aba: string | string[] | undefined,
  dia: string | string[] | undefined,
  financas: string | string[] | undefined,
  finance: boolean,
): CasaParts {
  const wanted = Array.isArray(aba) ? aba[0] : aba;
  const money = tabFromParam(FINANCAS, financas);
  const old = DIA_A_DIA.find((part) => part.value === wanted);
  if (old) return { tab: 'dia', day: old.value, money, moved: true };
  return { tab: tabFromParam(casaTabs(finance), aba), day: tabFromParam(DIA_A_DIA, dia), money, moved: false };
}

/** A parte e o plano que a Saúde abre; `moved`: o endereço era um dos antigos, e a tela troca para o de agora. */
export interface HealthParts {
  tab: SaudeTab;
  plan: Plano;
  moved: boolean;
}

/**
 * O que a Saúde abre com os parâmetros da URL. O plano (?plano=) vale só em Planos; sem ele, ou com um que não
 * existe, o treino (o primeiro). Os endereços antigos ?aba=treino e ?aba=dieta, de quando cada um era uma parte,
 * abrem Planos com aquele plano escolhido, qualquer que seja o ?plano= que venha junto.
 */
export function healthParts(aba: string | string[] | undefined, plano: string | string[] | undefined): HealthParts {
  const wanted = Array.isArray(aba) ? aba[0] : aba;
  const old = PLANOS.find((plan) => plan.value === wanted);
  if (old) return { tab: 'planos', plan: old.value, moved: true };
  return { tab: tabFromParam(SAUDE_TABS, aba), plan: tabFromParam(PLANOS, plano), moved: false };
}
