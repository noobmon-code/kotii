import { Stack, useLocalSearchParams } from 'expo-router';

import { SCAN_PANTRY_TITLE, SCAN_TITLE, scanModeFromParam } from '@/domain/scan';
import { Scanner } from '@/features/scan/Scanner';

/**
 * O "Escanear" da tela Hoje (features/scan). `?para=despensa`: o que a casa já tem, só produtos, direto para a
 * despensa (o passo dos Primeiros passos).
 */
export default function ScanScreen() {
  const { para } = useLocalSearchParams<{ para?: string }>();
  const mode = scanModeFromParam(para);
  return (
    <>
      <Stack.Screen options={{ title: mode === 'despensa' ? SCAN_PANTRY_TITLE : SCAN_TITLE }} />
      <Scanner mode={mode} />
    </>
  );
}
