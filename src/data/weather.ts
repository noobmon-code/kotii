// Clima da casa: onde ela fica (o bairro), a previsão do Open-Meteo e a busca
// do lugar, pelo CEP (ViaCEP; BrasilAPI de reserva) ou pela localização do
// celular, com o ponto do bairro achado no OpenStreetMap (Nominatim). O endereço exato não sai do
// aparelho para o banco: só o bairro, com as coordenadas arredondadas, e o estado (o código do IBGE, que
// a base aberta de preços usa: a lista acha os preços dos mercados do estado da casa).

import { onlineManager, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import {
  FORECAST_DAILY,
  FORECAST_DAYS,
  FORECAST_HOURLY,
  FORECAST_PAST_DAYS,
  osmCity,
  osmNeighborhood,
  parseForecast,
  pickNeighborhood,
  placeLabel,
  roundCoordinate,
  type OsmPlace,
} from '@/domain/weather';
import { stateCode } from '@/domain/sharedPrices';
import { HOUSEHOLD_HEADER } from '@/lib/householdHeader';
import { supabase, unwrap } from '@/lib/supabase';
import { isMissingColumn } from './missingSchema';

export interface HouseholdLocation {
  label: string;
  latitude: number;
  longitude: number;
  source: 'cep' | 'gps';
  /**
   * O estado do local (código do IBGE, "35"), de onde a lista lê os preços de outras casas. null: o local foi salvo
   * antes do estado existir (a tela Hoje o preenche, useFillHouseState) ou o estado não foi achado; ausente: o banco
   * ainda não tem a coluna.
   */
  state_code?: string | null;
}

export const LOCATION_KEY = ['householdLocation'];
const HOUR = 60 * 60 * 1000;

export async function fetchHouseholdLocation(db: SupabaseClient = supabase): Promise<HouseholdLocation | null> {
  let result = await db.from('household_location').select('label, latitude, longitude, source, state_code').maybeSingle();
  // O banco de antes da coluna do estado: o local sem ela (state_code fica ausente, não null).
  if (result.error && isMissingColumn(result.error, 'state_code')) {
    result = await db.from('household_location').select('label, latitude, longitude, source').maybeSingle();
  }
  const row = unwrap(result) as HouseholdLocation | null;
  return row ? { ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) } : null;
}

/** O local sem o estado, para gravar no banco de antes da coluna. */
const withoutState = ({ state_code: _state, ...place }: HouseholdLocation) => place;

/** Onde fica a casa; null se ninguém definiu ainda. */
export function useHouseholdLocation() {
  return useQuery({ queryKey: LOCATION_KEY, queryFn: () => fetchHouseholdLocation() });
}

export function useSaveHouseholdLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (place: HouseholdLocation) => {
      const result = await supabase.from('household_location').upsert(place, { onConflict: 'household_id' });
      // O banco de antes da coluna do estado: grava o resto.
      if (result.error && 'state_code' in place && isMissingColumn(result.error, 'state_code')) {
        unwrap(await supabase.from('household_location').upsert(withoutState(place), { onConflict: 'household_id' }));
      } else unwrap(result);
      return place;
    },
    onSuccess: (place) => {
      queryClient.setQueryData(LOCATION_KEY, place);
      queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
      // Os estados da casa mudaram: os preços de outras casas (o caminho do produto e a base aberta) também.
      queryClient.invalidateQueries({ queryKey: ['sharedPrices'] });
    },
  });
}

/**
 * Salva onde fica uma casa dada, e não a aberta neste aparelho: a que acabou de ser criada (bem-vindo e Suas casas),
 * que pode ainda não ser a aberta. A casa vai no corpo e no cabeçalho do pedido, então o lugar só cai nela (a regra
 * de acesso confere que a pessoa é dela).
 */
export async function saveHouseholdLocationFor(householdId: string, place: HouseholdLocation): Promise<void> {
  const save = (row: HouseholdLocation) =>
    supabase
      .from('household_location')
      .upsert({ household_id: householdId, ...row }, { onConflict: 'household_id' })
      .setHeader(HOUSEHOLD_HEADER, householdId);
  const result = await save(place);
  // O banco de antes da coluna do estado: grava o resto.
  if (result.error && 'state_code' in place && isMissingColumn(result.error, 'state_code')) unwrap(await save(withoutState(place)));
  else unwrap(result);
}

export function useClearHouseholdLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      unwrap(await supabase.from('household_location').delete().not('household_id', 'is', null));
    },
    onSuccess: () => {
      queryClient.setQueryData(LOCATION_KEY, null);
      queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
      // Sem o local, a casa pode perder um estado: os preços de outras casas mudam.
      queryClient.invalidateQueries({ queryKey: ['sharedPrices'] });
    },
  });
}

const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

type Place = Pick<HouseholdLocation, 'latitude' | 'longitude'>;

