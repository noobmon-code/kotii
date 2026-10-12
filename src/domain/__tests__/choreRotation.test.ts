import { describe, expect, it } from '@jest/globals';

import {
  choreTurnLabel,
  completionMessage,
  currentTurn,
  groupRotations,
  isRotationUnavailable,
  nextTurn,
  numberedOrder,
  orderHasKid,
  planRotationSave,
  plannedTurn,
  ROTATION_UNAVAILABLE,
  rotationErrorMessage,
  rotationLabel,
  rotationOf,
  rotationPeople,
  rotationProblem,
  skipTurnQuestion,
  toggleInOrder,
  turnOf,
  type RotationPerson,
} from '../choreRotation';

// Beto e Carla têm o app; Lia e Ana Clara não (crianças).
const members = [
  { user_id: 'u-beto', display_name: 'Beto' },
  { user_id: 'u-carla', display_name: 'Carla' },
];
const records = [
  { id: 'p-ana', name: 'Ana Clara', kind: 'pessoa', member_user_id: null },
  { id: 'p-beto', name: 'Roberto', kind: 'pessoa', member_user_id: 'u-beto' },
  { id: 'p-carla', name: 'Carla', kind: 'pessoa', member_user_id: 'u-carla' },
  { id: 'p-lia', name: 'Lia', kind: 'pessoa', member_user_id: null },
  { id: 'p-rex', name: 'Rex', kind: 'pet', member_user_id: null },
];
const people = rotationPeople(members, records);
const beto: RotationPerson = { id: 'p-beto', name: 'Beto', userId: 'u-beto' };
const carla: RotationPerson = { id: 'p-carla', name: 'Carla', userId: 'u-carla' };
const lia: RotationPerson = { id: 'p-lia', name: 'Lia', userId: null };
const ofBeto = { assigned_to: 'u-beto', kid_id: null };
const ofCarla = { assigned_to: 'u-carla', kid_id: null };
const ofLia = { assigned_to: null, kid_id: 'p-lia' };
const ofNobody = { assigned_to: null, kid_id: null };
const order = ['p-beto', 'p-carla', 'p-lia'];

describe('quem pode revezar', () => {
  it('moradores (com o nome do app) e depois quem não tem o app; pets ficam de fora', () => {
    expect(people).toEqual([beto, carla, { id: 'p-ana', name: 'Ana Clara', userId: null }, lia]);
  });

  it('morador sem ficha não entra', () => {
    expect(rotationPeople([...members, { user_id: 'u-novo', display_name: 'Novo' }], records)).toEqual(people);
  });
});

describe('ordens da casa', () => {
  it('agrupa as linhas por tarefa, na ordem da posição', () => {
    expect(
      groupRotations([
        { chore_id: 'louca', person_id: 'p-lia', position: 3 },
        { chore_id: 'lixo', person_id: 'p-carla', position: 1 },
        { chore_id: 'louca', person_id: 'p-beto', position: 1 },
        { chore_id: 'lixo', person_id: 'p-beto', position: 2 },
        { chore_id: 'louca', person_id: 'p-carla', position: 2 },
      ]),
    ).toEqual({ louca: order, lixo: ['p-carla', 'p-beto'] });
    expect(groupRotations([])).toEqual({});
  });

  it('sem rodízio: ordens que não carregaram, tarefa sem ordem ou com uma pessoa só', () => {
    expect(rotationOf({ louca: order }, 'louca')).toEqual(order);
    expect(rotationOf(undefined, 'louca')).toEqual([]);
    expect(rotationOf({}, 'louca')).toEqual([]);
    expect(rotationOf({ louca: ['p-beto'] }, 'louca')).toEqual([]);
    expect(rotationOf({ louca: order }, undefined)).toEqual([]);
  });
});

