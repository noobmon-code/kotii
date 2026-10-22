// O "Boa noite, André" do alto da tela Hoje: a saudação pela hora e o nome numa linha só. O navegador (react-native-web)
// ignora o adjustsFontSizeToFit, então o tamanho sai de uma conta da largura do texto na fonte do título.

/** A saudação pela hora do aparelho: bom dia das 5 às 11, boa tarde das 12 às 17, boa noite no resto. */
export function greeting(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// Largura de avanço de cada letra na Nunito ExtraBold, em milésimos do tamanho da fonte (unitsPerEm 1000). Gerada em
// 2026-10-21 com opentype.js (charToGlyph(c).advanceWidth) a partir de
// node_modules/@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf (Nunito "Version 3.602").
// As letras com acento e a cedilha de À–ÿ têm a largura da letra sem o sinal (conferido na mesma fonte): só as
// letras próprias (Æ, Ø, ß…) entram em OTHER. O kerning (tabela GPOS) fica de fora: a margem de 5% cobre.
const UPPER = [
  753, 695, 684, 774, 605, 570, 742, 780, 297, 372, 688, 573, 876, 753, 796, 664, 796, 696, 641, 632, 743, 727, 1120,
  685, 631, 615,
]; // A–Z
const LOWER = [
  557, 610, 478, 610, 549, 382, 615, 595, 268, 273, 558, 333, 889, 595, 589, 610, 610, 412, 492, 404, 590, 534, 861,
  559, 533, 480,
]; // a–z
const DIGIT = 600; // 0–9, todos iguais
const OTHER: Record<string, number> = {
  ' ': 279,
  ',': 260,
  '-': 440,
  "'": 256,
  '’': 260,
  '.': 260,
  Æ: 1000,
  Ð: 774,
  Ø: 796,
  Þ: 667,
  ß: 676,
  æ: 868,
  ð: 593,
  ø: 589,
};
/** O que não está na tabela conta como a maior maiúscula (o W): melhor sobrar do que quebrar a linha. */
const UNKNOWN = Math.max(...UPPER);
/** Um emoji é largo em todas as fontes de emoji (medido no Chrome: cerca de 1,36 do tamanho). */
const EMOJI = 1400;
/** A folga da conta: kerning, arredondamento e a fonte de cada sistema. */
const SAFETY = 1.05;

/** A largura de uma letra, em milésimos do tamanho da fonte. */
export function advanceOf(char: string): number {
  if (char in OTHER) return OTHER[char];
  // Acento solto, o junta-emoji e o seletor de variação não ocupam lugar; o emoji ocupa muito.
  if (/^[\p{M}\p{Join_Control}\p{Variation_Selector}]$/u.test(char)) return 0;
  if (/\p{Extended_Pictographic}/u.test(char)) return EMOJI;
  // "é" vira "e" + acento: fica a letra de base.
  const base = char.normalize('NFD').replace(/\p{M}/gu, '');
  if (base.length !== 1) return UNKNOWN;
  const code = base.charCodeAt(0);
  if (code >= 65 && code <= 90) return UPPER[code - 65];
  if (code >= 97 && code <= 122) return LOWER[code - 97];
  if (code >= 48 && code <= 57) return DIGIT;
  return OTHER[base] ?? UNKNOWN;
}

/**
 * A largura estimada do texto na Nunito ExtraBold, em pontos: a soma das larguras das letras mais o espaçamento entre
 * letras, que o React Native e o navegador põem depois de cada letra. Sem a folga de segurança.
 */
export function textWidth(text: string, fontSize: number, letterSpacing = 0): number {
  let units = 0;
  let count = 0;
  // Composto: o nome colado do macOS/iOS ("e" + acento solto) mede como a letra acentuada.
  for (const char of text.normalize('NFC')) {
    const advance = advanceOf(char);
    units += advance;
    if (advance > 0) count += 1;
  }
  return (units * fontSize) / 1000 + letterSpacing * count;
}

export interface GreetingNameOptions {
  /** O tamanho do título. */
  size: number;
  /** O menor tamanho do nome inteiro; abaixo disso vale o primeiro nome. */
  fullMin: number;
  /** O menor tamanho do primeiro nome; abaixo disso a linha corta com reticências. */
  min: number;
  letterSpacing: number;
}

const DEFAULTS: GreetingNameOptions = { size: 30, fullMin: 26, min: 22, letterSpacing: -0.3 };

const fits = (text: string, fontSize: number, width: number, letterSpacing: number) =>
  textWidth(text, fontSize, letterSpacing) * SAFETY <= width;

/** O maior tamanho inteiro entre `min` e `size` em que o texto cabe numa linha; null se nem em `min`. */
export function fitSize(text: string, availableWidth: number, size: number, min: number, letterSpacing = DEFAULTS.letterSpacing) {
  for (let fontSize = size; fontSize >= min; fontSize -= 1) {
    if (fits(text, fontSize, availableWidth, letterSpacing)) return fontSize;
  }
  return null;
}

/**
 * O nome do título numa linha: o nome inteiro, do tamanho do título até `fullMin`, se couber; senão o primeiro nome,
 * do tamanho do título até `min`; senão o primeiro nome em `min` (a linha corta com reticências).
 */
export function greetingName(
  displayName: string,
  availableWidth: number,
  options: Partial<GreetingNameOptions> = {},
): { text: string; fontSize: number } {
  const { size, fullMin, min, letterSpacing } = { ...DEFAULTS, ...options };
  const full = displayName.trim().replace(/\s+/g, ' ');
  if (!full) return { text: '', fontSize: size };
  const fullSize = fitSize(full, availableWidth, size, Math.min(size, fullMin), letterSpacing);
  if (fullSize) return { text: full, fontSize: fullSize };
  const first = full.split(' ')[0];
  return { text: first, fontSize: fitSize(first, availableWidth, size, min, letterSpacing) ?? min };
}
