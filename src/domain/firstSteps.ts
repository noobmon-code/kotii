// "Primeiros passos" da tela Hoje: cinco coisas que fazem a casa nova andar (convidar alguém, a primeira lista, a
// primeira nota, o que a casa já tem na despensa, as pessoas e os pets sem celular). Cada passo se marca pelo que a
// casa já tem, sem tabela nova; o cartão some quando todos estão feitos, ou quando a pessoa dispensa, e nos dois
// casos não volta (guardado no aparelho, por casa: lib/firstSteps). Enquanto falta saber algum deles, o cartão não
// aparece: um passo dado não pode aparecer como por fazer. O da despensa pode ser pulado: ele sai do cartão neste
// aparelho, e os outros seguem.

export type FirstStepKey = 'convidar' | 'lista' | 'nota' | 'despensa' | 'pessoas';

/** O que a casa tem, para cada passo; undefined: ainda não se sabe (carregando, sem internet, ou a busca falhou). */
export interface FirstStepsFacts {
  /** Quantos moradores (contas no app) a casa tem: com mais de um, alguém foi convidado. */
  members: number | undefined;
  /** A casa já teve uma lista, de qualquer tipo, aberta ou arquivada. */
  anyList: boolean | undefined;
  /** A casa já tem uma nota, rascunho ou confirmada. */
  anyReceipt: boolean | undefined;
  /** A casa já pôs alguma coisa na despensa (também o que já acabou). */
  anyPantry: boolean | undefined;
  /** Quantas fichas de quem não usa o app (pessoa ou pet) a casa tem. */
  peopleWithoutApp: number | undefined;
}

export interface FirstStep {
  key: FirstStepKey;
  title: string;
  /** O que fazer, enquanto o passo não foi dado. */
  hint: string;
  done: boolean;
  /** O passo que dá para pular (FIRST_STEP_SKIP): sai do cartão sem ser feito. */
  skippable: boolean;
}

export const FIRST_STEPS_TITLE = 'Primeiros passos';
export const FIRST_STEPS_DISMISS = 'Dispensar';
export const FIRST_STEP_DONE = 'Feito';
export const FIRST_STEP_SKIP = 'Pular';

const STEPS: readonly { key: FirstStepKey; title: string; hint: string; skippable?: boolean }[] = [
  { key: 'convidar', title: 'Convidar alguém da casa', hint: 'Em Configurações, com o código de convite' },
  { key: 'lista', title: 'Criar a primeira lista', hint: 'A lista de mercado, que a casa toda vê e marca' },
  { key: 'nota', title: 'Escanear a primeira nota', hint: 'O QR code da nota fiscal guarda os preços' },
  {
    key: 'despensa',
    title: 'Guardar o que já tem em casa',
    hint: 'Pela câmera: o código de barras ou uma foto da prateleira',
    skippable: true,
  },
  { key: 'pessoas', title: 'Cadastrar pessoas e pets', hint: 'Crianças, idosos e pets que não usam o app' },
];

/** Os passos que dá para pular. */
export const SKIPPABLE_FIRST_STEPS: readonly FirstStepKey[] = STEPS.filter((step) => step.skippable).map((step) => step.key);

/**
 * Os passos, na ordem, cada um feito ou não; null enquanto falta saber algum deles. `skipped`: os que a pessoa
 * pulou neste aparelho, que saem da lista (e não precisam ser sabidos); só os que dá para pular contam.
 */
export function firstSteps(facts: FirstStepsFacts, skipped: ReadonlySet<string> = new Set()): FirstStep[] | null {
  const { members, anyList, anyReceipt, anyPantry, peopleWithoutApp } = facts;
  const known: Record<FirstStepKey, boolean | undefined> = {
    convidar: members === undefined ? undefined : members > 1,
    lista: anyList,
    nota: anyReceipt,
    despensa: anyPantry,
    pessoas: peopleWithoutApp === undefined ? undefined : peopleWithoutApp > 0,
  };
  const shown = STEPS.filter((step) => !(step.skippable && skipped.has(step.key)));
  if (shown.some((step) => known[step.key] === undefined)) return null;
  return shown.map((step) => ({ key: step.key, title: step.title, hint: step.hint, done: known[step.key] === true, skippable: Boolean(step.skippable) }));
}

/**
 * O cartão aparece: os passos já se sabem, a dispensa já foi lida do aparelho (undefined: lendo) e não foi dada,
 * e falta algum passo.
 */
export function showFirstSteps(steps: readonly FirstStep[] | null, dismissed: boolean | undefined): steps is FirstStep[] {
  return steps !== null && dismissed === false && steps.some((step) => !step.done);
}

/** "1 de 5 feitos" (ou "de 4", com o passo pulado). */
export function firstStepsProgress(steps: readonly FirstStep[]): string {
  const done = steps.filter((step) => step.done).length;
  return `${done} de ${steps.length} ${done === 1 ? 'feito' : 'feitos'}`;
}
