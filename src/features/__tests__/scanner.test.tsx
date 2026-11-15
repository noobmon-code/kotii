import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { accessKeyCheckDigit } from '@/domain/nfce';
import {
  SCAN_BARCODE_TYPES,
  SCAN_LEAVE_TITLE,
  SCAN_NOTHING_TITLE,
  SCAN_QR_NOT_RECEIPT_TITLE,
  SCAN_RECEIPT_LATER_TITLE,
  type ScanMode,
} from '@/domain/scan';
import { Scanner } from '@/features/scan/Scanner';
import { goBackOr } from '@/lib/navigation';
import { ActionSheet } from '@/ui/ActionSheet';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, IconButton, ListRow, TextField } from '@/ui/primitives';

// A tela do "Escanear" de verdade, com a câmera, os dados e o roteador de mentira: o que cada código lido faz, o que
// a foto faz (a parte da nota, a leitura pela IA, o código que a própria foto pegou), os produtos achados que se
// juntam até a pessoa dizer para onde vão, e o que muda no modo da despensa e sem câmera.

/* eslint-disable @typescript-eslint/no-require-imports */

const mockCamera = {
  permission: { granted: true } as { granted: boolean; status?: string; canAskAgain?: boolean } | null,
  request: jest.fn(),
  take: jest.fn(async (_options?: unknown) => ({ uri: 'file://foto.jpg' })),
  // O que a leitura local acha numa foto (QR ou código de barras).
  codes: [] as { data: string }[],
};
jest.mock('expo-camera', () => {
  const React = require('react');
  class MockCameraView extends React.Component {
    takePictureAsync = (options?: unknown) => mockCamera.take(options);
    render() {
      return null;
    }
  }
  return {
    CameraView: MockCameraView,
    useCameraPermissions: () => [mockCamera.permission, mockCamera.request],
    scanFromURLAsync: async () => mockCamera.codes,
  };
});

type Callbacks = { onSuccess: (value: unknown) => void; onError: (err: unknown) => void };
const mockScan = { mutate: jest.fn((_input: unknown, _callbacks: Callbacks) => undefined), isPending: false };
const mockSavePantry = { mutate: jest.fn((_input: unknown, _callbacks: Callbacks) => undefined), isPending: false };
jest.mock('@/data/scan', () => ({ useScanPhotos: () => mockScan, useSaveScanToPantry: () => mockSavePantry }));

const mockAddToList = jest.fn(async (_item: unknown) => ({ id: 'l1', name: 'Mercado', added: true }));
jest.mock('@/data/market', () => ({ useAddToMarketList: () => ({ mutateAsync: mockAddToList }) }));

const mockPick = jest.fn(async (_source: string, _limit: number) => [] as string[]);
const mockManual = { mutate: jest.fn(), isPending: false };
jest.mock('@/data/receipts', () => ({
  pickReceiptImages: (source: string, limit: number) => mockPick(source, limit),
  useCreateManualReceipt: () => mockManual,
}));

type Product = { id: string; name: string; category: string; shelf_life_days: number | null };
const mockBarcode = { read: jest.fn(), busy: false, onProduct: (_product: Product) => undefined as void };
jest.mock('@/features/ProductBarcode', () => ({
  useProductBarcode: ({ onProduct }: { onProduct: (product: Product) => void }) => {
    mockBarcode.onProduct = onProduct;
    return { available: true, busy: mockBarcode.busy, start: jest.fn(), read: mockBarcode.read, element: null };
  },
}));

jest.mock('@/lib/auth', () => ({ useHouseholdId: () => 'casa-1' }));
jest.mock('@/lib/barcodeReader', () => ({ prepareBarcodeReader: jest.fn(async () => undefined) }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)) }));
jest.mock('@/lib/navigation', () => ({ goBackOr: jest.fn() }));
const mockDispatch = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: jest.fn() }, useNavigation: () => ({ dispatch: mockDispatch }) }));
// O aviso de sair: a tela diz se segura a saída e o que fazer quando alguém tenta sair.
const mockPrevent = { on: false, attempt: (_options: { data: { action: unknown } }) => undefined as void };
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (on: boolean, attempt: (options: { data: { action: unknown } }) => void) => {
    mockPrevent.on = on;
    mockPrevent.attempt = attempt;
  },
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

