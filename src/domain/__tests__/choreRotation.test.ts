import { describe, expect, it } from '@jest/globals';

import {
  choreTurnLabel,
  completionMessage,
  currentTurn,
  groupRotations,
  hasUnknownPerson,
  isRotationChangedElsewhere,
  isRotationUnavailable,
  kidChores,
  nextTurn,
  numberedOrder,
  orderHasKid,
  planRotationSave,
  plannedTurn,
  ROTATION_CHANGED_ELSEWHERE,
  ROTATION_PERSON_UNKNOWN,
  ROTATION_UNAVAILABLE,
  rotationErrorMessage,
  rotationLabel,
  rotationOf,
  rotationPeople,
  rotationPointsLabel,
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

  it('a vez já tinha passado em outro celular: diz para quem', () => {
    // A linha mostrava a vez de Lia; em outro celular alguém pulou a vez, e os pontos foram para Ana Clara.
    const credited = { completed: true, points: 10, person_id: 'p-ana', next_person_id: 'p-beto' };
    const moved = {
      title: '+10 pontos para Ana Clara!',
      message: 'A vez já tinha passado para Ana Clara. Próxima vez: Beto. O saldo fica em Casa → Tarefas → Pontos das crianças.',
    };
    expect(completionMessage(credited, people, ofLia)).toEqual(moved);
    // A linha mostrava a vez de um morador, ou de ninguém.
    expect(completionMessage(credited, people, ofBeto)).toEqual(moved);
    expect(completionMessage(credited, people, ofNobody)).toEqual(moved);
    // Tarefa que não vale pontos: o aviso é só esse.
    expect(completionMessage({ ...credited, points: 0 }, people, ofLia)).toEqual({
      title: 'A vez já tinha passado para Ana Clara.',
      message: 'Próxima vez: Beto.',
    });
  });

  it('a vez era a que a linha mostrava: o aviso de sempre', () => {
    const credited = { completed: true, points: 10, person_id: 'p-lia', next_person_id: 'p-beto' };
    const usual = { title: '+10 pontos para Lia!', message: 'Próxima vez: Beto. O saldo fica em Casa → Tarefas → Pontos das crianças.' };
    expect(completionMessage(credited, people, ofLia)).toEqual(usual);
    // Sem a linha (quem chama não mostrou a vez), nada a comparar.
    expect(completionMessage(credited, people)).toEqual(usual);
    expect(completionMessage({ ...credited, points: 0 }, people, ofLia)).toEqual({ title: 'Próxima vez: Beto.' });
    // Beto saiu da casa e segue na ordem, sem o app: a linha (de antes) o mostrava como morador. É a mesma pessoa.
    expect(completionMessage({ ...credited, person_id: 'p-beto', next_person_id: 'p-carla' }, people, ofBeto)).toEqual({
      title: '+10 pontos para Beto!',
      message: 'Próxima vez: Carla. O saldo fica em Casa → Tarefas → Pontos das crianças.',
    });
  });

  it('vez de morador não vem na resposta: sem nome, o aviso não diz que ela passou', () => {
    // A linha mostrava Lia e a vez já era de Carla: o servidor só devolve quem ganhou pontos.
    expect(completionMessage({ completed: true, points: 0, person_id: null, next_person_id: 'p-lia' }, people, ofLia)).toEqual({
      title: 'Próxima vez: Lia.',
    });
  });

  it('fora de rodízio não há vez: a tarefa que trocou de criança em outro celular só comemora', () => {
    expect(completionMessage({ completed: true, points: 5, person_id: 'p-ana', next_person_id: null }, people, ofLia)).toEqual({
      title: '+5 pontos para Ana Clara!',
      message: 'O saldo fica em Casa → Tarefas → Pontos das crianças.',
    });
    // Banco de antes do rodízio: a resposta nem traz next_person_id.
    expect(completionMessage({ completed: true, points: 5, person_id: 'p-ana' }, people, ofLia)?.message).toBe(
      'O saldo fica em Casa → Tarefas → Pontos das crianças.',
    );
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

  it('sabe se a ordem tem alguém que este aparelho não conhece', () => {
    expect(hasUnknownPerson(order, people)).toBe(false);
    expect(hasUnknownPerson([], people)).toBe(false);
    // Ficha criada em outro celular, que a lista deste ainda não trouxe (ou apagada lá, e a ordem daqui é a de antes).
    expect(hasUnknownPerson(['p-beto', 'p-nova', 'p-lia'], people)).toBe(true);
    // O morador cuja ficha chegou, mas que a lista de moradores deste aparelho ainda não tem.
    expect(hasUnknownPerson(order, rotationPeople([members[0]], records))).toBe(true);
    expect(ROTATION_PERSON_UNKNOWN).toBe('O rodízio dela tem alguém que este aparelho ainda não carregou. Feche e abra de novo para editar.');
  });

  it('sabe se alguém da ordem ganha pontos', () => {
    expect(orderHasKid(['p-beto', 'p-carla'], people)).toBe(false);
    expect(orderHasKid(order, people)).toBe(true);
  });

  it('diz de quem são os pontos: de quem não tem o app, pelo nome', () => {
    // Marcos é adulto e não tem o app: "a criança da vez" não serviria para ele.
    const house = rotationPeople(members, [
      ...records,
      { id: 'p-marcos', name: 'Marcos', kind: 'pessoa', member_user_id: null },
      { id: 'p-nina', name: 'Nina', kind: 'pessoa', member_user_id: null },
    ]);
    expect(rotationPointsLabel(['p-beto', 'p-lia'], house)).toBe('pontos quando for a vez de Lia');
    expect(rotationPointsLabel(['p-lia', 'p-beto', 'p-marcos'], house)).toBe('pontos quando for a vez de Lia ou Marcos');
    expect(rotationPointsLabel(['p-lia', 'p-marcos', 'p-carla', 'p-nina'], house)).toBe('pontos quando for a vez de Lia, Marcos ou Nina');
    // Na ordem do rodízio, e com nome de duas palavras.
    expect(rotationPointsLabel(['p-nina', 'p-ana', 'p-lia', 'p-marcos'], house)).toBe(
      'pontos quando for a vez de Nina, Ana Clara, Lia ou Marcos',
    );
  });

  it('todos na ordem têm o app: ninguém ganha pontos, nada a dizer', () => {
    expect(rotationPointsLabel(['p-beto', 'p-carla'], people)).toBeNull();
    expect(rotationPointsLabel([], people)).toBeNull();
    // Quem não é mais ficha da casa (ou virou pet) não conta.
    expect(rotationPointsLabel(['p-beto', 'p-apagada', 'p-rex'], people)).toBeNull();
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

  it('formulário aberto sem rodízio nunca encerra um: a ordem que vale é a que ele mostrou', () => {
    // Outro celular criou o rodízio depois: `saved.order` segue vazia, e a escolha de uma pessoa só não manda [].
    const shown = { turn: ofBeto, order: [] };
    expect(planRotationSave({ saved: shown, recurrence: 'daily', choice: { mode: 'single', ...ofBeto }, people })).toEqual({
      turn: ofBeto,
      people: null,
    });
    expect(planRotationSave({ saved: shown, recurrence: 'none', choice: rotation(order), people })).toEqual({ turn: ofBeto, people: null });
    // Já o que abriu mostrando o rodízio encerra (a pessoa viu o que desfez) e, mantendo, não mexe na vez.
    const shownRotation = { turn: ofBeto, order };
    expect(planRotationSave({ saved: shownRotation, recurrence: 'daily', choice: { mode: 'single', ...ofBeto }, people })).toEqual({
      turn: ofBeto,
      people: [],
    });
    expect(planRotationSave({ saved: shownRotation, recurrence: 'daily', choice: rotation(order), people })).toEqual({ people: order });
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

describe('pontos das crianças: as tarefas de cada criança', () => {
  const today = '2026-10-12';
  const chore = (id: string, turn: { assigned_to: string | null; kid_id: string | null }, over: { points?: number; due_on?: string } = {}) => ({
    id,
    points: 10,
    due_on: today,
    ...turn,
    ...over,
  });
  const rotations = { lixo: ['p-beto', 'p-lia'], louca: ['p-beto', 'p-carla'], quarto: ['p-ana', 'p-lia', 'p-carla'] };
  const subtitles = (kidId: string, chores: ReturnType<typeof chore>[], orders: Record<string, string[]> = rotations) =>
    kidChores(kidId, chores, orders, people, today).map((row) => `${row.chore.id}: ${row.subtitle}`);

  it('tarefa só da criança: os pontos e a data, como sempre', () => {
    expect(subtitles('p-lia', [chore('cama', ofLia), chore('mochila', ofLia, { points: 1, due_on: '2026-10-20' })])).toEqual([
      'cama: 10 pontos · para hoje',
      'mochila: 1 ponto · próxima 20 out',
    ]);
    // Atrasada também é para hoje; a de outro ano leva o ano.
    expect(subtitles('p-lia', [chore('cama', ofLia, { due_on: '2026-10-01' }), chore('férias', ofLia, { due_on: '2027-01-05' })])).toEqual([
      'cama: 10 pontos · para hoje',
      'férias: 10 pontos · próxima 5 jan 2027',
    ]);
  });

  it('rodízio na vez da criança: diz que ela está na vez', () => {
    expect(subtitles('p-lia', [chore('lixo', ofLia)])).toEqual(['lixo: 10 pontos · na vez · para hoje']);
    expect(subtitles('p-lia', [chore('lixo', ofLia, { due_on: '2026-10-15' })])).toEqual(['lixo: 10 pontos · na vez · próxima 15 out']);
  });

  it('rodízio na vez de outra pessoa: a tarefa continua no cartão, com de quem é a vez', () => {
    expect(subtitles('p-lia', [chore('lixo', ofBeto)])).toEqual(['lixo: 10 pontos · vez de Beto']);
    // Vez de outra criança, com nome de duas palavras.
    expect(subtitles('p-lia', [chore('quarto', { assigned_to: null, kid_id: 'p-ana' })])).toEqual(['quarto: 10 pontos · vez de Ana Clara']);
    expect(subtitles('p-ana', [chore('quarto', { assigned_to: null, kid_id: 'p-ana' })])).toEqual(['quarto: 10 pontos · na vez · para hoje']);
    // Ninguém na vez (a tarefa ficou de "Qualquer um"): só que é um rodízio.
    expect(subtitles('p-lia', [chore('lixo', ofNobody)])).toEqual(['lixo: 10 pontos · em rodízio']);
  });

  it('só entram as tarefas dela e os rodízios em que ela está, na ordem em que vieram', () => {
    const chores = [chore('louca', ofBeto), chore('lixo', ofBeto), chore('cama', ofLia), chore('quarto', ofCarla), chore('livro', { assigned_to: null, kid_id: 'p-ana' })];
    expect(subtitles('p-lia', chores)).toEqual(['lixo: 10 pontos · vez de Beto', 'cama: 10 pontos · para hoje', 'quarto: 10 pontos · vez de Carla']);
    expect(subtitles('p-ana', chores)).toEqual(['quarto: 10 pontos · vez de Carla', 'livro: 10 pontos · para hoje']);
    // Criança sem tarefa nem rodízio: nada (aí a tela sugere escolher a criança como responsável).
    expect(subtitles('p-ana', [chore('louca', ofBeto), chore('lixo', ofLia)])).toEqual([]);
  });

  it('sem as ordens (não carregaram, ou o banco ainda não tem o rodízio): só as tarefas dela', () => {
    const chores = [chore('lixo', ofBeto), chore('cama', ofLia), chore('quarto', ofLia)];
    expect(kidChores('p-lia', chores, undefined, people, today).map((row) => row.subtitle)).toEqual(['10 pontos · para hoje', '10 pontos · para hoje']);
    expect(subtitles('p-lia', chores, {})).toEqual(['cama: 10 pontos · para hoje', 'quarto: 10 pontos · para hoje']);
  });

  it('ordem que não é rodízio (sobrou uma pessoa só) não põe a tarefa no cartão', () => {
    expect(subtitles('p-lia', [chore('lixo', ofBeto)], { lixo: ['p-lia'] })).toEqual([]);
    expect(subtitles('p-lia', [chore('lixo', ofBeto)], { lixo: ['p-lia', 'p-apagada'] })).toEqual([]);
    // A tarefa é dela, e a ordem (de um app antigo) nem a inclui: é só dela.
    expect(subtitles('p-lia', [chore('louca', ofLia)])).toEqual(['louca: 10 pontos · para hoje']);
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
    // A função que grava o responsável da tarefa sem rodízio chega na mesma migração.
    expect(
      isRotationUnavailable({
        code: 'PGRST202',
        message: 'Could not find the function public.save_chore_single(p_assigned_to, p_chore_id, p_kid_id, p_points) in the schema cache',
      }),
    ).toBe(true);
    expect(isRotationUnavailable(new Error('function public.save_chore_single(uuid, uuid, uuid, integer) does not exist'))).toBe(true);
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

describe('o banco recusa o responsável da tarefa que ganhou um rodízio', () => {
  it('reconhece a recusa de save_chore_single pelo código', () => {
    expect(isRotationChangedElsewhere({ code: 'NK006', message: 'chore has a rotation', details: null, hint: null })).toBe(true);
    // O aviso é o da conferência feita antes de gravar: para a pessoa, é a mesma situação.
    expect(ROTATION_CHANGED_ELSEWHERE).toBe('Ela ganhou um rodízio em outro aparelho. Feche e abra de novo para editar.');
  });

  it('os outros erros seguem como erros', () => {
    expect(isRotationChangedElsewhere({ code: 'P0002', message: 'chore not found' })).toBe(false);
    // Banco ainda sem a função: aí a tarefa é gravada direto, não é uma recusa.
    expect(isRotationChangedElsewhere({ code: 'PGRST202', message: 'Could not find the function public.save_chore_single' })).toBe(false);
    expect(isRotationChangedElsewhere({ code: '23503', message: 'insert or update on table "chores" violates foreign key constraint' })).toBe(false);
    expect(isRotationChangedElsewhere(new TypeError('Network request failed'))).toBe(false);
    expect(isRotationChangedElsewhere(new Error('chore has a rotation'))).toBe(false);
    expect(isRotationChangedElsewhere(null)).toBe(false);
    expect(isRotationChangedElsewhere('NK006')).toBe(false);
  });
});
