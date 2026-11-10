import { Redirect } from 'expo-router';

/**
 * O endereço da antiga aba Família, que virou Configurações (a aba "Ajustes"): favoritos do navegador e o app
 * instalado na tela inicial guardam /familia. Troca o endereço (replace), sem deixar este no histórico.
 */
export default function FamilyRedirect() {
  return <Redirect href="/configuracoes" />;
}