describe('de quem é a vez', () => {
  it('morador fica em assigned_to, quem não tem o app em kid_id', () => {
    expect(turnOf(beto)).toEqual(ofBeto);
    expect(turnOf(lia)).toEqual(ofLia);
    expect(turnOf(null)).toEqual(ofNobody);
    expect(currentTurn(ofBeto, people)).toEqual(beto);
    expect(currentTurn(ofLia, people)).toEqual(lia);
    expect(currentTurn(ofNobody, people)).toBeNull();
    expect(currentTurn({ assigned_to: 'u-saiu', kid_id: null }, people)).toBeNull();
  });

  it('o próximo é o seguinte na ordem; depois do último, o primeiro', () => {
    expect(nextTurn(ofBeto, order, people)).toEqual(carla);
    expect(nextTurn(ofCarla, order, people)).toEqual(lia);
    expect(nextTurn(ofLia, order, people)).toEqual(beto);
  });

  it('vez de alguém de fora da ordem, ou de ninguém: o próximo é o primeiro', () => {
    expect(nextTurn(ofCarla, ['p-lia', 'p-beto'], people)).toEqual(lia);
    expect(nextTurn(ofNobody, order, people)).toEqual(beto);
  });

  it('ordem vazia ou com uma pessoa só: não há rodízio', () => {
    expect(nextTurn(ofBeto, [], people)).toBeNull();
    expect(nextTurn(ofBeto, ['p-beto'], people)).toBeNull();
    // Quem não é mais ficha da casa não conta.
    expect(nextTurn(ofBeto, ['p-beto', 'p-apagada'], people)).toBeNull();
    expect(nextTurn(ofBeto, ['p-beto', 'p-apagada', 'p-lia'], people)).toEqual(lia);
  });
});

describe('textos do rodízio', () => {
  it('diz de quem é a vez e quem vem depois, sem artigo antes do nome', () => {
    expect(rotationLabel({ ...ofBeto, points: 0 }, ['p-beto', 'p-carla'], people)).toBe('Vez de Beto · depois Carla');
    expect(rotationLabel({ ...ofCarla, points: 0 }, order, people)).toBe('Vez de Carla · depois Lia');
    expect(rotationLabel({ ...ofBeto, points: 0 }, ['p-beto', 'p-ana'], people)).toBe('Vez de Beto · depois Ana Clara');
  });

  it('mostra os pontos quando a vez é de criança', () => {
    expect(rotationLabel({ ...ofLia, points: 10 }, order, people)).toBe('Vez de Lia · 10 pontos · depois Beto');
    expect(rotationLabel({ ...ofLia, points: 1 }, order, people)).toBe('Vez de Lia · 1 ponto · depois Beto');
    expect(rotationLabel({ ...ofLia, points: 0 }, order, people)).toBe('Vez de Lia · depois Beto');
    expect(rotationLabel({ ...ofBeto, points: 10 }, order, people)).toBe('Vez de Beto · depois Carla');
  });

  it('sem ninguém na vez, diz que é rodízio e quem começa', () => {
    expect(rotationLabel({ ...ofNobody, points: 0 }, order, people)).toBe('Rodízio · depois Beto');
  });

  it('com uma pessoa só ou sem ordem não é rodízio: vale o responsável de sempre', () => {
    expect(rotationLabel({ ...ofBeto, points: 0 }, ['p-beto'], people)).toBeNull();
    expect(rotationLabel({ ...ofBeto, points: 0 }, [], people)).toBeNull();
    expect(choreTurnLabel({ ...ofBeto, points: 0 }, ['p-beto'], members, records)).toBe('Beto');
    expect(choreTurnLabel({ ...ofLia, points: 10 }, [], members, records)).toBe('Lia · 10 pontos');
    expect(choreTurnLabel({ ...ofNobody, points: 0 }, [], members, records)).toBeNull();
    expect(choreTurnLabel({ ...ofCarla, points: 0 }, order, members, records)).toBe('Vez de Carla · depois Lia');
  });

  it('numera a ordem', () => {
    expect(numberedOrder(['p-beto'], people)).toBe('1 Beto');
    expect(numberedOrder(['p-beto', 'p-carla'], people)).toBe('1 Beto · 2 Carla');
    expect(numberedOrder(['p-ana', 'p-beto', 'p-lia'], people)).toBe('1 Ana Clara · 2 Beto · 3 Lia');
    expect(numberedOrder([], people)).toBe('');
  });

  it('pergunta antes de passar a vez', () => {
    expect(skipTurnQuestion('Beto', 'Carla')).toBe('Passar a vez de Beto para Carla?');
    expect(skipTurnQuestion('Ana Clara', 'Lia')).toBe('Passar a vez de Ana Clara para Lia?');
    expect(skipTurnQuestion(null, 'Carla')).toBe('Passar a vez para Carla?');
  });
});

