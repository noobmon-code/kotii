// Limites de imagem da leitura por IA (Claude Opus 5): 2576 px no lado maior
// e ~3,75 megapixels. Mandar já dentro do limite evita a API reduzir a foto de
// novo; cupom de mercado é comprido e cada pixel de largura conta.
export const MAX_LONG_EDGE = 2576;
export const MAX_PIXELS = 3_750_000;

/** Tamanho final da foto da nota (nunca amplia). */
export function fitForVision(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  return { width: Math.floor(width * scale), height: Math.floor(height * scale) };
}