// Uma chave de NFC-e com o dígito certo, e o link do QR dela.
const FIRST43 = '3526111234567800019565001000012345100001234';
const QR = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${FIRST43}${accessKeyCheckDigit(FIRST43)}|2|1|1|A1B2C3`;
const EAN = '7891000100103';
const ARROZ: Product = { id: 'p1', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: null };
const FOUND = [
  { name: 'Leite Italac 1L', category: 'laticinios', quantity: 2 },
  { name: 'Detergente Ypê 500ml', category: 'limpeza', quantity: 1 },
];

let renderer: ReactTestRenderer | undefined;
let clock = 1_000_000;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  clock = 1_000_000;
  mockCamera.permission = { granted: true };
  mockCamera.codes = [];
  mockCamera.take.mockClear();
  mockScan.mutate.mockClear();
  mockSavePantry.mutate.mockClear();
  mockAddToList.mockClear();
  mockPick.mockReset();
  mockPick.mockResolvedValue([]);
  mockManual.mutate.mockClear();
  mockBarcode.read.mockClear();
  mockBarcode.busy = false;
  mockDispatch.mockClear();
  jest.mocked(router.replace).mockClear();
  jest.mocked(notify).mockClear();
  jest.mocked(confirmAction).mockClear();
  jest.mocked(goBackOr).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

async function mount(mode: ScanMode = 'tudo') {
  await act(async () => {
    renderer = create(<Scanner mode={mode} />);
  });
  return renderer!.root;
}

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const button = (root: ReactTestInstance, title: string) => root.findAllByType(Button).find((b) => b.props.title === title);
const rows = (root: ReactTestInstance) => root.findAllByType(ListRow).map((row) => row.props.title);
const sawCode = (root: ReactTestInstance, data: string) => act(async () => root.findByType(CameraView).props.onBarcodeScanned({ data }));
const found = (product: Product) => act(async () => mockBarcode.onProduct(product));
const quantityOf = (root: ReactTestInstance, name: string) =>
  root.findAll((node) => typeof node.type === 'string' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.endsWith(` de ${name}`) && /^\d+ de /.test(node.props.accessibilityLabel))[0]?.props.accessibilityLabel;
const lastScan = () => mockScan.mutate.mock.calls[mockScan.mutate.mock.calls.length - 1];

async function shoot(root: ReactTestInstance, title = 'Tirar foto') {
  await act(async () => button(root, title)!.props.onPress());
  await flush();
}

describe('o que a câmera lê sozinha', () => {
  it('procura o QR da nota e os códigos de barras de produto', async () => {
    const root = await mount();
    expect(root.findByType(CameraView).props.barcodeScannerSettings.barcodeTypes).toEqual([...SCAN_BARCODE_TYPES]);
  });

  it('o QR de uma nota abre a tela do QR com ele, sem nenhum toque', async () => {
    const root = await mount();
    await sawCode(root, QR);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/nota/qrcode', params: { qr: QR } });
    expect(mockScan.mutate).not.toHaveBeenCalled();
  });

  it('o QR de propaganda da embalagem não faz nada: a câmera segue lendo', async () => {
    const root = await mount();
    await sawCode(root, 'https://www.marca.com.br/promocao');
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockBarcode.read).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('o código de barras segue o caminho de sempre do código; o produto achado aparece, e o mesmo de novo soma', async () => {
    const root = await mount();
    await sawCode(root, EAN);
    expect(mockBarcode.read).toHaveBeenCalledWith('07891000100103');
    await found(ARROZ);
    expect(rows(root)).toEqual(['Arroz Tio João 5kg']);
    expect(quantityOf(root, ARROZ.name)).toBe('1 de Arroz Tio João 5kg');
    await found(ARROZ);
    expect(rows(root)).toEqual(['Arroz Tio João 5kg']);
    expect(quantityOf(root, ARROZ.name)).toBe('2 de Arroz Tio João 5kg');
  });

  it('o mesmo código visto de novo em seguida conta uma vez só; depois de uns segundos, conta de novo', async () => {
    const root = await mount();
    await sawCode(root, EAN);
    clock += 500;
    await sawCode(root, EAN);
    expect(mockBarcode.read).toHaveBeenCalledTimes(1);
    clock += 3000;
    await sawCode(root, EAN);
    expect(mockBarcode.read).toHaveBeenCalledTimes(2);
  });

  it('com produtos achados, o QR da nota é ignorado, e sair pergunta antes', async () => {
    const root = await mount();
    expect(mockPrevent.on).toBe(false);
    await found(ARROZ);
    await sawCode(root, QR);
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockPrevent.on).toBe(true);
    const action = { type: 'GO_BACK' };
    await act(async () => mockPrevent.attempt({ data: { action } }));
    expect(confirmAction).toHaveBeenCalledWith(SCAN_LEAVE_TITLE, 'O produto achado ainda não foi guardado.', 'Sair', expect.any(Function));
    expect(mockDispatch).not.toHaveBeenCalled();
    // "Sair": aí sim a tela fecha.
    await act(async () => (jest.mocked(confirmAction).mock.calls[0][3] as () => void)());
    expect(mockDispatch).toHaveBeenCalledWith(action);
  });
});

describe('a foto', () => {
  it('com a tela vazia, espera a próxima parte da nota; "Ler" manda para a IA, que aceita nota ou produtos', async () => {
    const root = await mount();
    await shoot(root);
    expect(mockScan.mutate).not.toHaveBeenCalled();
    expect(button(root, 'Ler')).toBeDefined();
    // O botão da câmera passa a ser a próxima parte.
    expect(button(root, 'Tirar foto')).toBeUndefined();
    await shoot(root, 'Mais uma foto');
    await act(async () => button(root, 'Ler (2 fotos)')!.props.onPress());
    expect(lastScan()[0]).toEqual({ uris: ['file://foto.jpg', 'file://foto.jpg'], classify: 'any' });
    // Mandadas, as partes saem da tela.
    expect(button(root, 'Ler (2 fotos)')).toBeUndefined();
  });

  it('no meio das partes da nota, a câmera não segue nenhum código', async () => {
    const root = await mount();
    await shoot(root);
    await sawCode(root, QR);
    await sawCode(root, EAN);
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockBarcode.read).not.toHaveBeenCalled();
  });

  it('os produtos que a IA achou entram na tela; a foto seguinte vai direto, pedindo só produtos', async () => {
    const root = await mount();
    await shoot(root);
    await act(async () => button(root, 'Ler')!.props.onPress());
    await act(async () => lastScan()[1].onSuccess({ kind: 'produtos', products: FOUND }));
    expect(rows(root)).toEqual(['Leite Italac 1L', 'Detergente Ypê 500ml']);
    expect(quantityOf(root, 'Leite Italac 1L')).toBe('2 de Leite Italac 1L');
    await shoot(root);
    expect(mockScan.mutate).toHaveBeenCalledTimes(2);
    expect(lastScan()[0]).toEqual({ uris: ['file://foto.jpg'], classify: 'products' });
    // A nota fotografada agora não é lida: a tela diz para guardar os produtos antes.
    await act(async () => lastScan()[1].onSuccess({ kind: 'nota-nao-lida' }));
    expect(notify).toHaveBeenLastCalledWith(SCAN_RECEIPT_LATER_TITLE, 'Guarde antes os produtos achados. Depois, escaneie a nota de novo.');
  });

  it('a nota lida abre a revisão; a foto que não é nada avisa; o erro da leitura aparece como veio', async () => {
    const root = await mount();
    await shoot(root);
    await act(async () => button(root, 'Ler')!.props.onPress());
    const callbacks = lastScan()[1];
    await act(async () => callbacks.onSuccess({ kind: 'nada' }));
    expect(notify).toHaveBeenLastCalledWith(SCAN_NOTHING_TITLE, expect.stringContaining('uma nota nem um produto'));
    await act(async () => callbacks.onError(new Error('A casa já usou as 50 fotos de produto deste mês.')));
    expect(notify).toHaveBeenLastCalledWith('Não foi possível ler a foto', 'A casa já usou as 50 fotos de produto deste mês.');
    await act(async () => callbacks.onSuccess({ kind: 'nota', receiptId: 'r1', duplicate: false }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'r1' } });
  });

  it('o QR que a própria foto pegou vale mais que a leitura pela IA, e não gasta leitura', async () => {
    mockCamera.codes = [{ data: 'https://www.marca.com.br/promocao' }, { data: QR }];
    const root = await mount();
    await shoot(root);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/nota/qrcode', params: { qr: QR } });
    expect(mockScan.mutate).not.toHaveBeenCalled();
    expect(button(root, 'Ler')).toBeUndefined();
  });

  it('o código de barras que a foto pegou segue pelo caminho do código', async () => {
    mockCamera.codes = [{ data: EAN }];
    const root = await mount();
    await shoot(root);
    expect(mockBarcode.read).toHaveBeenCalledWith('07891000100103');
    expect(mockScan.mutate).not.toHaveBeenCalled();
  });

  it('da galeria, as imagens vão juntas para a leitura; imagens demais, nada é lido', async () => {
    const root = await mount();
    const sheet = () => root.findByType(ActionSheet).props.actions as { label: string; onPress: () => void }[];
    mockPick.mockResolvedValue(['a.jpg', 'b.jpg']);
    await act(async () => sheet().find((a) => a.label === 'Escolher da galeria')!.onPress());
    await flush();
    expect(mockPick).toHaveBeenCalledWith('library', 6);
    expect(lastScan()[0]).toEqual({ uris: ['a.jpg', 'b.jpg'], classify: 'any' });
    mockPick.mockResolvedValue(['1', '2', '3', '4', '5', '6', '7']);
    await act(async () => sheet().find((a) => a.label === 'Escolher da galeria')!.onPress());
    await flush();
    expect(mockScan.mutate).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith('Imagens demais', expect.stringContaining('até 6 imagens'));
  });
});

describe('para onde os achados vão', () => {
  async function withFound() {
    const root = await mount();
    await found(ARROZ);
    await shoot(root);
    await act(async () => lastScan()[1].onSuccess({ kind: 'produtos', products: FOUND }));
    return root;
  }

  it('mais um, menos um e tirar mexem só naquele produto', async () => {
    const root = await withFound();
    const tap = (label: string) => act(async () => root.findAllByType(IconButton).find((b) => b.props.label === label)!.props.onPress());
    await tap('Mais um de Arroz Tio João 5kg');
    expect(quantityOf(root, ARROZ.name)).toBe('2 de Arroz Tio João 5kg');
    await tap('Menos um de Leite Italac 1L');
    expect(quantityOf(root, 'Leite Italac 1L')).toBe('1 de Leite Italac 1L');
    await tap('Tirar Detergente Ypê 500ml');
    expect(rows(root)).toEqual(['Arroz Tio João 5kg', 'Leite Italac 1L']);
  });

  it('"Pôr na despensa" guarda todos de uma vez e sai dizendo quantos foram', async () => {
    const root = await withFound();
    await act(async () => button(root, 'Pôr na despensa')!.props.onPress());
    const [input, callbacks] = mockSavePantry.mutate.mock.calls[0];
    expect((input as { items: { name: string }[] }).items.map((item) => item.name)).toEqual(['Arroz Tio João 5kg', 'Leite Italac 1L', 'Detergente Ypê 500ml']);
    expect((input as { today: string }).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await act(async () => callbacks.onSuccess(3));
    expect(goBackOr).toHaveBeenCalledWith({ pathname: '/compras', params: { aba: 'despensa' } });
    expect(notify).toHaveBeenLastCalledWith('Guardado', '3 itens foram para a despensa.');
  });

  it('"Pôr na lista" põe um de cada vez, sem a marca, e diz o que já estava lá', async () => {
    const root = await withFound();
    mockAddToList.mockResolvedValueOnce({ id: 'l1', name: 'Mercado', added: false });
    await act(async () => button(root, 'Pôr na lista')!.props.onPress());
    await flush();
    expect(mockAddToList.mock.calls.map(([item]) => item)).toEqual([
      { name: 'Arroz', category: 'graos', productId: 'p1', quantity: 1, unit: 'un' },
      { name: 'Leite', category: 'laticinios', productId: null, quantity: 2, unit: 'un' },
      { name: 'Detergente', category: 'limpeza', productId: null, quantity: 1, unit: 'un' },
    ]);
    expect(goBackOr).toHaveBeenCalledWith('/');
    expect(notify).toHaveBeenLastCalledWith('Na lista', '2 itens foram para a lista "Mercado". 1 já estava lá.');
  });

  it('a lista que falha no meio avisa e deixa os achados na tela', async () => {
    const root = await withFound();
    mockAddToList.mockRejectedValueOnce(new Error('Sem internet agora.'));
    await act(async () => button(root, 'Pôr na lista')!.props.onPress());
    await flush();
    expect(notify).toHaveBeenLastCalledWith('Não deu para pôr na lista', 'Sem internet agora.');
    expect(goBackOr).not.toHaveBeenCalled();
    expect(rows(root)).toHaveLength(3);
  });
});

describe('o modo da despensa (o que a casa já tem)', () => {
  it('só produtos: o QR da nota é ignorado, a foto vai direto pedindo só produtos, e o destino é a despensa', async () => {
    const root = await mount('despensa');
    await sawCode(root, QR);
    expect(router.replace).not.toHaveBeenCalled();
    await shoot(root);
    expect(lastScan()[0]).toEqual({ uris: ['file://foto.jpg'], classify: 'products' });
    await act(async () => lastScan()[1].onSuccess({ kind: 'produtos', products: FOUND }));
    expect(button(root, 'Pôr na despensa')).toBeDefined();
    expect(button(root, 'Pôr na lista')).toBeUndefined();
    const options = (root.findByType(ActionSheet).props.actions as { label: string }[]).map((a) => a.label);
    expect(options).toEqual(['Escolher da galeria', 'Digitar o código de barras']);
    // A nota fotografada aqui não é lida, e a frase diz onde ler.
    await shoot(root);
    await act(async () => lastScan()[1].onSuccess({ kind: 'nota-nao-lida' }));
    expect(notify).toHaveBeenLastCalledWith(SCAN_RECEIPT_LATER_TITLE, expect.stringContaining('Escanear da tela Hoje'));
  });
});

describe('sem a câmera, e as outras opções', () => {
  it('sem permissão (ou no computador), a tela mostra o pedido da câmera e as outras opções como botões', async () => {
    mockCamera.permission = { granted: false };
    const root = await mount();
    expect(root.findAllByType(CameraView)).toHaveLength(0);
    for (const title of ['Permitir a câmera', 'Escolher da galeria', 'Colar o link do QR code', 'Digitar o código de barras', 'Digitar a nota manualmente']) {
      expect(button(root, title)).toBeDefined();
    }
    await act(async () => button(root, 'Permitir a câmera')!.props.onPress());
    expect(mockCamera.request).toHaveBeenCalled();
    await act(async () => button(root, 'Digitar a nota manualmente')!.props.onPress());
    expect(mockManual.mutate).toHaveBeenCalled();
  });

  it('a permissão que ainda não foi pedida é pedida ao abrir, uma vez; a negada espera o toque', async () => {
    mockCamera.request.mockClear();
    mockCamera.permission = { granted: false, status: 'undetermined', canAskAgain: true };
    const root = await mount();
    expect(mockCamera.request).toHaveBeenCalledTimes(1);
    await act(async () => renderer!.update(<Scanner mode="tudo" />));
    expect(mockCamera.request).toHaveBeenCalledTimes(1);
    expect(button(root, 'Permitir a câmera')).toBeDefined();
    await act(async () => renderer!.unmount());
    mockCamera.request.mockClear();
    mockCamera.permission = { granted: false, status: 'denied', canAskAgain: false };
    await mount();
    expect(mockCamera.request).not.toHaveBeenCalled();
  });

  it('enquanto a permissão é lida, nem a câmera nem o pedido aparecem', async () => {
    mockCamera.permission = null;
    const root = await mount();
    expect(root.findAllByType(CameraView)).toHaveLength(0);
    expect(button(root, 'Permitir a câmera')).toBeUndefined();
  });

  it('o link colado segue como o QR lido; o que não é nota avisa', async () => {
    mockCamera.permission = { granted: false };
    const root = await mount();
    await act(async () => button(root, 'Colar o link do QR code')!.props.onPress());
    const field = () => root.findByType(TextField);
    await act(async () => field().props.onChangeText('https://exemplo.com/?p=123'));
    await act(async () => button(root, 'Usar')!.props.onPress());
    expect(notify).toHaveBeenLastCalledWith(SCAN_QR_NOT_RECEIPT_TITLE, expect.any(String));
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => field().props.onChangeText(` ${QR} `));
    await act(async () => button(root, 'Usar')!.props.onPress());
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/nota/qrcode', params: { qr: QR } });
  });

  it('o código de barras digitado segue pelo caminho do código; o número errado avisa', async () => {
    mockCamera.permission = { granted: false };
    const root = await mount();
    await act(async () => button(root, 'Digitar o código de barras')!.props.onPress());
    await act(async () => root.findByType(TextField).props.onChangeText('7891000100104'));
    await act(async () => button(root, 'Usar')!.props.onPress());
    expect(notify).toHaveBeenLastCalledWith('Código não confere', expect.any(String));
    expect(mockBarcode.read).not.toHaveBeenCalled();
    await act(async () => root.findByType(TextField).props.onChangeText('789 1000 100103'));
    await act(async () => button(root, 'Usar')!.props.onPress());
    expect(mockBarcode.read).toHaveBeenCalledWith('07891000100103');
    // O campo fecha depois de usado.
    expect(root.findAllByType(TextField)).toHaveLength(0);
  });
});
