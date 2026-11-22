import { PermissionStatus, type PermissionResponse } from 'expo';
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';

/**
 * A permissão da câmera que não deu para ler: a de quem ainda não respondeu, que a tela pede ao abrir. No navegador
 * sem a API de permissões (o Safari antes do 16, o do iPhone que parou no iOS 15), o expo-camera falha ao ler a
 * permissão (`navigator.permissions.query` não existe), e o gancho dele fica em null para sempre: ele não pega a falha
 * nem tenta de novo. A tela, que não desenha nada enquanto a permissão é lida, ficaria sem a câmera e sem as outras
 * opções. O pedido (getUserMedia) não precisa daquela API: com a resposta dele, vale a resposta.
 */
export const UNREAD_CAMERA_PERMISSION: PermissionResponse = {
  status: PermissionStatus.UNDETERMINED,
  granted: false,
  canAskAgain: true,
  expires: 'never',
};

/**
 * A permissão da câmera do "Escanear" (useCameraPermissions do expo-camera), com a leitura feita aqui para pegar a
 * falha dela: a leitura que falha vale como a de quem ainda não respondeu (UNREAD_CAMERA_PERMISSION). O pedido que
 * falha também não sobe como erro: a tela segue com as outras opções.
 */
export function useScanCameraPermission(): [PermissionResponse | null, () => Promise<PermissionResponse | null>] {
  const [permission, request, read] = useCameraPermissions({ get: false });
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let live = true;
    read().catch(() => {
      if (live) setUnread(true);
    });
    return () => {
      live = false;
    };
  }, [read]);

  const ask = useCallback(async () => {
    try {
      return await request();
    } catch {
      return null;
    }
  }, [request]);

  return [permission ?? (unread ? UNREAD_CAMERA_PERMISSION : null), ask];
}
