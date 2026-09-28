import { describe, expect, it, jest } from '@jest/globals';

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
        SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
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

  const medication = (start_on: string, end_on: string | null) => ({
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
  });

  it('does not ring before a future start and keeps doses inside the treatment', async () => {
    await withScheduler(async (reminders, scheduled) => {
      expect(await reminders.enableReminders(medication('2026-09-28', '2026-09-29'), '2026-09-26')).toBe(true);
      expect(scheduled.map((r) => r.trigger.type)).toEqual(['date', 'date', 'date', 'date']);
      // Mesmo plano: nada é reagendado.
      await reminders.enableReminders(medication('2026-09-28', '2026-09-29'), '2026-09-26');
      expect(scheduled).toHaveLength(4);
    });
  });

  it('does not double-schedule when syncs overlap', async () => {
    await withScheduler(async (reminders, scheduled) => {
      await reminders.enableReminders(medication('2026-09-01', null), '2026-09-26');
      const changed = { ...medication('2026-09-01', null), times: ['09:00'] };
      await Promise.all([
        reminders.syncReminders([changed], '2026-09-26'),
        reminders.syncReminders([changed], '2026-09-26'),
      ]);
      // 2 do primeiro agendamento + 1 do novo horário, uma vez só.
      expect(scheduled).toHaveLength(3);
    });
  });

  it('uses daily repeats for ongoing treatments and drops ended ones on sync', async () => {
    await withScheduler(async (reminders, scheduled, storage) => {
      await reminders.enableReminders(medication('2026-09-01', null), '2026-09-26');
      expect(scheduled.map((r) => r.trigger.type)).toEqual(['daily', 'daily']);
      await reminders.syncReminders([medication('2026-09-01', '2026-09-20')], '2026-09-26');
      expect(storage.size).toBe(0);
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
      expect(await reminders.getHouseReminderKinds()).toEqual({ bills: true, documents: true, chores: false });
    });
  });

  it('desligar um tipo cancela só os avisos dele, mesmo sem os dados da casa', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('bills', true);
      await reminders.setHouseReminderKind('documents', true);
      await reminders.syncHouseReminders(data, today);
      expect(kindsOf(live)).toEqual(['bills', 'documents']);
      await reminders.setHouseReminderKind('bills', false);
      expect(kindsOf(live)).toEqual(['documents']);
    });
  });

  it('conta atrasada: o aviso toca uma vez e não volta nos dias seguintes', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('bills', true);
      const late = { ...data, bills: [{ ...data.bills[0], next_due_on: '2026-09-20' }] };
      await reminders.syncHouseReminders(late, '2026-09-27', '10:00');
      expect([...live.values()].map((r) => r.content.data.reminder)).toEqual(['bills:b1:2026-09-28']);
      // Dia 28 às 9h o aviso toca (sai da agenda); ao abrir o app de novo, nada de novo.
      live.clear();
      await reminders.syncHouseReminders(late, '2026-09-28', '12:00');
      await reminders.syncHouseReminders(late, '2026-09-29', '12:00');
      expect(live.size).toBe(0);
      // Paga e atrasada de novo no mês seguinte: avisa de novo.
      await reminders.syncHouseReminders({ ...data, bills: [{ ...data.bills[0], next_due_on: '2026-09-25' }] }, '2026-09-29', '12:00');
      expect([...live.values()].map((r) => r.content.data.reminder)).toEqual(['bills:b1:2026-09-30']);
    });
  });

  it('desligar e religar as contas não repete um aviso de atraso que já tocou', async () => {
    await withHouse(async (reminders, { live }) => {
      await reminders.setHouseReminderKind('bills', true);
      const late = { ...data, bills: [{ ...data.bills[0], next_due_on: '2020-01-10' }] };
      // Aviso marcado para as 9h de um dia que já passou: é como se já tivesse tocado.
      await reminders.syncHouseReminders(late, '2020-01-12', '08:00');
      expect(live.size).toBe(1);
      live.clear();
      await reminders.setHouseReminderKind('bills', false);
      await reminders.setHouseReminderKind('bills', true);
      await reminders.syncHouseReminders(late, '2020-01-13', '12:00');
      expect(live.size).toBe(0);
    });
  });

  it('fica com o espaço que os remédios deixam no teto do iPhone', async () => {
    await withHouse(async (reminders, { live }) => {
      for (let i = 0; i < 62; i++) live.set(`remedio${i}`, { content: { data: { reminder: `med:${i}` } } });
      await reminders.setHouseReminderKind('bills', true);
      await reminders.setHouseReminderKind('documents', true);
      await reminders.syncHouseReminders(data, today);
      expect(live.size).toBe(64);
    });
  });
});
