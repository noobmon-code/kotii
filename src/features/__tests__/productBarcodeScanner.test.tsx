import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { GTIN_INVALID, GTIN_INVALID_TITLE, GTIN_RESTRICTED, GTIN_RESTRICTED_TITLE } from '@/domain/barcode';
import { ProductBarcodeScanner } from '@/features/ProductBarcodeScanner';
import { prepareBarcodeReader } from '@/lib/barcodeReader';
import { notify } from '@/ui/dialogs';
import { Button, TextField } from '@/ui/primitives';

// O leitor de verdade com a câmera de mentira: o que se confere é o que ele faz com cada leitura (a boa vale uma
// vez só, a torta passa calada) e com o código digitado.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockCamera: { onScan: ((event: { data: string }) => void) | null; types: unknown; granted: boolean } = {
  onScan: null,
  types: null,
  granted: true,
};

jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned: (event: { data: string }) => void; barcodeScannerSettings: { barcodeTypes: unknown } }) => {
    mockCamera.onScan = props.onBarcodeScanned;
    mockCamera.types = props.barcodeScannerSettings.barcodeTypes;
    return null;
  },
  useCameraPermissions: () => [{ granted: mockCamera.granted }, async () => ({ granted: true })],
}));
jest.mock('@/lib/barcodeReader', () => ({ prepareBarcodeReader: jest.fn(async () => undefined) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

let renderer: ReactTestRenderer | undefined;
const onRead = jest.fn<(gtin: string) => void>();

const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

function open() {
  act(() => {
    renderer = create(<ProductBarcodeScanner onRead={onRead} onClose={() => undefined} />);
  });
}
const scan = (data: string) => act(() => mockCamera.onScan!({ data }));
function type(text: string) {
  act(() => renderer!.root.findByType(TextField).props.onChangeText(text));
  act(() => renderer!.root.findAllByType(Button).find((b) => b.props.title === 'Usar este código')!.props.onPress());
}

beforeEach(() => {
  mockCamera.onScan = null;
  mockCamera.granted = true;
  onRead.mockClear();
  jest.mocked(notify).mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('leitor do código de barras do produto', () => {
  it('lê EAN-13, EAN-8 e UPC-A e prepara o leitor da web ao abrir', () => {
    open();
    expect(mockCamera.types).toEqual(['ean13', 'ean8', 'upc_a']);
    expect(prepareBarcodeReader).toHaveBeenCalled();
    expect(texts(renderer!.toJSON())).toEqual(
      expect.arrayContaining([
        'Ler código de barras',
        'Enquadre as barras do produto, com os números embaixo delas. A leitura é automática.',
        'Ou digite os números do código de barras',
      ]),
    );
  });

  it('a primeira leitura boa vale, uma vez só, mesmo com a câmera lendo de novo', () => {
    open();
    scan('7891000100103');
    scan('7891000100103');
    scan('96385074');
    expect(onRead.mock.calls).toEqual([['07891000100103']]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a leitura torta (dígito errado, pedaço) passa calada, e a boa depois vale', () => {
    open();
    scan('7891000100104');
    scan('78910001');
    scan('');
    expect(onRead).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    scan('036000291452');
    expect(onRead.mock.calls).toEqual([['00036000291452']]);
  });

  it('o código da balança lido pela câmera avisa uma vez só, sem ler', () => {
    open();
    scan('2000000000008');
    scan('2000000000008');
    expect(onRead).not.toHaveBeenCalled();
    expect(jest.mocked(notify).mock.calls).toEqual([[GTIN_RESTRICTED_TITLE, GTIN_RESTRICTED]]);
  });

  it('o código digitado errado avisa; o certo (com espaços) lê', () => {
    open();
    type('7891000100104');
    expect(jest.mocked(notify).mock.calls).toEqual([[GTIN_INVALID_TITLE, GTIN_INVALID]]);
    expect(onRead).not.toHaveBeenCalled();
    type('789 1000 100103');
    expect(onRead.mock.calls).toEqual([['07891000100103']]);
  });

  it('sem a permissão da câmera: o cartão de pedir, e o campo de digitar continua', () => {
    mockCamera.granted = false;
    open();
    expect(mockCamera.onScan).toBeNull();
    const text = texts(renderer!.toJSON());
    expect(text).toEqual(expect.arrayContaining(['Para ler o código de barras, o Kotii precisa usar a câmera.', 'Permitir a câmera']));
    type('7891000100103');
    expect(onRead.mock.calls).toEqual([['07891000100103']]);
  });
});