describe('aviso depois de concluir', () => {
  const done = { completed: true, points: 0, person_id: null };

  it('diz quem é o próximo', () => {
    expect(completionMessage({ ...done, next_person_id: 'p-carla' }, people)).toEqual({ title: 'Próxima vez: Carla.' });
  });

  it('com pontos creditados, comemora e diz quem é o próximo', () => {
    expect(completionMessage({ completed: true, points: 10, person_id: 'p-lia', next_person_id: 'p-beto' }, people)).toEqual({
      title: '+10 pontos para Lia!',
      message: 'Próxima vez: Beto. O saldo fica em Casa → Tarefas → Pontos das crianças.',
    });
    expect(completionMessage({ completed: true, points: 1, person_id: 'p-lia', next_person_id: null }, people)).toEqual({
      title: '+1 ponto para Lia!',
      message: 'O saldo fica em Casa → Tarefas → Pontos das crianças.',
    });
  });

  it('sem rodízio e sem pontos, não diz nada', () => {
    expect(completionMessage({ ...done, next_person_id: null }, people)).toBeNull();
    // Banco de antes do rodízio: a resposta nem traz next_person_id.
    expect(completionMessage(done, people)).toBeNull();
    expect(completionMessage({ completed: true, points: 5, person_id: 'p-lia' }, people)?.title).toBe('+5 pontos para Lia!');
  });

  it('toque repetido (nada foi registrado) não avisa', () => {
    expect(completionMessage({ completed: false, points: 0, person_id: null, next_person_id: 'p-carla' }, people)).toBeNull();
  });
});

describe('editor: escolher a ordem', () => {
  it('tocar põe no fim; tocar de novo tira e os outros sobem', () => {
    expect(toggleInOrder([], 'p-beto')).toEqual(['p-beto']);
    expect(toggleInOrder(['p-beto', 'p-carla'], 'p-lia')).toEqual(order);
    expect(toggleInOrder(order, 'p-carla')).toEqual(['p-beto', 'p-lia']);
    expect(numberedOrder(toggleInOrder(order, 'p-carla'), people)).toBe('1 Beto · 2 Lia');
  });

  it('pede duas ou mais pessoas', () => {
    expect(rotationProblem([], people)).toMatch(/duas ou mais pessoas/);
    expect(rotationProblem(['p-beto'], people)).toMatch(/duas ou mais pessoas/);
    expect(rotationProblem(['p-beto', 'p-beto'], people)).toMatch(/duas ou mais pessoas/);
    expect(rotationProblem(['p-beto', 'p-rex'], people)).toMatch(/duas ou mais pessoas/);
    expect(rotationProblem(['p-beto', 'p-lia'], people)).toBeNull();
  });

  it('sabe se alguém da ordem ganha pontos', () => {
    expect(orderHasKid(['p-beto', 'p-carla'], people)).toBe(false);
    expect(orderHasKid(order, people)).toBe(true);
  });
});

