import { describe, expect, it } from '@jest/globals';

import { choreAssigneeLabel } from '../chores';
import { earnedThisWeek, kidsOf, pointsHistory } from '../points';

describe('pontos das crianças', () => {
  it('só fichas de pessoas sem conta ganham pontos', () => {
    const people = [
      { id: 'ana', kind: 'pessoa', member_user_id: 'u1' },
      { id: 'lia', kind: 'pessoa', member_user_id: null },
      { id: 'rex', kind: 'pet', member_user_id: null },
    ];
    expect(kidsOf(people).map((p) => p.id)).toEqual(['lia']);
  });

  it('junta tarefas feitas e prêmios, do mais recente ao mais antigo', () => {
    const events = pointsHistory(
      [
        { id: 'c1', points: 10, completed_at: '2026-09-20T10:00:00', title: 'Arrumar a cama' },
        { id: 'c2', points: 0, completed_at: '2026-09-21T10:00:00', title: 'Sem pontos' },
        { id: 'c3', points: 20, completed_at: '2026-09-27T09:00:00', title: 'Guardar os brinquedos' },
      ],
      [{ id: 'r1', points: 15, created_at: '2026-09-25T18:00:00', title: 'Sorvete' }],
    );
    expect(events.map((e) => [e.title, e.points])).toEqual([
      ['Guardar os brinquedos', 20],
      ['Sorvete', -15],
      ['Arrumar a cama', 10],
    ]);
    expect(earnedThisWeek(events, '2026-09-27')).toBe(20);
    expect(earnedThisWeek(events, '2026-10-03')).toBe(20); // 27/9 ainda entra
    expect(earnedThisWeek(events, '2026-10-04')).toBe(0);
  });
});

describe('choreAssigneeLabel', () => {
  const members = [{ user_id: 'u1', display_name: 'Ana' }];
  const people = [{ id: 'lia', name: 'Lia' }];

  it('mostra a criança com os pontos, ou o morador', () => {
    expect(choreAssigneeLabel({ assigned_to: null, kid_id: 'lia', points: 10 }, members, people)).toBe('Lia · 10 pontos');
    expect(choreAssigneeLabel({ assigned_to: null, kid_id: 'lia', points: 1 }, members, people)).toBe('Lia · 1 ponto');
    expect(choreAssigneeLabel({ assigned_to: null, kid_id: 'lia', points: 0 }, members, people)).toBe('Lia');
    expect(choreAssigneeLabel({ assigned_to: 'u1', kid_id: null, points: 0 }, members, people)).toBe('Ana');
    expect(choreAssigneeLabel({ assigned_to: null, kid_id: null, points: 0 }, members, people)).toBeNull();
  });
});
