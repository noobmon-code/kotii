// O tema do app (Configurações → Aparência): automático (o do celular), claro ou escuro. A escolha é de cada
// aparelho e fica só nele (lib/themeChoice); quem pinta a tela é o ui/theme, pelo useScheme. Puro.

export type ThemeChoice = 'auto' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

/** As escolhas, na ordem da tela. */
export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

/** A frase embaixo da escolha. */
export const THEME_HINT = 'No automático, o app fica claro ou escuro junto com o celular.';

/** O que estava guardado no aparelho; qualquer outra coisa (nada guardado, valor de outra versão) é o automático. */
export function parseThemeChoice(raw: unknown): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

/** O tema em uso: o escolhido ou, no automático, o do celular (que pode não dizer nada: aí, o claro). */
export function resolveScheme(choice: ThemeChoice, system: string | null | undefined): Scheme {
  if (choice !== 'auto') return choice;
  return system === 'dark' ? 'dark' : 'light';
}
