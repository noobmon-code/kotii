// "Primeiros passos" da tela Hoje: quatro coisas que fazem a casa nova andar (convidar alguém, a primeira lista, a
// primeira nota, as pessoas e os pets sem celular). Cada passo se marca pelo que a casa já tem, sem tabela nova; o
// cartão some quando os quatro estão feitos, ou quando a pessoa dispensa, e nos dois casos não volta (guardado no
// aparelho, por casa: lib/firstSteps). Enquanto falta saber algum dos quatro, o cartão não aparece: um passo dado
// não pode aparecer como por fazer.

export type FirstStepKey = 'convidar' | 'lista' | 'nota' | 'pessoas';

/** O que a casa tem, para cada passo; undefined: ainda não se sabe (carregando, sem internet, ou a busca falhou). */
export interface FirstStepsFacts {
  /** Quantos moradores (contas no app) a casa tem: com mais de um, alguém foi convidado. */
  members: number | undefined;
  /** A casa já teve uma lista, de qualquer tipo, aberta ou arquivada. */
  anyList: boolean | undefined;
  /** A casa já tem uma nota, rascunho ou confirmada. */
  anyReceipt: boolean | undefined;
  /** Quantas fichas de quem não usa o app (pessoa ou pet) a casa tem. */
  peopleWithoutApp: number | undefined;
}

export interface FirstStep {
  key: FirstStepKey;
  title: string;
  /** O que fazer, enquanto o passo não foi dado. */
  hint: string;
  done: boolean;
}

export const FIRST_STEPS_TITLE = 'Primeiros passos';
export const FIRST_STEPS_DISMISS = 'Dispensar';
export const FIRST_STEP_DONE = 'Feito';

const STEPS: readonly { key: FirstStepKey; title: string; hint: string }[] = [
  { key: 'convidar', title: 'Convidar alguém da casa', hint: 'Em Configurações, com o código de convite' },
  { key: 'lista', title: 'Criar a primeira lista', hint: 'A lista de mercado, que a casa toda vê e marca' },
  { key: 'nota', title: 'Escanear a primeira nota', hint: 'O QR code da nota fiscal guarda os preços' },
  { key: 'pessoas', title: 'Cadastrar pessoas e pets', hint: 'Crianças, idosos e pets que não usam o app' },
];

/** Os quatro passos, na ordem, cada um feito ou não; null enquanto falta saber algum deles. */
export function firstSteps(facts: FirstStepsFacts): FirstStep[] | null {
  const { members, anyList, anyReceipt, peopleWithoutApp } = facts;
  if (members === undefined || anyList === undefined || anyReceipt === undefined || peopleWithoutApp === undefined) return null;
  const done: Record<FirstStepKey, boolean> = {
    convidar: members > 1,
    lista: anyList,
    nota: anyReceipt,
    pessoas: peopleWithoutApp > 0,
  };
  return STEPS.map((step) => ({ ...step, done: done[step.key] }));
}

/**
 * O cartão aparece: os passos já se sabem, a dispensa já foi lida do aparelho (undefined: lendo) e não foi dada,
 * e falta algum passo.
 */
export function showFirstSteps(steps: readonly FirstStep[] | null, dismissed: boolean | undefined): steps is FirstStep[] {
  return steps !== null && dismissed === false && steps.some((step) => !step.done);
}

/** "1 de 4 feitos". */
export function firstStepsProgress(steps: readonly FirstStep[]): string {
  const done = steps.filter((step) => step.done).length;
  return `${done} de ${steps.length} ${done === 1 ? 'feito' : 'feitos'}`;
}
