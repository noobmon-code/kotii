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
