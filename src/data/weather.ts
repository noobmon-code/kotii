// Clima da casa: onde ela fica (o bairro), a previsão do Open-Meteo e a busca
// do lugar, pelo CEP (ViaCEP; BrasilAPI de reserva) ou pela localização do
// celular, com o ponto do bairro achado no OpenStreetMap (Nominatim). O endereço exato não sai do
// aparelho para o banco: só o bairro, com as coordenadas arredondadas.

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { supabase, unwrap } from '@/lib/supabase';

export interface HouseholdLocation {
  label: string;
  latitude: number;
  longitude: number;
  source: 'cep' | 'gps';
}

export const LOCATION_KEY = ['householdLocation'];
const HOUR = 60 * 60 * 1000;

/** Onde fica a casa; null se ninguém definiu ainda. */
export function useHouseholdLocation() {
  return useQuery({
    queryKey: LOCATION_KEY,
    queryFn: async () => {
      const row = unwrap(
        await supabase.from('household_location').select('label, latitude, longitude, source').maybeSingle(),
      ) as HouseholdLocation | null;
      return row ? { ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) } : null;
    },
  });
}

export function useSaveHouseholdLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (place: HouseholdLocation) => {
      unwrap(await supabase.from('household_location').upsert(place, { onConflict: 'household_id' }));
      return place;
    },
    onSuccess: (place) => {
      queryClient.setQueryData(LOCATION_KEY, place);
      queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
    },
  });
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

// ---------------------------------------------------------------------------
// Busca do lugar

const OSM_URL = 'https://nominatim.openstreetmap.org';

/** O OpenStreetMap pede que o app se identifique; no navegador, quem identifica é o site. */
const osmInit: RequestInit = Platform.OS === 'web' ? {} : { headers: { 'User-Agent': 'Nooky/1.0 (app da casa)' } };

async function osmSearch(text: string): Promise<OsmPlace[]> {
  const params = query({ q: text, format: 'jsonv2', addressdetails: '1', countrycodes: 'br', limit: '5', 'accept-language': 'pt-BR' });
  const response = await fetch(`${OSM_URL}/search?${params}`, osmInit);
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
  const response = await fetch(`${OSM_URL}/reverse?${params}`, osmInit);
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
  });
  if (neighborhood) {
    const point = pickNeighborhood(await osmSearch(`${neighborhood}, ${city}, ${state}`), neighborhood, city);
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
  };
}
