// Onde os estados com "não sou robô" (domain/captchaStates) ficam guardados: no
// aparelho, para todas as contas (é sobre a Sefaz, não sobre a casa). Sem
// armazenamento, nenhum estado fica guardado e toda nota vai à Sefaz, como antes.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseCaptchaStates, withCaptchaState, withoutCaptchaState } from '@/domain/captchaStates';

const STORAGE_KEY = 'kotii:sefaz-captcha';

/** Os estados guardados; sem armazenamento, nenhum. */
export async function readCaptchaStates(): Promise<Record<string, string>> {
  try {
    return parseCaptchaStates(await AsyncStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** A pessoa pediu para tentar a Sefaz de novo: o estado sai. Sem armazenamento, nada muda. */
export async function forgetCaptchaState(uf: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(withoutCaptchaState(await readCaptchaStates(), uf)));
  } catch {
    // Sem armazenamento não havia estado guardado.
  }
}

/** A Sefaz desta UF acabou de pedir a verificação. Sem armazenamento, nada muda. */
export async function rememberCaptchaState(uf: string, now: Date = new Date()): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(withCaptchaState(await readCaptchaStates(), uf, now)));
  } catch {
    // Só se perde o atalho: a próxima nota desse estado vai à Sefaz.
  }
}
