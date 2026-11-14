import { Redirect, useLocalSearchParams } from 'expo-router';

import { movedFinanceTab } from '@/domain/tabs';

/**
 * O endereço da antiga aba Finanças, que virou uma parte da Casa: favoritos do navegador e o app instalado na tela
 * inicial guardam /financas, com ou sem ?aba=. O resumo e as contas abrem em Casa → Finanças, e as notas, que já
 * tinham ido para Compras, em Compras → Notas (domain/tabs). Troca o endereço (replace), sem deixar este no
 * histórico. Só existe com a chave de Finanças ligada, como as outras telas dela (a guarda fica no _layout).
 */
export default function FinanceRedirect() {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  const to = movedFinanceTab(aba);
  if ('compras' in to) return <Redirect href={{ pathname: to.compras.pathname, params: to.compras.aba ? { aba: to.compras.aba } : {} }} />;
  return <Redirect href={to.casa} />;
}
