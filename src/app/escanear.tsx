import { Stack, useLocalSearchParams } from 'expo-router';

import { scanModeFromParam, scanTitle } from '@/domain/scan';
import { Scanner } from '@/features/scan/Scanner';

/**
 * O "Escanear" da tela Hoje (features/scan). `?para=despensa`: o que a casa já tem, só produtos, direto para a
 * despensa (o passo dos Primeiros passos). `?para=nota`: só a nota, a câmera do "Adicionar nota" de Compras → Notas
 * e do "Finalizar compra" da lista (features/scan/receiptCamera).
 */
export default function ScanScreen() {
  const { para } = useLocalSearchParams<{ para?: string }>();
  const mode = scanModeFromParam(para);
  return (
    <>
      <Stack.Screen options={{ title: scanTitle(mode) }} />
      <Scanner mode={mode} />
    </>
  );
}
