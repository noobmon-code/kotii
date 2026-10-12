// Rodízio de tarefas: a tarefa que se repete passa de pessoa em pessoa, na
// ordem escolhida (chore_rotation, fichas de pessoas da casa). De quem é a vez
// fica na própria tarefa, como em qualquer outra: assigned_to (morador) ou
// kid_id (pessoa sem o app, que ganha os pontos). Concluir passa a vez no
// banco (complete_chore); "Pular a vez" passa sem concluir (skip_chore_turn).

import { choreAssigneeLabel, type Recurrence } from './chores';
import { formatShortDate } from './dates';

/** Quem pode entrar num rodízio: uma ficha de pessoa da casa. */
export interface RotationPerson {
  /** A ficha (people.id). */
  id: string;
  name: string;
  /** A conta do morador; null para quem não tem o app (criança). */
  userId: string | null;
}

/** Onde a tarefa guarda de quem é a vez. */
export interface ChoreTurn {
  assigned_to: string | null;
  kid_id: string | null;
}

/** As ordens da casa: para cada tarefa em rodízio, as fichas na ordem. */
export type ChoreRotations = Record<string, string[]>;

export const ROTATION_MIN_PEOPLE = 2;
/** O mesmo teto de save_chore_rotation. */
export const ROTATION_MAX_PEOPLE = 20;

/**
 * As pessoas da casa que podem revezar: moradores (pela ficha de cada um, com
 * o nome que usam no app) e depois quem não tem o app. Pets ficam de fora.
 */
export function rotationPeople(
  members: { user_id: string; display_name: string }[],
  people: { id: string; name: string; kind: string; member_user_id: string | null }[],
): RotationPerson[] {
  const persons = people.filter((p) => p.kind === 'pessoa');
  const withApp = members.flatMap((m) => {
    const person = persons.find((p) => p.member_user_id === m.user_id);
    return person ? [{ id: person.id, name: m.display_name, userId: m.user_id }] : [];
  });
  const withoutApp = persons.filter((p) => !p.member_user_id).map((p) => ({ id: p.id, name: p.name, userId: null }));
  return [...withApp, ...withoutApp];
}

/** Junta as linhas de chore_rotation por tarefa, na ordem. */
export function groupRotations(rows: { chore_id: string; person_id: string; position: number }[]): ChoreRotations {
  const out: ChoreRotations = {};
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    (out[row.chore_id] ??= []).push(row.person_id);
  }
  return out;
}

/**
 * A ordem de uma tarefa. Sem rodízio, vazia: também enquanto as ordens não
 * carregaram, no banco que ainda não tem o rodízio e se sobrou uma pessoa só.
 */
export function rotationOf(rotations: ChoreRotations | undefined, choreId: string | undefined): string[] {
  const order = (choreId && rotations?.[choreId]) || [];
  return order.length >= ROTATION_MIN_PEOPLE ? order : [];
}

/** O que gravar na tarefa para a vez ser desta pessoa (sem pessoa: qualquer um). */
export function turnOf(person: RotationPerson | null | undefined): ChoreTurn {
  if (!person) return { assigned_to: null, kid_id: null };
  return person.userId ? { assigned_to: person.userId, kid_id: null } : { assigned_to: null, kid_id: person.id };
}

/** De quem é a vez, pelo que está gravado na tarefa. */
export function currentTurn(chore: ChoreTurn, people: RotationPerson[]): RotationPerson | null {
  if (chore.kid_id) return people.find((p) => p.id === chore.kid_id) ?? null;
  if (chore.assigned_to) return people.find((p) => p.userId === chore.assigned_to) ?? null;
  return null;
}

/** A ordem só com quem ainda é pessoa da casa, sem repetir. */
function knownOrder(order: string[], people: RotationPerson[]): RotationPerson[] {
  const seen = new Set<string>();
  return order.flatMap((id) => {
    const person = people.find((p) => p.id === id);
    if (!person || seen.has(id)) return [];
    seen.add(id);
    return [person];
  });
}

/**
 * Quem vem depois: o seguinte na ordem (depois do último, o primeiro). Se a
 * vez é de alguém de fora da ordem (ou de ninguém), o primeiro, como no banco.
 * Null quando não há rodízio.
 */
export function nextTurn(chore: ChoreTurn, order: string[], people: RotationPerson[]): RotationPerson | null {
  const line = knownOrder(order, people);
  if (line.length < ROTATION_MIN_PEOPLE) return null;
  const current = currentTurn(chore, people);
  const at = current ? line.findIndex((p) => p.id === current.id) : -1;
  return line[(at + 1) % line.length];
}

// ---------------------------------------------------------------------------
// Textos (sem artigo antes do nome: o app não sabe o gênero de ninguém)

const pointsLabel = (points: number) => `${points} ${points === 1 ? 'ponto' : 'pontos'}`;

export const turnLabel = (name: string) => `Vez de ${name}`;
export const afterLabel = (name: string) => `depois ${name}`;
export const nextTurnMessage = (name: string) => `Próxima vez: ${name}.`;