describe('editor: o que salvar', () => {
  const rotation = (ids: string[]) => ({ mode: 'rotation' as const, order: ids });

  it('rodízio novo: a ordem, e a vez é do primeiro', () => {
    // Tarefa nova.
    expect(planRotationSave({ recurrence: 'daily', choice: rotation(['p-carla', 'p-beto', 'p-lia']), people })).toEqual({
      turn: ofCarla,
      people: ['p-carla', 'p-beto', 'p-lia'],
    });
    // Tarefa que era só de Carla: a vez vai para o primeiro da ordem.
    expect(
      planRotationSave({ saved: { turn: ofCarla, order: [] }, recurrence: 'weekly', choice: rotation(['p-lia', 'p-carla']), people }),
    ).toEqual({ turn: ofLia, people: ['p-lia', 'p-carla'] });
  });

  it('rodízio que já existia: manda só a ordem, e a vez fica com o banco', () => {
    const saved = { turn: ofCarla, order };
    expect(planRotationSave({ saved, recurrence: 'daily', choice: rotation(['p-lia', 'p-carla']), people })).toEqual({
      people: ['p-lia', 'p-carla'],
    });
    // Quem continua na ordem mantém a vez; quem saiu passa para o primeiro.
    expect(plannedTurn(saved, ['p-lia', 'p-carla'], people)).toEqual(carla);
    expect(plannedTurn(saved, ['p-lia', 'p-beto'], people)).toEqual(lia);
    expect(plannedTurn(undefined, ['p-lia', 'p-beto'], people)).toEqual(lia);
    // Tarefa que não estava em rodízio: o responsável de antes não segura a vez.
    expect(plannedTurn({ turn: ofBeto, order: [] }, ['p-lia', 'p-beto'], people)).toEqual(lia);
  });

  it('menos de duas pessoas: sem rodízio, fica quem sobrou', () => {
    expect(planRotationSave({ recurrence: 'daily', choice: rotation(['p-lia']), people })).toEqual({ turn: ofLia, people: null });
    expect(planRotationSave({ recurrence: 'daily', choice: rotation([]), people })).toEqual({ turn: ofNobody, people: null });
    expect(
      planRotationSave({ saved: { turn: ofCarla, order }, recurrence: 'daily', choice: rotation(['p-beto']), people }),
    ).toEqual({ turn: ofBeto, people: [] });
  });

  it('"Uma vez": fica só a pessoa da vez e o rodízio acaba', () => {
    expect(planRotationSave({ saved: { turn: ofCarla, order }, recurrence: 'none', choice: rotation(order), people })).toEqual({
      turn: ofCarla,
      people: [],
    });
    // Tarefa nova que nem chegou a ter rodízio: o primeiro escolhido, e nada a encerrar.
    expect(planRotationSave({ recurrence: 'none', choice: rotation(order), people })).toEqual({ turn: ofBeto, people: null });
  });

  it('uma pessoa só ou qualquer um: grava a escolha e encerra o rodízio que havia', () => {
    expect(
      planRotationSave({ saved: { turn: ofCarla, order }, recurrence: 'daily', choice: { mode: 'single', ...ofLia }, people }),
    ).toEqual({ turn: ofLia, people: [] });
    expect(
      planRotationSave({ saved: { turn: ofCarla, order }, recurrence: 'daily', choice: { mode: 'single', ...ofNobody }, people }),
    ).toEqual({ turn: ofNobody, people: [] });
  });

  it('tarefa sem rodízio continua como sempre: nada do rodízio é chamado', () => {
    expect(planRotationSave({ recurrence: 'weekly', choice: { mode: 'single', ...ofBeto }, people })).toEqual({ turn: ofBeto, people: null });
    expect(
      planRotationSave({ saved: { turn: ofBeto, order: [] }, recurrence: 'none', choice: { mode: 'single', ...ofNobody }, people }),
    ).toEqual({ turn: ofNobody, people: null });
  });

  it('ignora quem repetiu ou não é mais ficha da casa', () => {
    expect(
      planRotationSave({ recurrence: 'daily', choice: rotation(['p-beto', 'p-apagada', 'p-beto', 'p-lia']), people }),
    ).toEqual({ turn: ofBeto, people: ['p-beto', 'p-lia'] });
  });
});

describe('banco sem o rodízio', () => {
  it('reconhece a tabela ou a função que ainda não existe', () => {
    expect(isRotationUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.chore_rotation' in the schema cache" })).toBe(true);
    expect(
      isRotationUnavailable({ code: 'PGRST202', message: 'Could not find the function public.skip_chore_turn(p_chore_id, p_from) in the schema cache' }),
    ).toBe(true);
    expect(isRotationUnavailable({ code: '42P01', message: 'relation "public.chore_rotation" does not exist' })).toBe(true);
    expect(isRotationUnavailable({ code: '42883', message: 'function public.save_chore_rotation(uuid, uuid[]) does not exist' })).toBe(true);
    // Sem código (erro refeito a partir da mensagem).
    expect(isRotationUnavailable(new Error('relation "public.chore_rotation" does not exist'))).toBe(true);
  });

  it('os outros erros seguem como erros', () => {
    expect(isRotationUnavailable({ code: 'P0002', message: 'chore not found' })).toBe(false);
    expect(isRotationUnavailable({ code: '23514', message: 'only people take part in a chore rotation' })).toBe(false);
    expect(isRotationUnavailable(new TypeError('Network request failed'))).toBe(false);
    expect(isRotationUnavailable(null)).toBe(false);
    expect(isRotationUnavailable('PGRST205')).toBe(false);
  });

  it('o aviso é um só', () => {
    expect(rotationErrorMessage({ code: 'PGRST202', message: 'x' })).toBe(ROTATION_UNAVAILABLE);
    expect(ROTATION_UNAVAILABLE).toBe('O rodízio ainda não está disponível nesta casa. Tente de novo mais tarde.');
    expect(rotationErrorMessage({ code: 'P0002', message: 'chore not found' })).toBeNull();
  });
});
