import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { findPlaceByCep } from '../weather';

jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (r: { data: unknown }) => r.data }));

const calls: { url: string; at: number }[] = [];
const replies: Record<string, unknown> = {};

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

global.fetch = jest.fn(async (input: string | URL | Request) => {
  const url = String(input);
  calls.push({ url, at: Date.now() });
  const key = Object.keys(replies).find((k) => url.includes(k));
  return json(key ? replies[key] : []);
}) as typeof fetch;

afterEach(() => {
  calls.length = 0;
  for (const key of Object.keys(replies)) delete replies[key];
});

describe('bairro pelo CEP', () => {
  it('o bairro vem do mapa, na cidade do CEP', async () => {
    replies['viacep.com.br'] = { bairro: 'Asa Sul', localidade: 'Brasília', uf: 'DF' };
    replies['nominatim'] = [{ lat: '-15.8169455', lon: '-47.900049', addresstype: 'suburb', address: { suburb: 'Asa Sul', city: 'Brasília' } }];
    await expect(findPlaceByCep('70297400')).resolves.toEqual({ label: 'Asa Sul, Brasília', latitude: -15.82, longitude: -47.9, source: 'cep' });
  });

  it('sem o bairro no mapa, fica a cidade; a segunda busca espera um segundo (limite do OpenStreetMap)', async () => {
    replies['viacep.com.br'] = { bairro: 'Jardim Inexistente', localidade: 'Limeira', uf: 'SP' };
    replies['q=Limeira'] = [{ lat: '-22.5647', lon: '-47.4017', addresstype: 'city', address: { city: 'Limeira' } }];
    await expect(findPlaceByCep('13480000')).resolves.toEqual({ label: 'Limeira', latitude: -22.56, longitude: -47.4, source: 'cep' });
    const osm = calls.filter((c) => c.url.includes('nominatim'));
    expect(osm).toHaveLength(2);
    expect(osm[1].at - osm[0].at).toBeGreaterThanOrEqual(1000);
  });

  it('CEP que não existe', async () => {
    replies['viacep.com.br'] = { erro: 'true' };
    await expect(findPlaceByCep('99999999')).rejects.toThrow('CEP não encontrado');
  });
});