/** Previsão hora a hora do bairro; vale por uma hora e fica guardada no aparelho para abrir sem internet. */
export function forecastQuery(location: Place | null | undefined) {
  return queryOptions({
    queryKey: ['weather', location?.latitude, location?.longitude],
    enabled: Boolean(location),
    staleTime: HOUR,
    queryFn: async ({ signal }) => {
      const params = query({
        latitude: String(location!.latitude),
        longitude: String(location!.longitude),
        hourly: FORECAST_HOURLY.join(','),
        daily: FORECAST_DAILY.join(','),
        past_days: String(FORECAST_PAST_DAYS),
        forecast_days: String(FORECAST_DAYS),
        timezone: 'auto',
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
      if (!response.ok) throw new Error('Não foi possível buscar a previsão do tempo agora.');
      return parseForecast(await response.json());
    },
  });
}

export function useForecast(location: Place | null | undefined) {
  return useQuery(forecastQuery(location));
}

/**
 * Busca de novo o local e a previsão (puxar para atualizar). Só a previsão
 * em uso é buscada: sem local, nada a buscar.
 */
export function useRefreshWeather() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: LOCATION_KEY }),
      queryClient.invalidateQueries({ queryKey: ['weather'] }),
    ]);
}

// ---------------------------------------------------------------------------
// Busca do lugar

const OSM_URL = 'https://nominatim.openstreetmap.org';

/** O OpenStreetMap pede que o app se identifique; no navegador, quem identifica é o site. */
const osmInit: RequestInit = Platform.OS === 'web' ? {} : { headers: { 'User-Agent': 'Kotii/1.0 (app da casa)' } };

/** O Nominatim aceita no máximo uma busca por segundo: as buscas saem em fila, espaçadas. */
const OSM_GAP_MS = 1100;
let osmQueue: Promise<unknown> = Promise.resolve();
let osmLastAt = 0;

function osmFetch(url: string): Promise<Response> {
  const run = osmQueue.then(async () => {
    const wait = osmLastAt + OSM_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    osmLastAt = Date.now();
    return fetch(url, osmInit);
  });
  osmQueue = run.catch(() => undefined);
  return run;
}

async function osmSearch(text: string): Promise<OsmPlace[]> {
  const params = query({ q: text, format: 'jsonv2', addressdetails: '1', countrycodes: 'br', limit: '5', 'accept-language': 'pt-BR' });
  const response = await osmFetch(`${OSM_URL}/search?${params}`);
  if (!response.ok) throw new Error('Não foi possível achar o bairro no mapa agora.');
  return (await response.json()) as OsmPlace[];
}

async function osmReverse(latitude: number, longitude: number): Promise<OsmPlace['address']> {
  // Três casas (cerca de 100 m) bastam para saber o bairro.
  const params = query({
    lat: latitude.toFixed(3),
    lon: longitude.toFixed(3),
    zoom: '14',
    format: 'jsonv2',
    'accept-language': 'pt-BR',
  });
  const response = await osmFetch(`${OSM_URL}/reverse?${params}`);
  if (!response.ok) throw new Error('Não foi possível achar o bairro no mapa agora.');
  return ((await response.json()) as OsmPlace).address;
}

const coordinate = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN);

const CEP_NOT_FOUND = 'CEP não encontrado. Confira os números.';

interface CepAddress {
  city: string;
  neighborhood: string;
  state: string;
  /** Só a BrasilAPI dá, e costuma ser o centro da cidade. */
  latitude?: number;
  longitude?: number;
}

/** Bairro e cidade do CEP pelo ViaCEP (base dos Correios); fora do ar, pela BrasilAPI. */
async function cepAddress(cep: string): Promise<CepAddress> {
  const viaCep = await fetch(`https://viacep.com.br/ws/${cep}/json/`).catch(() => null);
  if (viaCep?.ok) {
    const data = (await viaCep.json()) as { erro?: unknown; localidade?: string; bairro?: string; uf?: string };
    if (data.erro || !data.localidade) throw new Error(CEP_NOT_FOUND);
    return { city: data.localidade.trim(), neighborhood: data.bairro?.trim() ?? '', state: data.uf ?? '' };
  }
  const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
  if (response.status === 404) throw new Error(CEP_NOT_FOUND);
  if (!response.ok) throw new Error('Não foi possível consultar o CEP agora. Tente de novo em instantes.');
  const data = (await response.json()) as {
    city?: string;
    neighborhood?: string;
    state?: string;
    location?: { coordinates?: { latitude?: unknown; longitude?: unknown } };
  };
  if (!data.city?.trim()) throw new Error(CEP_NOT_FOUND);
  return {
    city: data.city.trim(),
    neighborhood: data.neighborhood?.trim() ?? '',
    state: data.state ?? '',
    latitude: coordinate(data.location?.coordinates?.latitude),
    longitude: coordinate(data.location?.coordinates?.longitude),
  };
}

/**
 * O bairro do CEP: bairro e cidade vêm dos Correios, o ponto do bairro vem
 * do mapa. Sem o bairro no mapa, fica a cidade, e o nome mostra só ela.
 */
