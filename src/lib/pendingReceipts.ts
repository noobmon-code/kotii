// Onde as notas pendentes (domain/pendingReceipts) ficam guardadas: no aparelho
// (no navegador, o localStorage, pelo AsyncStorage), numa lista por pessoa, e
// cada pendente diz de que casa é. Aqui só o armazenamento, sem React nem
// banco: a conta apagada e a casa deixada (data/account, data/household) levam
// as delas sem puxar o resto; a tela usa data/pendingReceipts.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { parsePendingReceipts, type PendingReceipt, withoutPendingReceipt, withPendingReceipt } from '@/domain/pendingReceipts';

const storageKey = (userId: string) => `kotii:pending-receipts:${userId}`;

// Uma mudança por vez: ler, mudar e gravar a lista são uma coisa só (duas pendentes salvas juntas não se perdem).
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** As pendentes guardadas desta pessoa, de todas as casas; sem armazenamento, nenhuma. */
export async function readPendingReceipts(userId: string): Promise<PendingReceipt[]> {
  try {
    return parsePendingReceipts(await AsyncStorage.getItem(storageKey(userId)));
  } catch {
    return [];
  }
}

function changePending(userId: string, change: (list: PendingReceipt[]) => PendingReceipt[]): Promise<PendingReceipt[]> {
  return serialized(async () => {
    const next = change(await readPendingReceipts(userId));
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
    return next;
  });
}

/** Guarda a pendente (a mesma chave na mesma casa não vira outra) e devolve a lista gravada. */
export function savePendingReceipt(userId: string, entry: PendingReceipt): Promise<PendingReceipt[]> {
  return changePending(userId, (list) => withPendingReceipt(list, entry));
}

/** Tira as pendentes destas chaves, desta casa, e devolve a lista gravada. */
export function dropPendingReceipts(userId: string, householdId: string, accessKeys: readonly string[]): Promise<PendingReceipt[]> {
  return changePending(userId, (list) => accessKeys.reduce((rest, key) => withoutPendingReceipt(rest, householdId, key), list));
}

/** A conta foi apagada: as pendentes dela saem do aparelho. */
export async function forgetPendingReceipts(userId: string): Promise<void> {
  await serialized(() => AsyncStorage.removeItem(storageKey(userId))).catch(() => undefined);
}

/** A pessoa saiu da casa: as pendentes de lá saem do aparelho (as das outras casas ficam). */
export async function forgetPendingReceiptsOf(userId: string, householdId: string): Promise<void> {
  await changePending(userId, (list) => list.filter((p) => p.householdId !== householdId)).catch(() => undefined);
}
