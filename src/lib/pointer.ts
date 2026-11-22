import { Platform } from 'react-native';

/**
 * Se o navegador é de toque: o dedo é o ponteiro principal (`(pointer: coarse)`), o do celular e o do tablet. O
 * notebook com tela de toque responde pelo mouse, que é o principal dele. Fora do navegador, e no navegador que não
 * responde (sem `matchMedia`), false.
 */
export function primaryPointerIsTouch(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
