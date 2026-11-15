// O que o começo novo (domain/onboarding) guarda neste aparelho (no navegador, o AsyncStorage usa o localStorage).
// Nada disto vai para o banco:
// - se o aparelho já teve uma conta aberta: quem já usou não vê as boas-vindas de novo, vai direto para "Entrar";
// - o código de um link de convite (/convite/ABC234), até a pessoa ter conta e entrar na casa (7 dias no máximo);
// - o passo seguinte de uma casa que acabou de nascer, para a tela Hoje: abrir a primeira lista (quem criou) ou dizer
//   que a pessoa entrou (quem entrou com o código);
// - se este aparelho abriu a prévia do começo (Configurações → Manutenção do app): aí as partes do começo novo que
//   ficam dentro do app (o convite pelo link, nos Primeiros passos e em Configurações) valem aqui também.
// Sem armazenamento (modo privado, cota cheia), cada coisa dura enquanto o app está aberto.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { isInviteCode, pendingInviteValid, type OnboardingNext } from '@/domain/onboarding';

import { FEATURES } from './features';

/** O que esta abertura do app já sabe de cada chave: o lido do aparelho (null: nada), ou o posto agora. */
const known = new Map<string, string | null>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lê a chave do aparelho uma vez por abertura do app; `keep` diz se o valor lido ainda vale (senão sai de lá). */
async function load(key: string, keep: (value: string) => boolean = () => true) {
  if (known.has(key)) return;
  let value: string | null = null;
  try {
    value = await AsyncStorage.getItem(key);
  } catch {
    // Sem armazenamento: como se nada estivesse guardado.
  }
  // Posto enquanto a leitura andava: vale o que foi posto.
  if (known.has(key)) return;
  if (value !== null && !keep(value)) {
    value = null;
    AsyncStorage.removeItem(key).catch(() => undefined);
  }
  known.set(key, value);
  emit();
}

function write(key: string, value: string | null) {
  if (known.get(key) === value) return;
  known.set(key, value);
  emit();
  (value === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, value)).catch(() => undefined);
}

/**
 * O valor da chave: undefined enquanto lê (ou sem chave), null quando não há nada. `keep`, quando há, é uma regra fixa
 * da chave (uma função do módulo, não criada a cada render).
 */
function useStored(key: string | null, keep?: (value: string) => boolean): string | null | undefined {
  useEffect(() => {
    if (key) void load(key, keep);
  }, [key, keep]);
  return useSyncExternalStore(
    subscribe,
    () => (key ? known.get(key) : undefined),
    () => undefined,
  );
}

const HAD_ACCOUNT_KEY = 'kotii:had-account';

/** Uma conta entrou neste aparelho: daqui em diante, a tela de entrar abre direto em "Entrar". */
export function markHadAccount() {
  write(HAD_ACCOUNT_KEY, '1');
}

/** Se o aparelho já teve uma conta aberta; undefined enquanto lê. */
export function useHadAccount(): boolean | undefined {
  const value = useStored(HAD_ACCOUNT_KEY);
  return value === undefined ? undefined : value === '1';
}

const PENDING_INVITE_KEY = 'kotii:pending-invite';

function pendingCode(raw: string, now: number): string | null {
  try {
    const value = JSON.parse(raw) as { code?: unknown; at?: unknown };
    return typeof value.code === 'string' && isInviteCode(value.code) && pendingInviteValid(Number(value.at), now) ? value.code : null;
  } catch {
    return null;
  }
}

/** Guarda o código do link de convite, para a tela de entrar na casa o trazer preenchido. */
export function savePendingInvite(code: string) {
  write(PENDING_INVITE_KEY, JSON.stringify({ code, at: Date.now() }));
}

/** O convite foi usado (ou a pessoa entrou em outra casa): o código sai do aparelho. */
export function clearPendingInvite() {
  write(PENDING_INVITE_KEY, null);
}

/** O que estava guardado e venceu sai do aparelho já na leitura (a conta da hora fica fora da tela). */
const keepPendingInvite = (value: string) => pendingCode(value, Date.now()) !== null;

/** O código de um link de convite que espera a pessoa entrar na casa; null sem nenhum, undefined enquanto lê. */
export function usePendingInvite(): string | null | undefined {
  const raw = useStored(PENDING_INVITE_KEY, keepPendingInvite);
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { code?: unknown };
    return typeof value.code === 'string' && isInviteCode(value.code) ? value.code : null;
  } catch {
    return null;
  }
}

const NEXT_PREFIX = 'kotii:onboarding-next:';

/** O passo seguinte da casa que acabou de nascer, para a tela Hoje fazer quando abrir nela. */
export function setOnboardingNext(householdId: string, next: OnboardingNext) {
  write(`${NEXT_PREFIX}${householdId}`, next);
}

/** A tela Hoje já fez o passo (ou a pessoa saiu dele): não volta. */
export function clearOnboardingNext(householdId: string) {
  write(`${NEXT_PREFIX}${householdId}`, null);
}

/** O passo seguinte da casa aberta; null sem nenhum, undefined enquanto lê (ou sem casa). */
export function useOnboardingNext(householdId: string | undefined): OnboardingNext | null | undefined {
  const value = useStored(householdId ? `${NEXT_PREFIX}${householdId}` : null);
  if (value === undefined) return undefined;
  return value === 'lista' || value === 'entrou' ? value : null;
}

const PREVIEW_KEY = 'kotii:onboarding-preview';

/** Este aparelho abriu a prévia do começo: as partes do começo novo dentro do app valem aqui. */
export function turnOnOnboardingPreview() {
  write(PREVIEW_KEY, '1');
}

/**
 * Se as partes do começo novo que ficam dentro do app valem aqui: com a chave ligada (lib/features), para todos; com
 * ela desligada, só no aparelho que abriu a prévia.
 */
export function useNewOnboarding(): boolean {
  const preview = useStored(PREVIEW_KEY) === '1';
  return FEATURES.onboarding || preview;
}
