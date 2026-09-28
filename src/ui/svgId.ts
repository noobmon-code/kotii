import { useId } from 'react';

/**
 * Prefixo único para ids de gradientes num SVG. No web os ids valem para a
 * página toda: dois desenhos iguais na tela, com o mesmo id, se confundem.
 */
export function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}
