import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Clipboard from 'expo-clipboard';
import { Modal, Platform, Share } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { notify } from '@/ui/dialogs';
import { ListShareSheet } from '../ListShareSheet';

// O menu de verdade (ListShareSheet + ActionSheet), com o que sai do app trocado por espiões: o que se
// confere aqui é o que a pessoa recebe quando o menu de compartilhar do sistema falha em "Outro app".

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
// Os de verdade trazem as ilustrações animadas (reanimated), que o Jest não carrega.
jest.mock('@/ui/primitives', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Text, Icon: () => null };
});

const TEXT = '*Mercado*\n- Banana';
const COPIED = ['Lista copiada', 'Não deu para abrir o menu de compartilhar: o texto foi copiado, é só colar na conversa.'];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** O erro do navegador (DOMException) e o do módulo nativo: o que importa é o `name`. */
const failure = (name: string) => Object.assign(new Error(name), { name });

const setString = jest.mocked(Clipboard.setStringAsync);

let share: jest.SpiedFunction<typeof Share.share>;
let renderer: ReactTestRenderer | undefined;
let onClose: jest.Mock<() => void>;

async function open(os: typeof Platform.OS) {
  jest.replaceProperty(Platform, 'OS', os);
  // Na web, "Outro app" só aparece em navegador com navigator.share.
  if (os === 'web') Object.assign(navigator, { share: jest.fn() });
  onClose = jest.fn<() => void>();
  await act(async () => {
    renderer = create(
      <ListShareSheet
        visible
        list={{ name: 'Mercado' }}
        items={[{ name: 'Banana', quantity: 1, unit: 'un', category: 'hortifruti', checked_at: null }]}
        onClose={onClose}
      />,
    );
    await flush();
  });
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

async function press(label: string) {
  const button = renderer!.root.find(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && textOf(node) === label,
  );
  await act(async () => {
    button.props.onPress();
    await flush();
  });
}

/** No iOS a ação escolhida só roda depois que o menu some. */
const dismiss = () =>
  act(async () => {
    renderer!.root.findByType(Modal).props.onDismiss();
    await flush();
  });

beforeEach(() => {
  jest.clearAllMocks();
  share = jest.spyOn(Share, 'share');
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
  delete (navigator as { share?: unknown }).share;
});

describe('"Outro app" quando o menu de compartilhar do sistema falha', () => {
  it('na web, fechar o menu sem escolher (AbortError) não copia nem avisa', async () => {
    share.mockRejectedValue(failure('AbortError'));
    await open('web');
    await press('Outro app');
    expect(share).toHaveBeenCalledWith({ message: TEXT });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setString).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('na web, outra falha copia o texto e avisa', async () => {
    share.mockRejectedValue(failure('NotAllowedError'));
    await open('web');
    await press('Outro app');
    expect(share).toHaveBeenCalledWith({ message: TEXT });
    expect(setString.mock.calls).toEqual([[TEXT]]);
    expect(jest.mocked(notify).mock.calls).toEqual([COPIED]);
  });

  it('no Android, o menu que não abre copia o texto e avisa', async () => {
    share.mockRejectedValue(failure('Error'));
    await open('android');
    await press('Outro app');
    expect(share).toHaveBeenCalledWith({ message: TEXT });
    expect(setString.mock.calls).toEqual([[TEXT]]);
    expect(jest.mocked(notify).mock.calls).toEqual([COPIED]);
  });

  it('no iOS, a falha chega depois de o menu ter aberto: não copia nem avisa', async () => {
    share.mockRejectedValue(failure('Error'));
    await open('ios');
    await press('Outro app');
    // O menu do Kotii ainda está fechando: nada foi chamado.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
    await dismiss();
    expect(share).toHaveBeenCalledWith({ message: TEXT });
    expect(setString).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
