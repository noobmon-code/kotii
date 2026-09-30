import { afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchWithHousehold,
  forgetActiveHousehold,
  getActiveHousehold,
  HOUSEHOLD_HEADER,
  loadActiveHousehold,
  setActiveHousehold,
} from '../activeHousehold';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

afterEach(async () => {
  forgetActiveHousehold();
  await AsyncStorage.clear();
});

function recorder() {
  const seen: Headers[] = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response('{}');
  }) as typeof fetch;
  return { seen, fetch: fetchWithHousehold(fetchImpl) };
}

describe('casa aberta neste aparelho', () => {
  it('vai em todo pedido; sem casa aberta, o pedido sai como estava', async () => {
    const { seen, fetch } = recorder();
    await fetch('https://x/rest/v1/lists', { headers: { apikey: 'k' } });
    expect(seen[0].has(HOUSEHOLD_HEADER)).toBe(false);
    await setActiveHousehold('u1', 'casa-2');
    await fetch('https://x/rest/v1/lists', { headers: { apikey: 'k' } });
    expect(seen[1].get(HOUSEHOLD_HEADER)).toBe('casa-2');
    expect(seen[1].get('apikey')).toBe('k');
  });

  it('pedido que já diz a casa (as outras casas, em segundo plano) fica como está', async () => {
    const { seen, fetch } = recorder();
    await setActiveHousehold('u1', 'casa-2');
    await fetch('https://x', { headers: { [HOUSEHOLD_HEADER]: 'casa-3' } });
    expect(seen[0].get(HOUSEHOLD_HEADER)).toBe('casa-3');
  });

  it('cada conta volta para a casa em que este aparelho estava', async () => {
    await setActiveHousehold('u1', 'casa-1');
    await setActiveHousehold('u2', 'casa-9');
    forgetActiveHousehold();
    expect(getActiveHousehold()).toBeNull();
    await loadActiveHousehold('u1');
    expect(getActiveHousehold()).toBe('casa-1');
    forgetActiveHousehold();
    await loadActiveHousehold('u2');
    expect(getActiveHousehold()).toBe('casa-9');
    await setActiveHousehold('u2', null);
    forgetActiveHousehold();
    await loadActiveHousehold('u2');
    expect(getActiveHousehold()).toBeNull();
  });
});
