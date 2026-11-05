import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StrictMode, useEffect } from 'react';
import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { guardCameraStreams, useCameraStreamGuard, type MediaDevicesLike } from '../cameraStreams';

// No navegador, o vídeo que a câmera pediu e que chega com ela já desmontada é desligado na hora (o expo-camera só
// desliga os que já chegaram, e a luz da câmera ficaria acesa até a aba fechar). O vídeo que chega com a câmera na
// tela fica, e o que se pede sem câmera montada (a permissão) passa como sempre.

type Video = { stopped: number; getTracks: () => { stop: () => void }[] };

const scope = globalThis as unknown as Record<string, unknown>;
const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const os = Platform.OS;

let devices: MediaDevicesLike;
let requests: { resolve: (video: Video) => void; reject: (error: unknown) => void }[];
let original: jest.Mock<(constraints?: unknown) => Promise<Video>>;
let renderer: ReactTestRenderer | undefined;

function video(): Video {
  const v: Video = { stopped: 0, getTracks: () => [{ stop: () => void v.stopped++ }] };
  return v;
}

/** Como o expo-camera: o vídeo é pedido no efeito da câmera, no getUserMedia de agora do navegador. */
function Feed() {
  useEffect(() => {
    void (scope.navigator as { mediaDevices: MediaDevicesLike }).mediaDevices.getUserMedia({ video: true }).catch(() => undefined);
  }, []);
  return null;
}

function Camera() {
  useCameraStreamGuard();
  return <Feed />;
}

async function arrive(at = 0) {
  const v = video();
  await act(async () => requests[at].resolve(v));
  return v;
}

beforeEach(() => {
  Platform.OS = 'web';
  requests = [];
  original = jest.fn(() => new Promise<Video>((resolve, reject) => requests.push({ resolve, reject })));
  devices = { getUserMedia: original };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: devices }, configurable: true, writable: true });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  Platform.OS = os;
  if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
  else delete scope.navigator;
});

describe('o vídeo da câmera do app no navegador', () => {
  it('a câmera que sai antes de o vídeo chegar: o vídeo é desligado ao chegar', async () => {
    act(() => {
      renderer = create(<Camera />);
    });
    expect(original).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect((await arrive()).stopped).toBe(1);
  });

  it('o vídeo que chega com a câmera na tela fica (a câmera o desliga quando sair)', async () => {
    act(() => {
      renderer = create(<Camera />);
    });
    const v = await arrive();
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(v.stopped).toBe(0);
  });

  it('no modo estrito (a câmera desmonta e monta de novo na hora), o vídeo fica', async () => {
    act(() => {
      renderer = create(
        <StrictMode>
          <Camera />
        </StrictMode>,
      );
    });
    // O efeito rodou duas vezes (a câmera de mentira não segura o segundo pedido, como o expo-camera segura).
    expect(requests.length).toBe(2);
    const videos = [];
    for (let i = 0; i < requests.length; i++) videos.push(await arrive(i));
    expect(videos.every((v) => v.stopped === 0)).toBe(true);
  });

  it('cada câmera responde pelo vídeo dela: a que saiu não desliga o da que entrou', async () => {
    act(() => {
      renderer = create(<Camera key="a" />);
    });
    // A câmera de antes sai e outra entra no lugar dela (a câmera do QR que volta).
    act(() => renderer!.update(<Camera key="b" />));
    expect(requests).toHaveLength(2);
    const first = await arrive(0);
    const second = await arrive(1);
    expect(first.stopped).toBe(1);
    expect(second.stopped).toBe(0);
  });

  it('o pedido feito sem câmera montada (a permissão) passa como sempre', async () => {
    guardCameraStreams(devices);
    const pending = devices.getUserMedia({ video: true });
    const v = await arrive();
    await expect(pending).resolves.toBe(v);
    expect(v.stopped).toBe(0);
  });

  it('o pedido recusado chega recusado a quem pediu, também com a câmera já fora', async () => {
    act(() => {
      renderer = create(<Camera />);
    });
    const asked = devices.getUserMedia({ video: true });
    act(() => renderer!.unmount());
    renderer = undefined;
    await act(async () => requests[1].reject(new Error('NotAllowedError')));
    await expect(asked).rejects.toThrow('NotAllowedError');
  });

  it('embrulha o getUserMedia uma vez só, com o navegador como `this`', async () => {
    expect(guardCameraStreams(devices)).toBe(true);
    const wrapped = devices.getUserMedia;
    expect(wrapped).not.toBe(original);
    expect(guardCameraStreams(devices)).toBe(true);
    expect(devices.getUserMedia).toBe(wrapped);
    void devices.getUserMedia({ video: true });
    expect(original).toHaveBeenCalledTimes(1);
    expect(original.mock.contexts[0]).toBe(devices);
  });

  it('fora do navegador, nada é embrulhado', () => {
    Platform.OS = 'ios';
    act(() => {
      renderer = create(<Camera />);
    });
    expect(devices.getUserMedia).toBe(original);
  });

  it('sem câmera no navegador (sem mediaDevices), nada a vigiar', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    expect(guardCameraStreams()).toBe(false);
  });
});