export async function findPlaceByCep(cep: string): Promise<HouseholdLocation> {
  const { city, neighborhood, state, latitude, longitude } = await cepAddress(cep);
  const at = (point: { latitude: number; longitude: number }, label: string): HouseholdLocation => ({
    label,
    latitude: roundCoordinate(point.latitude),
    longitude: roundCoordinate(point.longitude),
    source: 'cep',
    // A sigla do estado do CEP ("SP"), como o código do IBGE que a base de preços usa.
    state_code: stateCode(state),
  });
  if (neighborhood) {
    // Mapa fora do ar ou no limite: segue para a cidade (as coordenadas da
    // BrasilAPI, quando vieram, já servem).
    const results = await osmSearch(`${neighborhood}, ${city}, ${state}`).catch(() => null);
    const point = results && pickNeighborhood(results, neighborhood, city);
    if (point) return at(point, placeLabel(neighborhood, city)!);
  }
  const cityLabel = placeLabel(null, city)!;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return at({ latitude: latitude!, longitude: longitude! }, cityLabel);
  const [town] = (await osmSearch(`${city}, ${state}`)).filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)));
  if (!town) throw new Error('Não achei esse lugar no mapa. Tente pela localização do celular.');
  return at({ latitude: Number(town.lat), longitude: Number(town.lon) }, cityLabel);
}

type LocationModule = typeof import('expo-location');

/**
 * Carregado só no toque: no app instalado de antes da localização (sem o
 * módulo nativo), o resto do clima segue funcionando pelo CEP.
 */
function locationModule(): LocationModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-location') as LocationModule;
  } catch {
    throw new Error('Esta versão do app não tem a localização. Use o CEP ou atualize o app.');
  }
}

/** O bairro de onde o celular está agora (a pessoa precisa estar em casa). */
export async function findPlaceByDevice(): Promise<HouseholdLocation> {
  const Location = locationModule();
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Sem permissão para a localização. Permita nos ajustes do celular ou use o CEP.');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = position.coords;
  // Sem o nome do bairro (mapa fora do ar), o lugar vale do mesmo jeito.
  const address = await osmReverse(latitude, longitude).catch(() => undefined);
  return {
    label: placeLabel(osmNeighborhood(address), osmCity(address)) ?? 'Localização do celular',
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
    source: 'gps',
    // O estado no OpenStreetMap ("BR-SP"); fora do Brasil, ou sem o mapa, nenhum.
    state_code: stateCode(address?.['ISO3166-2-lvl4']),
  };
}

/** O estado (código do IBGE) do ponto guardado da casa, pelo mesmo mapa da localização do celular; null sem ele. */
export async function findStateByPoint(latitude: number, longitude: number): Promise<string | null> {
  return stateCode((await osmReverse(latitude, longitude))?.['ISO3166-2-lvl4']);
}

/** As casas cujo estado este aparelho já tentou achar nesta vez que o app abriu (uma tentativa por casa). */
const triedHouseStates = new Set<string>();

/** Para os testes: esquece as tentativas. */
export function forgetHouseStateTries(): void {
  triedHouseStates.clear();
}

/**
 * O local salvo antes do estado existir ganha o estado, uma vez, sem aviso: na tela Hoje, quando o local da casa
 * aberta chegou com `state_code` null e o aparelho está com internet, o ponto guardado (cerca de 1 km) vai ao mapa
 * (o mesmo da localização do celular, que os termos já citam) e só o estado é gravado, e só se ainda estiver vazio
 * (outro aparelho pode ter preenchido, ou o local pode ter saído: sem linha de volta, nada a fazer). Uma tentativa por
 * casa enquanto o app está aberto; qualquer falha fica em silêncio. Nunca para `undefined` (o banco sem a coluna, ou
 * o local guardado de antes). `householdId`: a casa aberta (a do local lido).
 */
export function useFillHouseState(householdId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const location = useHouseholdLocation();
  const place = location.data;
  const missing = place != null && place.state_code === null;
  useEffect(() => {
    if (!missing || !place || !householdId || triedHouseStates.has(householdId) || !onlineManager.isOnline()) return;
    triedHouseStates.add(householdId);
    void (async () => {
      try {
        const code = await findStateByPoint(place.latitude, place.longitude);
        if (!code) return;
        // A casa vai no filtro e no cabeçalho: uma troca de casa no meio do caminho não grava o estado em outra.
        unwrap(
          await supabase
            .from('household_location')
            .update({ state_code: code })
            .eq('household_id', householdId)
            .is('state_code', null)
            .select('household_id')
            .setHeader(HOUSEHOLD_HEADER, householdId),
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: LOCATION_KEY }),
          queryClient.invalidateQueries({ queryKey: ['sharedPrices'] }),
        ]);
      } catch {
        // Sem o mapa ou sem o banco, o local fica sem estado: nada a dizer.
      }
    })();
  }, [missing, place, householdId, queryClient]);
}
