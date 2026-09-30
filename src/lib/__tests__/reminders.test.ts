import { describe, expect, it, jest } from '@jest/globals';

import type { Medication } from '../types';

type Reminders = typeof import('../reminders');

// Roda `scenario` num ambiente simulado: sistema, Expo Go ou não, e um
// expo-notifications que lança erro ao ser carregado no Expo Go do Android
// (comportamento real desde o SDK 53).
function inEnvironment(
  { os, expoGo }: { os: 'android' | 'ios'; expoGo: boolean },
  scenario: (reminders: Reminders, probe: { loaded: () => boolean; handler: jest.Mock }) => void,
) {
  const handler = jest.fn();
  let loaded = false;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    jest.doMock('expo', () => ({ isRunningInExpoGo: () => expoGo }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({}));
    jest.doMock('expo-notifications', () => {
      loaded = true;
      if (os === 'android' && expoGo) throw new Error('removed from Expo Go');
      return { setNotificationHandler: handler };
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    scenario(require('../reminders'), { loaded: () => loaded, handler });
  });
}

describe('reminders', () => {
  it('does not load expo-notifications in Expo Go on Android', () => {
    inEnvironment({ os: 'android', expoGo: true }, (reminders, probe) => {
      expect(reminders.remindersSupported).toBe(false);
      expect(() => reminders.configureNotifications()).not.toThrow();
      expect(probe.loaded()).toBe(false);
    });
  });

  it('loads it lazily where notifications work', () => {
    for (const env of [
      { os: 'android' as const, expoGo: false },
      { os: 'ios' as const, expoGo: true },
    ]) {
      inEnvironment(env, (reminders, probe) => {
        expect(reminders.remindersSupported).toBe(true);
        expect(probe.loaded()).toBe(false);
        reminders.configureNotifications();
        expect(probe.handler).toHaveBeenCalledTimes(1);
      });
    }
  });
});

describe('reminder scheduling', () => {
  // expo-notifications e AsyncStorage em memória, no iOS.
  async function withScheduler(scenario: (reminders: Reminders, scheduled: { trigger: { type: string } }[], storage: Map<string, string>) => Promise<void>) {
    const scheduled: { trigger: { type: string } }[] = [];
    const storage = new Map<string, string>();
    await jest.isolateModulesAsync(async () => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      jest.doMock('expo', () => ({ isRunningInExpoGo: () => false }));
      jest.doMock('@react-native-async-storage/async-storage', () => ({
        getItem: async (k: string) => storage.get(k) ?? null,
        setItem: async (k: string, v: string) => void storage.set(k, v),
        removeItem: async (k: string) => void storage.delete(k),
        getAllKeys: async () => [...storage.keys()],
      }));
      jest.doMock('expo-notifications', () => ({
        SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', DATE: 'date' },
        AndroidImportance: { HIGH: 4 },
        getPermissionsAsync: async () => ({ granted: true }),
        scheduleNotificationAsync: async (request: { trigger: { type: string } }) => {
          scheduled.push(request);
          return `n${scheduled.length}`;
        },
        cancelScheduledNotificationAsync: async () => undefined,
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await scenario(require('../reminders'), scheduled, storage);
    });
  }

  const medication = (start_on: string, end_on: string | null): Medication => ({
    id: 'm1',
    person_id: null,
    person_name: 'Ana',
    name: 'Amoxicilina',
    dosage: '5 ml',
    times: ['08:00', '20:00'],
    start_on,
    end_on,
    notes: null,
    active: true,
    frequency: 'daily',
    weekdays: null,
    interval_days: null,
    total_doses: null,
    taken_count: 0,
  });

  it('repeats weekly on the chosen weekdays (1 = domingo no expo-notifications)', async () => {
    await withScheduler(async (reminders, scheduled) => {
      await reminders.enableReminders({ ...medication('2026-09-01', null), frequency: 'weekdays', weekdays: [0, 3], times: ['09:00'] }, { householdId: 'casa' }, '2026-09-26');
      expect(scheduled.map((r) => r.trigger)).toEqual([
        { type: 'weekly', weekday: 1, hour: 9, minute: 0, channelId: 'remedios' },
        { type: 'weekly', weekday: 4, hour: 9, minute: 0, channelId: 'remedios' },
      ]);
    });
  });

  it('does not ring before a future start and keeps doses inside the treatment', async () => {
    await withScheduler(async (reminders, scheduled) => {
      expect(await reminders.enableReminders(medication('2026-09-28', '2026-09-29'), { householdId: 'casa' }, '2026-09-26')).toBe(true);
      expect(scheduled.map((r) => r.trigger.type)).toEqual(['date', 'date', 'date', 'date']);
      // Mesmo plano: nada é reagendado.
      await reminders.enableReminders(medication('2026-09-28', '2026-09-29'), { householdId: 'casa' }, '2026-09-26');
      expect(scheduled).toHaveLength(4);
    });
  });

  it('does not double-schedule when syncs overlap', async () => {
    await withScheduler(async (reminders, scheduled) => {
      await reminders.enableReminders(medication('2026-09-01', null), { householdId: 'casa' }, '2026-09-26');
      const changed = { ...medication('2026-09-01', null), times: ['09:00'] };
      await Promise.all([
        reminders.syncReminders([changed], '2026-09-26', { householdId: 'casa' }),
        reminders.syncReminders([changed], '2026-09-26', { householdId: 'casa' }),
      ]);
      // 2 do primeiro agendamento + 1 do novo horário, uma vez só.
      expect(scheduled).toHaveLength(3);
    });
  });

  it('uses daily repeats for ongoing treatments and drops ended ones on sync', async () => {
    await withScheduler(async (reminders, scheduled, storage) => {
      await reminders.enableReminders(medication('2026-09-01', null), { householdId: 'casa' }, '2026-09-26');
      expect(scheduled.map((r) => r.trigger.type)).toEqual(['daily', 'daily']);
      await reminders.syncReminders([medication('2026-09-01', '2026-09-20')], '2026-09-26', { householdId: 'casa' });
      expect(storage.size).toBe(0);
    });
  });
  it('com várias casas, cada sincronização mexe só nos remédios da sua casa', async () => {
    await withScheduler(async (reminders, _scheduled, storage) => {
      await reminders.enableReminders(medication('2026-09-01', null), { householdId: 'casa' }, '2026-09-26');
      await reminders.enableReminders({ ...medication('2026-09-01', null), id: 'm2' }, { householdId: 'praia' }, '2026-09-26');
      // A casa aberta não tem o remédio da praia: o dela fica.
      await reminders.syncReminders([medication('2026-09-01', null)], '2026-09-26', { householdId: 'casa' });
      expect([...storage.keys()].sort()).toEqual(['reminders:m1', 'reminders:m2']);
      // Saiu da praia: só os dela saem.
      await reminders.disableHouseholdReminders('praia');
      expect([...storage.keys()]).toEqual(['reminders:m1']);
    });
  });

  it('com mais de uma casa, o aviso do remédio diz de qual casa é', async () => {
    await withScheduler(async (reminders, scheduled) => {
      await reminders.enableReminders(medication('2026-09-01', null), { householdId: 'praia' }, '2026-09-26');
      await reminders.syncReminders([medication('2026-09-01', null)], '2026-09-26', { householdId: 'praia', label: 'Casa da praia' });
      const titles = (scheduled as unknown as { content: { title: string } }[]).map((r) => r.content.title);
      // Sem o nome e depois refeito com o nome da casa.
      expect(titles).toEqual([
        'Amoxicilina — Ana',
        'Amoxicilina — Ana',
        'Amoxicilina — Ana · Casa da praia',
        'Amoxicilina — Ana · Casa da praia',
      ]);
    });
  });

  it('lembrete de antes das várias casas fica com a casa aberta', async () => {
    await withScheduler(async (reminders, _scheduled, storage) => {
      storage.set('reminders:m1', JSON.stringify({ ids: ['x'], signature: '' }));
      await reminders.syncReminders([], '2026-09-26', { householdId: 'praia' });
      expect(storage.has('reminders:m1')).toBe(true);
      await reminders.syncReminders([medication('2026-09-01', null)], '2026-09-26', { householdId: 'casa', adoptLegacy: true });
      expect(JSON.parse(storage.get('reminders:m1')!).householdId).toBe('casa');
    });
  });
});

describe('house reminders', () => {
  // Agenda em memória que sabe cancelar e listar, como o expo-notifications.
  async function withHouse(
    scenario: (reminders: Reminders, agenda: { live: Map<string, { content: { data: { reminder: string } } }>; storage: Map<string, string> }) => Promise<void>,
  ) {
    const live = new Map<string, { content: { data: { reminder: string } } }>();
    const storage = new Map<string, string>();
    let next = 0;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
      jest.doMock('expo', () => ({ isRunningInExpoGo: () => false }));
      jest.doMock('@react-native-async-storage/async-storage', () => ({
        getItem: async (k: string) => storage.get(k) ?? null,
        setItem: async (k: string, v: string) => void storage.set(k, v),
        removeItem: async (k: string) => void storage.delete(k),
        getAllKeys: async () => [...storage.keys()],
      }));
      jest.doMock('expo-notifications', () => ({
        SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
        AndroidImportance: { HIGH: 4 },
        getPermissionsAsync: async () => ({ granted: true }),
        scheduleNotificationAsync: async (request: { content: { data: { reminder: string } } }) => {
          const id = `n${++next}`;
          live.set(id, request);
          return id;
        },
        cancelScheduledNotificationAsync: async (id: string) => void live.delete(id),
        getAllScheduledNotificationsAsync: async () => [...live.keys()].map((identifier) => ({ identifier })),
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await scenario(require('../reminders'), { live, storage });
    });
  }

  const today = '2026-09-27';
  const data = {
    bills: [{ id: 'b1', name: 'Luz', amount: 230, next_due_on: '2026-10-05', active: true, autopay: false }],
    documents: [{ id: 'd1', title: 'Passaporte', expires_on: '2026-10-20', remind_days: 15 }],
    chores: [],
  };
  const kindsOf = (live: Map<string, { content: { data: { reminder: string } } }>) =>
    [...new Set([...live.values()].map((r) => r.content.data.reminder.split(':')[0]))].sort();

  it('dois toques seguidos não gravam um por cima do outro', async () => {
    await withHouse(async (reminders) => {
      await Promise.all([reminders.setHouseReminderKind('bills', true), reminders.setHouseReminderKind('documents', true)]);
      expect(await reminders.getHouseReminderKinds()).toEqual({
        bills: true,
        documents: true,
        chores: false,
        appointments: false,
        vaccines: false,
        weather: false,
      });
    });
  });

  it('desligar um tipo cancela só os avisos dele, mesmo sem os dados da casa', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('bills', true);
      await reminders.setHouseReminderKind('documents', true);
      await reminders.syncHouseReminders(data, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual(['bills', 'documents']);
      await reminders.setHouseReminderKind('bills', false);
      expect(kindsOf(live)).toEqual(['documents']);
    });
  });

  it('conta atrasada: o aviso toca uma vez e não volta nos dias seguintes', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('bills', true);
      const late = { ...data, bills: [{ ...data.bills[0], next_due_on: '2026-09-20' }] };
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2026-09-27', nowTime: '10:00' });
      expect([...live.values()].map((r) => r.content.data.reminder)).toEqual(['bills:b1:2026-09-28']);
      // Dia 28 às 9h o aviso toca (sai da agenda); ao abrir o app de novo, nada de novo.
      live.clear();
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2026-09-28', nowTime: '12:00' });
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2026-09-29', nowTime: '12:00' });
      expect(live.size).toBe(0);
      // Paga e atrasada de novo no mês seguinte: avisa de novo.
      await reminders.syncHouseReminders({ ...data, bills: [{ ...data.bills[0], next_due_on: '2026-09-25' }] }, { householdId: 'casa', today: '2026-09-29', nowTime: '12:00' });
      expect([...live.values()].map((r) => r.content.data.reminder)).toEqual(['bills:b1:2026-09-30']);
    });
  });

  it('desligar e religar as contas não repete um aviso de atraso que já tocou', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('bills', true);
      const late = { ...data, bills: [{ ...data.bills[0], next_due_on: '2020-01-10' }] };
      // Aviso marcado para as 9h de um dia que já passou: é como se já tivesse tocado.
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2020-01-12', nowTime: '08:00' });
      expect(live.size).toBe(1);
      live.clear();
      await reminders.setHouseReminderKind('bills', false);
      await reminders.setHouseReminderKind('bills', true);
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2020-01-13', nowTime: '12:00' });
      expect(live.size).toBe(0);
    });
  });

  it('desligar as vacinas antes do aviso de atraso tocar não o dá como tocado', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('vaccines', true);
      const late = { ...data, vaccines: [{ id: 'v1', name: 'Tríplice viral', dose: null, person: 'Lia', next_dose_on: '2099-01-01' }] };
      // Aviso de atraso marcado para as 9h de um dia que ainda não chegou.
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2099-01-12', nowTime: '08:00' });
      expect([...live.values()].map((r) => r.content.data.reminder)).toEqual(['vaccines:v1:2099-01-12']);
      await reminders.setHouseReminderKind('vaccines', false);
      expect(live.size).toBe(0);
      await reminders.setHouseReminderKind('vaccines', true);
      // Religado depois das 9h: o aviso cancelado não conta como tocado e volta no próximo horário.
      await reminders.syncHouseReminders(late, { householdId: 'casa', today: '2099-01-12', nowTime: '10:00' });
      expect([...live.values()].map((r) => r.content.data.reminder)).toEqual(['vaccines:v1:2099-01-13']);
    });
  });

  it('sem os dados de saúde, contas seguem e os avisos de vacina já agendados ficam', async () => {
    await withHouse(async (reminders, { live, storage }) => {
      await reminders.setHouseReminderKind('bills', true);
      await reminders.setHouseReminderKind('vaccines', true);
      const vaccines = [{ id: 'v1', name: 'Tríplice viral', dose: null, person: 'Lia', next_dose_on: '2026-10-20' }];
      await reminders.syncHouseReminders({ ...data, vaccines, appointments: [] }, { householdId: 'casa', today });
      const vaccineIds = [...live.entries()].filter(([, r]) => r.content.data.reminder.startsWith('vaccines:')).map(([id]) => id);
      expect(vaccineIds).toHaveLength(2);
      // Vacinas não carregaram; a conta mudou de vencimento.
      const moved = { ...data, bills: [{ ...data.bills[0], next_due_on: '2026-10-10' }] };
      await reminders.syncHouseReminders(moved, { householdId: 'casa', today });
      expect(vaccineIds.every((id) => live.has(id))).toBe(true);
      expect([...live.values()].map((r) => r.content.data.reminder).filter((k) => k.startsWith('bills:')).sort()).toEqual([
        'bills:b1:2026-10-09',
        'bills:b1:2026-10-10',
      ]);
      // Aviso de vacina que já tocou (saiu da agenda) não ocupa vaga nem volta para a lista.
      live.delete(vaccineIds[0]);
      await reminders.syncHouseReminders({ ...moved, bills: [{ ...data.bills[0], next_due_on: '2026-10-12' }] }, { householdId: 'casa', today });
      expect(live.has(vaccineIds[1])).toBe(true);
      const stored = JSON.parse(storage.get('house-reminders:scheduled:casa')!) as { ids: string[] };
      expect(stored.ids).not.toContain(vaccineIds[0]);
      expect(stored.ids).toContain(vaccineIds[1]);
      // O outro também toca e nada mais muda: sai da lista guardada mesmo sem refazer os avisos.
      live.delete(vaccineIds[1]);
      await reminders.syncHouseReminders({ ...moved, bills: [{ ...data.bills[0], next_due_on: '2026-10-12' }] }, { householdId: 'casa', today });
      const after = JSON.parse(storage.get('house-reminders:scheduled:casa')!) as { ids: string[]; kinds: string[] };
      expect(after.ids).not.toContain(vaccineIds[1]);
      expect(after.kinds).not.toContain('vaccines');
      // Voltaram: refaz tudo com os dados.
      await reminders.syncHouseReminders({ ...moved, vaccines: [], appointments: [] }, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual(['bills']);
    });
  });

  it('dica do clima às 7h; sem a previsão (sem internet), a já agendada fica', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('weather', true);
      const weather = [{ date: '2026-09-28', time: '07:00', title: 'Hoje é dia de lavar roupa', body: 'Sem chuva até o fim da tarde.' }];
      await reminders.syncHouseReminders({ ...data, weather }, { householdId: 'casa', today });
      const [id] = [...live.entries()].filter(([, r]) => r.content.data.reminder.startsWith('weather:')).map(([key]) => key);
      expect(live.get(id)?.content.data.reminder).toBe('weather:dia:2026-09-28:07:00');
      await reminders.syncHouseReminders(data, { householdId: 'casa', today });
      expect(live.has(id)).toBe(true);
      // Casa sem local definido: nada do clima.
      await reminders.syncHouseReminders({ ...data, weather: [] }, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual([]);
    });
  });

  it('a casa mudou de local e a previsão nova não veio: os avisos do clima do lugar antigo saem', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('weather', true);
      const weather = [{ date: '2026-09-28', time: '07:00', title: 'Hoje é dia de lavar roupa', body: 'Sem chuva até o fim da tarde.' }];
      await reminders.syncHouseReminders({ ...data, weather, weatherPlace: '-23.56,-46.69' }, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual(['weather']);
      // Mesmo lugar, previsão sem carregar: fica.
      await reminders.syncHouseReminders({ ...data, weatherPlace: '-23.56,-46.69' }, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual(['weather']);
      // Outro lugar, previsão sem carregar: sai.
      await reminders.syncHouseReminders({ ...data, weatherPlace: '-15.82,-47.9' }, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual([]);
      // A previsão do lugar novo chega: agenda de novo.
      await reminders.syncHouseReminders({ ...data, weather, weatherPlace: '-15.82,-47.9' }, { householdId: 'casa', today });
      expect(kindsOf(live)).toEqual(['weather']);
    });
  });

  it('várias casas: avisos separados, com o nome da casa; sair ou deixar de ser membro tira só os dela', async () => {
    await withHouse(async (reminders, { live, storage }) => {
      await reminders.setHouseReminderKind('bills', true);
      await reminders.syncHouseReminders(data, { householdId: 'casa', label: 'Casa', today });
      const praia = { ...data, bills: [{ ...data.bills[0], id: 'b2', name: 'Água' }] };
      await reminders.syncHouseReminders(praia, { householdId: 'praia', label: 'Praia', today });
      const titles = () => [...live.values()].map((r) => (r as unknown as { content: { title: string } }).content.title).sort();
      expect(titles()).toEqual(['Conta vence amanhã · Casa', 'Conta vence amanhã · Praia', 'Conta vence hoje · Casa', 'Conta vence hoje · Praia']);
      // Refazer a casa não mexe nos da praia.
      await reminders.syncHouseReminders(data, { householdId: 'casa', label: 'Casa', today });
      expect(live.size).toBe(4);
      // Desligar o tipo vale para todas.
      await reminders.setHouseReminderKind('bills', false);
      expect(live.size).toBe(0);
      await reminders.setHouseReminderKind('bills', true);
      await reminders.syncHouseReminders(data, { householdId: 'casa', today });
      await reminders.syncHouseReminders(praia, { householdId: 'praia', today });
      await reminders.pruneHouseholdReminders(['casa']);
      expect(live.size).toBe(2);
      expect(storage.has('house-reminders:scheduled:praia')).toBe(false);
    });
  });

  it('os avisos de antes das várias casas passam para a casa aberta', async () => {
    await withHouse(async (reminders, { live, storage }) => {
      await reminders.setHouseReminderKind('bills', true);
      await reminders.syncHouseReminders(data, { householdId: 'casa', today });
      storage.set('house-reminders:scheduled', storage.get('house-reminders:scheduled:casa')!);
      storage.delete('house-reminders:scheduled:casa');
      await reminders.syncHouseReminders(data, { householdId: 'casa', adoptLegacy: true, today });
      expect(live.size).toBe(2);
      expect(storage.has('house-reminders:scheduled')).toBe(false);
      expect(storage.has('house-reminders:scheduled:casa')).toBe(true);
    });
  });

  it('fica com o espaço que os remédios deixam no teto do iPhone', async () => {
    await withHouse(async (reminders, { live }) => {
      for (let i = 0; i < 62; i++) live.set(`remedio${i}`, { content: { data: { reminder: `med:${i}` } } });
      await reminders.setHouseReminderKind('bills', true);
      await reminders.setHouseReminderKind('documents', true);
      await reminders.syncHouseReminders(data, { householdId: 'casa', today });
      expect(live.size).toBe(64);
    });
  });
});