/** "1 Beto · 2 Carla · 3 Lia". */
export function numberedOrder(order: string[], people: RotationPerson[]): string {
  return knownOrder(order, people)
    .map((p, i) => `${i + 1} ${p.name}`)
    .join(' · ');
}

/** A pergunta do "Pular a vez". */
export function skipTurnQuestion(from: string | null | undefined, to: string): string {
  return from ? `Passar a vez de ${from} para ${to}?` : `Passar a vez para ${to}?`;
}

/**
 * "Vez de Beto · depois Carla" (com os pontos, se a vez é de criança e a
 * tarefa vale pontos). Null quando a tarefa não está em rodízio.
 */
export function rotationLabel(chore: ChoreTurn & { points: number }, order: string[], people: RotationPerson[]): string | null {
  const next = nextTurn(chore, order, people);
  if (!next) return null;
  const current = currentTurn(chore, people);
  return [
    current ? turnLabel(current.name) : 'Rodízio',
    current && !current.userId && chore.points > 0 ? pointsLabel(chore.points) : null,
    afterLabel(next.name),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Quem faz a tarefa, para as listas: o rodízio, ou o responsável de sempre (choreAssigneeLabel). */
export function choreTurnLabel(
  chore: ChoreTurn & { points: number },
  order: string[],
  members: { user_id: string; display_name: string }[],
  people: { id: string; name: string; kind: string; member_user_id: string | null }[],
): string | null {
  return rotationLabel(chore, order, rotationPeople(members, people)) ?? choreAssigneeLabel(chore, members, people);
}

/**
 * O aviso depois de concluir: os pontos que o servidor de fato creditou, com o
 * nome de quem recebeu (a tarefa pode ter mudado em outro celular; toque
 * repetido não conta), e de quem é a vez agora. Null: nada a dizer.
 */
export function completionMessage(
  result: { completed: boolean; points: number; person_id: string | null; next_person_id?: string | null },
  people: { id: string; name: string }[],
): { title: string; message?: string } | null {
  if (!result.completed) return null;
  const name = (id: string | null | undefined) => (id ? people.find((p) => p.id === id)?.name : undefined);
  const kid = name(result.person_id);
  const next = name(result.next_person_id);
  if (kid && result.points > 0) {
    return {
      title: `+${pointsLabel(result.points)} para ${kid}!`,
      message: [next ? nextTurnMessage(next) : null, 'O saldo fica em Casa → Tarefas → Pontos das crianças.'].filter(Boolean).join(' '),
    };
  }
  return next ? { title: nextTurnMessage(next) } : null;
}

// ---------------------------------------------------------------------------
// Editor da tarefa

/** Toque numa pessoa do rodízio: entra no fim da ordem, ou sai (e os outros sobem). */
export function toggleInOrder(order: string[], personId: string): string[] {
  return order.includes(personId) ? order.filter((id) => id !== personId) : [...order, personId];
}

/** Alguém da ordem pode ganhar pontos (não tem o app)? */
export function orderHasKid(order: string[], people: RotationPerson[]): boolean {
  return knownOrder(order, people).some((p) => !p.userId);
}

/**
 * De quem são os pontos de um rodízio, para completar "Vale 10 …" no editor:
 * só de quem não tem o app, cada um na sua vez ("pontos quando for a vez de
 * Lia ou Marcos"). Pelo nome, sem "criança": pode ser um adulto. Null quando
 * todos na ordem têm o app (ninguém ganha pontos).
 */
export function rotationPointsLabel(order: string[], people: RotationPerson[]): string | null {
  const names = knownOrder(order, people)
    .filter((p) => !p.userId)
    .map((p) => p.name);
  if (!names.length) return null;
  const last = names.pop();
  return `pontos quando for a vez de ${names.length ? `${names.join(', ')} ou ${last}` : last}`;
}

/** O que falta para salvar o rodízio; null se está tudo certo. */
export function rotationProblem(order: string[], people: RotationPerson[]): string | null {
  const count = knownOrder(order, people).length;
  if (count < ROTATION_MIN_PEOPLE) return 'Escolha duas ou mais pessoas para o rodízio, na ordem em que vão revezar.';
  if (count > ROTATION_MAX_PEOPLE) return `O rodízio aceita até ${ROTATION_MAX_PEOPLE} pessoas.`;
  return null;
}

/** A tarefa como está gravada (sem isso: tarefa nova). */
export interface SavedRotation {
  turn: ChoreTurn;
  /**
   * A ordem gravada que o formulário mostrou ao abrir; vazia se a tarefa não
   * estava em rodízio. Não a do cache na hora de salvar: o formulário que não
   * mostrou um rodízio (criado depois, em outro celular) não pode encerrá-lo.
   */
  order: string[];
}

/**
 * De quem fica a vez com a ordem escolhida: de quem já era, se continua na
 * ordem; senão (ou num rodízio novo), do primeiro.
 */
export function plannedTurn(saved: SavedRotation | undefined, order: string[], people: RotationPerson[]): RotationPerson | null {
  const line = knownOrder(order, people);
  const current = saved?.order.length ? currentTurn(saved.turn, people) : null;
  return (current && line.find((p) => p.id === current.id)) || line[0] || null;
}

export type AssigneeChoice = { mode: 'rotation'; order: string[] } | ({ mode: 'single' } & ChoreTurn);

export interface RotationSave {
  /** O responsável a gravar na tarefa; undefined: a vez fica como está no banco. */
  turn?: ChoreTurn;
  /** A ordem para save_chore_rotation (vazia: encerra o rodízio); null: não chamar. */
  people: string[] | null;
}

/**
 * O que salvar pela escolha feita no editor:
 * - rodízio (tarefa que se repete, duas ou mais pessoas): manda a ordem. Num
 *   rodízio novo a vez é do primeiro; num que já existia o banco mantém a vez
 *   de quem continua na ordem (ou passa ao primeiro), então a tarefa nem
 *   manda o responsável: a vez pode ter andado em outro celular;
 * - rodízio numa tarefa que virou "Uma vez", ou com menos de duas pessoas:
 *   fica só a pessoa da vez, sem rodízio;
 * - uma pessoa só ou qualquer um: o que foi escolhido, e o rodízio que havia
 *   é encerrado. Sem rodízio antes, nada é chamado (o banco pode nem tê-lo).
 */
export function planRotationSave(input: {
  saved?: SavedRotation;
  recurrence: Recurrence;
  choice: AssigneeChoice;
  people: RotationPerson[];
}): RotationSave {
  const { saved, recurrence, choice, people } = input;
  const had = Boolean(saved?.order.length);
  const end = had ? [] : null;
  if (choice.mode === 'single') return { turn: { assigned_to: choice.assigned_to, kid_id: choice.kid_id }, people: end };
  const line = knownOrder(choice.order, people);
  if (recurrence === 'none' || line.length < ROTATION_MIN_PEOPLE) {
    return { turn: turnOf(plannedTurn(saved, choice.order, people)), people: end };
  }
  const order = line.map((p) => p.id);
  return had ? { people: order } : { turn: turnOf(line[0]), people: order };
}

// ---------------------------------------------------------------------------
// Pontos das crianças

/**
 * As tarefas de uma criança em "Pontos das crianças": as que são só dela e as
 * dos rodízios em que ela está, também fora da vez dela (a tarefa não some do
 * cartão quando a vez passa). Embaixo de cada uma, os pontos e a data, como
 * sempre ("10 pontos · para hoje"); no rodízio, também a vez: "10 pontos · na
 * vez · para hoje" ou, na vez de outra pessoa, "10 pontos · vez de Beto" (a
 * data, aí, é de quem está na vez). Sem as ordens, só as tarefas dela.
 */
export function kidChores<C extends ChoreTurn & { id: string; points: number; due_on: string }>(
  kidId: string,
  chores: C[],
  rotations: ChoreRotations | undefined,
  people: RotationPerson[],
  today: string,
): { chore: C; subtitle: string }[] {
  return chores.flatMap((chore) => {
    const line = knownOrder(rotationOf(rotations, chore.id), people);
    const rotates = line.length >= ROTATION_MIN_PEOPLE && line.some((p) => p.id === kidId);
    const mine = chore.kid_id === kidId;
    if (!mine && !rotates) return [];
    const due = chore.due_on <= today ? 'para hoje' : `próxima ${formatShortDate(chore.due_on, Number(today.slice(0, 4)))}`;
    const current = currentTurn(chore, people);
    const turn = !rotates ? [due] : mine ? ['na vez', due] : [current ? `vez de ${current.name}` : 'em rodízio'];
    return [{ chore, subtitle: [pointsLabel(chore.points), ...turn].join(' · ') }];
  });
}

// ---------------------------------------------------------------------------
// Banco sem o rodízio (o app pode chegar antes da migração)

export const ROTATION_UNAVAILABLE = 'O rodízio ainda não está disponível nesta casa. Tente de novo mais tarde.';

/** O formulário abriu sem rodízio e a tarefa ganhou um em outro aparelho: salvar gravaria a vez e os pontos de antes. */
export const ROTATION_CHANGED_ELSEWHERE = 'Ela ganhou um rodízio em outro aparelho. Feche e abra de novo para editar.';

// Tabela ou função que o banco não tem: como a API responde (PGRST205 e
// PGRST202) e os códigos do Postgres para o mesmo (42P01 e 42883).
const MISSING_CODES = new Set(['PGRST205', 'PGRST202', '42P01', '42883']);

/**
 * O banco ainda não tem o rodízio (chore_rotation, save_chore_rotation,
 * skip_chore_turn)? Aí ler as ordens devolve "nenhuma" e salvar ou pular
 * avisa com ROTATION_UNAVAILABLE, em vez do erro cru.
 */
export function isRotationUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  if (MISSING_CODES.has(code)) return true;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return (
    /chore_rotation|save_chore_rotation|skip_chore_turn/.test(message) && /schema cache|does not exist/i.test(message)
  );
}

/** O aviso de uma falha do rodízio: a frase clara se o banco ainda não o tem; null para os outros erros. */
export function rotationErrorMessage(error: unknown): string | null {
  return isRotationUnavailable(error) ? ROTATION_UNAVAILABLE : null;
}
