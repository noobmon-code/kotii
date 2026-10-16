// "Comprei mais": quantas unidades vieram na última caixa de cada remédio,
// para sugerir o mesmo número na próxima vez. Fica só neste aparelho (é uma
// comodidade, não um dado da casa) e nunca atrapalha: se não der para ler ou
// guardar, a pessoa digita o número.

import AsyncStorage from '@react-native-async-storage/async-storage';

const storageKey = (medicationId: string) => `medication-box:${medicationId}`;

/** O número digitado da última vez, como texto ("30", "12,5"); null se nunca houve. */
export async function lastBoxUnits(medicationId: string): Promise<string | null> {
  return AsyncStorage.getItem(storageKey(medicationId)).catch(() => null);
}

export async function rememberBoxUnits(medicationId: string, units: string): Promise<void> {
  await AsyncStorage.setItem(storageKey(medicationId), units).catch(() => undefined);
}

/** Tratamento encerrado: o número guardado sai junto. */
export async function forgetBoxUnits(medicationId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(medicationId)).catch(() => undefined);
}
