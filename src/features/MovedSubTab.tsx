import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import type { MovedTo } from '@/domain/tabs';

/**
 * O endereço antigo de uma parte que mudou de aba (domain/tabs): vai para o lugar novo trocando o endereço
 * (replace: o antigo não fica no histórico, e voltar não cai aqui de novo). Antes, tira o ?aba= da aba de onde
 * saiu: ela continua montada com os parâmetros, e a barra de abas navega com os parâmetros guardados, então o
 * toque seguinte nela voltaria a mandar para o lugar novo, e a aba nunca mais abriria.
 */
export function MovedSubTab({ to }: { to: MovedTo }) {
  const { pathname, aba } = to;
  useFocusEffect(
    useCallback(() => {
      router.setParams({ aba: undefined });
      router.replace(aba ? { pathname, params: { aba } } : pathname);
    }, [pathname, aba]),
  );
  return null;
}
