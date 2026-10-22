// O tema escolhido em Configurações → Aparência, guardado neste aparelho (no navegador, o AsyncStorage usa o
// localStorage). Não vai para o banco: cada aparelho tem o seu. Sem armazenamento (modo privado, cota
// cheia), vale o automático e a escolha dura enquanto o app está aberto.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseThemeChoice, type ThemeChoice } from '@/domain/appearance';

export const THEME_CHOICE_KEY = 'kotii:theme';

export async function readThemeChoice(): Promise<ThemeChoice> {
  try {
    return parseThemeChoice(await AsyncStorage.getItem(THEME_CHOICE_KEY));
  } catch {
    return 'auto';
  }
}

// Uma gravação de cada vez, na ordem dos toques: trocar rápido não deixa guardada uma escolha antiga.
let saving: Promise<void> = Promise.resolve();

export function saveThemeChoice(choice: ThemeChoice): Promise<void> {
  saving = saving.then(async () => {
    try {
      // O automático é o padrão: não precisa ficar guardado.
      if (choice === 'auto') await AsyncStorage.removeItem(THEME_CHOICE_KEY);
      else await AsyncStorage.setItem(THEME_CHOICE_KEY, choice);
    } catch {
      // Sem armazenamento: a escolha vale até o app fechar.
    }
  });
  return saving;
}
