import { router, type Href } from 'expo-router';

import { windowFallback } from '@/domain/desktop';

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

/**
 * Fecha uma tela em janela (as de `windowOptions` no layout da raiz: no celular sobem por cima das outras, no
 * computador são uma caixa no meio da janela) pelo que ela mesma desenha: o "Fechar" do Nuke e da conversa do
 * consultor, o salvar, o excluir. Volta para a de antes ou, sem para onde voltar (aberta direto pelo endereço, ou
 * recarregada), vai para a parte da aba onde fica o que ela mostra (windowFallback): o mesmo lugar do "Fechar" e do
 * Esc da caixa no computador (features/desktop/RouteWindow). Sem isto o `router.back()` não faz nada: a janela
 * ficaria aberta depois de salvar e, no Nuke, que não tem a barra da caixa, o único "Fechar" na tela não fecharia.
 * `routeName` é o nome da rota no Stack ("tarefa/[id]"); `params`, os do endereço dela.
 */
export function closeWindow(routeName: string, params?: Readonly<Record<string, unknown>>) {
  goBackOr(windowFallback(routeName, params) as Href);
}
