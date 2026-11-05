import { useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

// No navegador, o expo-camera pede o vídeo (getUserMedia) quando a câmera monta, e ao desmontar só desliga os vídeos
// que já chegaram: o vídeo que chega depois de a câmera sair fica ligado (a luz da câmera acesa, e em alguns aparelhos
// a câmera presa para a próxima abertura) até a aba fechar. Basta a câmera sair nos ~0,5–1,5 s em que o vídeo começa:
// a tela do QR deixada logo (voltar, "Digitar", o link colado, outra tela no lugar dela), a câmera do QR desligada por
// um jeito sem o QR, o leitor de código de barras ou de boleto fechado. Este vigia embrulha o getUserMedia do
// navegador, uma vez: um pedido feito com uma câmera do app montada (ui/AppCameraView) é dela, e o vídeo que chega com
// ela já fora é desligado na hora. O que se pede sem uma câmera montada (a permissão) passa como sempre.

interface Track {
  stop(): void;
}
interface Stream {
  getTracks(): Track[];
}
export interface MediaDevicesLike {
  getUserMedia(constraints?: unknown): Promise<Stream>;
}

/** Uma câmera do app: `mounted` é lido quando o vídeo chega, não quando ela sai. */
interface Owner {
  mounted: boolean;
}

// As câmeras montadas, a mais nova no fim: o pedido é da câmera que acabou de montar (o expo-camera pede o vídeo no
// efeito dela, depois do useLayoutEffect de quem a embrulha). O app nunca tem duas câmeras na tela ao mesmo tempo.
const owners: Owner[] = [];
const GUARDED = '__kotiiCameraGuard';

type GuardedGetUserMedia = MediaDevicesLike['getUserMedia'] & { [GUARDED]?: true };

function currentMediaDevices(): MediaDevicesLike | null {
  const devices = (globalThis as { navigator?: { mediaDevices?: Partial<MediaDevicesLike> } }).navigator?.mediaDevices;
  return devices && typeof devices.getUserMedia === 'function' ? (devices as MediaDevicesLike) : null;
}

/** Desliga cada trilha do vídeo (desligar de novo uma já desligada não faz nada). */
export function stopStream(stream: Stream | null | undefined) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // A trilha já foi embora: nada a desligar.
    }
  }
}

/** Embrulha o getUserMedia destes aparelhos de mídia, uma vez. Devolve se há o que vigiar (no navegador, com câmera). */
export function guardCameraStreams(devices: MediaDevicesLike | null = currentMediaDevices()): boolean {
  if (!devices) return false;
  const current = devices.getUserMedia as GuardedGetUserMedia;
  if (current[GUARDED]) return true;
  const guarded: GuardedGetUserMedia = (...args: [unknown?]) => {
    const owner = owners[owners.length - 1];
    const request = current.apply(devices, args);
    if (owner) {
      Promise.resolve(request).then(
        (stream) => {
          if (!owner.mounted) stopStream(stream);
        },
        () => undefined,
      );
    }
    return request;
  };
  guarded[GUARDED] = true;
  devices.getUserMedia = guarded;
  return true;
}

/**
 * Para quem renderiza uma câmera (ui/AppCameraView): enquanto montado, o vídeo que o navegador pedir é desta câmera,
 * e o que chegar com ela já desmontada é desligado. No React em modo estrito a câmera desmonta e monta de novo na
 * hora, antes do vídeo chegar: a câmera é a mesma (a ref), montada outra vez, e o vídeo fica.
 */
export function useCameraStreamGuard() {
  const owner = useRef<Owner>({ mounted: false });
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || !guardCameraStreams()) return;
    const me = owner.current;
    me.mounted = true;
    owners.push(me);
    return () => {
      me.mounted = false;
      const at = owners.lastIndexOf(me);
      if (at >= 0) owners.splice(at, 1);
    };
  }, []);
}
