import { router, type Href } from 'expo-router';

/**
 * Fecha a tela depois de salvar ou excluir: volta para a de antes ou, quando
 * não há para onde voltar (no navegador, página recarregada ou aberta direto
 * pelo endereço), vai para `fallback`. Sem isto o `router.back()` não faz
 * nada e a tela fica parada, girando.
 */
export function goBackOr(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
