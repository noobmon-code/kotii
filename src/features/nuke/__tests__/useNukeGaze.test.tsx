import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Component, type Ref } from 'react';
import type { View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { GAZE_HOLD_MS, GAZE_READ_MS, type Gaze } from '@/domain/nukeGaze';

import { useNukeGaze } from '../useNukeGaze';

// O olhar do Nuke do cabeçalho: mede onde ele e a mensagem nova estão e vira os olhos para lá por um tempo.

type Message = { id: string; role: 'user' | 'assistant' };

// As medidas que a tela daria: o Nuke no topo, a mensagem de quem escreve à direita e a dele à esquerda.
const NUKE = { x: 150, y: 20, width: 44, height: 44 };
const MINE = { x: 200, y: 400, width: 140, height: 44 };
const THEIRS = { x: 16, y: 460, width: 160, height: 60 };

/** No lugar da View: responde ao `measureInWindow` com o retângulo que recebeu (a View do Jest não responde). */
class Box extends Component<{ at: typeof NUKE }> {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void) {
    const { x, y, width, height } = this.props.at;
    callback(x, y, width, height);
  }
  render() {
    return null;
  }
}
const asBox = (ref: Ref<View>) => ref as unknown as Ref<Box>;

let seen: (Gaze | null)[] = [];
let renderer: ReactTestRenderer | undefined;

function Screen({ messages }: { messages: Message[] }) {
  const last = messages[messages.length - 1];
  const { nukeRef, messageRef, gaze } = useNukeGaze(last);
  seen.push(gaze);
  return (
    <>
      <Box ref={asBox(nukeRef)} at={NUKE} />
      {messages.map((message) => (
        <Box
          key={message.id}
          ref={message.id === last?.id ? asBox(messageRef) : undefined}
          at={message.role === 'user' ? MINE : THEIRS}
        />
      ))}
    </>
  );
}

async function render(messages: Message[]) {
  await act(async () => {
    if (renderer) renderer.update(<Screen messages={messages} />);
    else renderer = create(<Screen messages={messages} />);
  });
}
const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const gaze = () => seen[seen.length - 1];

beforeEach(() => {
  jest.useFakeTimers();
  seen = [];
  renderer = undefined;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  jest.useRealTimers();
});

describe('o olhar do Nuke na conversa', () => {
  it('a mensagem de quem escreve: olha para a direita e para baixo, só o tempo de ler', async () => {
    await render([]);
    await render([{ id: '1', role: 'user' }]);
    expect(gaze()).toBeNull();
    // Espera a conversa rolar até o fim antes de medir.
    await wait(349);
    expect(gaze()).toBeNull();
    await wait(1);
    expect(gaze()!.x).toBeGreaterThan(0);
    expect(gaze()!.y).toBeGreaterThan(0.9);
    await wait(GAZE_READ_MS - 1);
    expect(gaze()).not.toBeNull();
    await wait(1);
    expect(gaze()).toBeNull();
  });

  it('a resposta dele: olha para a esquerda e para baixo por mais tempo, e depois solta', async () => {
    await render([{ id: '1', role: 'user' }]);
    await render([{ id: '1', role: 'user' }, { id: '2', role: 'assistant' }]);
    await wait(350);
    expect(gaze()!.x).toBeLessThan(0);
    expect(gaze()!.y).toBeGreaterThan(0.9);
    await wait(GAZE_HOLD_MS - 1);
    expect(gaze()).not.toBeNull();
    await wait(1);
    expect(gaze()).toBeNull();
  });

  it('a mensagem que já estava na conversa ao abrir a tela não é novidade', async () => {
    await render([{ id: '1', role: 'assistant' }]);
    await wait(GAZE_HOLD_MS + 1000);
    expect(seen.every((value) => value === null)).toBe(true);
  });

  it('uma mensagem nova no meio do olhar troca o alvo, e o tempo conta de novo', async () => {
    await render([]);
    await render([{ id: '1', role: 'user' }]);
    await wait(350 + 500);
    expect(gaze()!.x).toBeGreaterThan(0);
    await render([{ id: '1', role: 'user' }, { id: '2', role: 'assistant' }]);
    // O olhar anterior não é solto pelo relógio da mensagem antiga.
    await wait(349);
    expect(gaze()!.x).toBeGreaterThan(0);
    await wait(1);
    expect(gaze()!.x).toBeLessThan(0);
    await wait(GAZE_READ_MS + 500);
    expect(gaze()!.x).toBeLessThan(0);
    await wait(GAZE_HOLD_MS);
    expect(gaze()).toBeNull();
  });

  it('conversa apagada: volta a olhar em volta; fechar a tela para o olhar', async () => {
    await render([]);
    await render([{ id: '1', role: 'assistant' }]);
    await wait(350);
    expect(gaze()).not.toBeNull();
    await render([]);
    await wait(350);
    expect(gaze()).toBeNull();

    await render([{ id: '2', role: 'assistant' }]);
    await act(async () => renderer!.unmount());
    renderer = undefined;
    const before = seen.length;
    await wait(GAZE_HOLD_MS + 1000);
    // Nenhum relógio do olhar ficou para trás: nada mais é desenhado depois de fechar.
    expect(seen.length).toBe(before);
  });
});
