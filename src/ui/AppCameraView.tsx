import { CameraView, type CameraViewProps } from 'expo-camera';

import { useCameraStreamGuard } from '@/lib/cameraStreams';

/**
 * A câmera do app (o QR da nota, o código de barras do produto, o boleto). É o CameraView do expo-camera, mais o
 * vigia do navegador (lib/cameraStreams): a câmera que sai enquanto o vídeo dela ainda começa não deixa o vídeo
 * ligado até a aba fechar. Toda câmera do app passa por aqui (ui/__tests__/appCameraView.test.tsx confere).
 */
export function AppCameraView(props: CameraViewProps) {
  useCameraStreamGuard();
  return <CameraView {...props} />;
}
