import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import NfceQrScreen from '@/app/nota/qrcode';
import PendingReceiptScreen from '@/app/nota/pendente';
import { accessKeyCheckDigit } from '@/domain/nfce';
import { ReceiptsPanel } from '@/features/finance/ReceiptsPanel';
import { openExternal } from '@/lib/openLink';
import { notify } from '@/ui/dialogs';
import { Button, ListRow } from '@/ui/primitives';

// A nota da Paraíba com o "não sou robô", de ponta a ponta: a tela do QR de verdade, a lista de Finanças > Notas,
// a tela da nota pendente, o leitor de foto de verdade e o aparelho (AsyncStorage) de mentira; o "servidor" guarda
// as notas e responde à função nfce com o CAPTCHA e à parse-receipt com uma nota nova, com a chave mandada.

// PB (25), out/2026, CNPJ 12.345.678/0001-99, modelo 65.
const BODY = '25' + '2610' + '12345678000199' + '65' + '001' + '000012345' + '1' + '12345678';
const KEY = BODY + accessKeyCheckDigit(BODY);
const QR = `http://www.sefaz.pb.gov.br/nfce?p=${KEY}|2|1|1|ABCDEF`;
const STORAGE_KEY = 'kotii:pending-receipts:u1';

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  receipts: [] as Row[],
  stores: [{ id: 's1', cnpj: '12345678000199', name: 'Mercado Bom' }] as Row[],
  calls: [] as { name: string; body: unknown }[],
};
const mockCamera: { onScan: ((event: { data: string }) => void) | null } = { onScan: null };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
const mockParams: { chave?: string; direto?: string } = {};
const mockPicked: string[] = [];
// A Sefaz que mostra a nota, sem pedir a verificação (o CAPTCHA de antes era de passagem).
const mockSefazReads = { value: false };
// A parse-receipt que não achou itens nos prints (só o topo ou o rodapé).
const mockReadsNoItems = { value: false };

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouter.push(...args),
    replace: (...args: unknown[]) => mockRouter.replace(...args),
    back: () => mockRouter.back(),
    canGoBack: () => mockRouter.canGoBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-camera', () => ({
  CameraView: (props: { onBarcodeScanned: (event: { data: string }) => void }) => {
    mockCamera.onScan = props.onBarcodeScanned;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));
jest.mock('@/lib/barcodeReader', () => ({ prepareBarcodeReader: async () => undefined }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }), useHouseholdId: () => 'h1' }));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/openLink', () => ({ openExternal: jest.fn(async () => true) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
// A galeria devolve as fotos combinadas; o envio só devolve os caminhos (o de verdade reduz a foto).
jest.mock('@/data/images', () => ({
  ...jest.requireActual<typeof import('@/data/images')>('@/data/images'),
  pickImages: async (_source: string, limit: number) => mockPicked.slice(0, limit),
  // No navegador, a galeria devolve tudo o que a pessoa escolheu, mesmo passando do limite.
  pickAllImages: async () => [...mockPicked],
  uploadImages: async (_bucket: string, householdId: string, uris: string[]) => uris.map((_, i) => `${householdId}/${i}.jpg`),
  removeImages: async () => undefined,
}));
jest.mock('@/ui/dialogs', () => ({
  notify: jest.fn(),
  confirmAction: (_title: string, _message: string, _label: string, yes: () => void) => yes(),
}));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/supabase', () => {
  const { FunctionsHttpError } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const tables = () => mockDb as unknown as Record<string, Row[]>;
  return {
    supabase: {
      functions: {
        invoke: async (name: string, { body }: { body: Record<string, unknown> }) => {
          mockDb.calls.push({ name, body });
          if (name === 'nfce' && mockSefazReads.value) {
            // A Sefaz mostrou a nota (sem a verificação, desta vez).
            return {
              data: {
                store: { name: 'MERCADO BOM', cnpj: '12345678000199', address: null },
                issuedAtLocal: '2026-10-18T12:00:00',
                total: 80,
                items: [{ description: 'ARROZ 5KG', code: null, quantity: 1, unit: 'UN', unitPrice: 80, totalPrice: 80 }],
              },
              error: null,
            };
          }
          if (name === 'nfce') {
            const reply = { code: 'captcha', uf: '25', error: 'A Sefaz da Paraíba pede uma confirmação de que você não é robô.' };
            return { data: null, error: new FunctionsHttpError(new Response(JSON.stringify(reply), { status: 422 })) };
          }
          if (mockReadsNoItems.value) {
            const reply = { code: 'no_items', error: 'Não achei os itens da nota nas imagens.' };
            return { data: null, error: new FunctionsHttpError(new Response(JSON.stringify(reply), { status: 422 })) };
          }
          // parse-receipt: a nota nova, com a chave do QR que veio junto.
          const id = `r${mockDb.receipts.length + 1}`;
          mockDb.receipts.push({
            id,
            access_key: body.access_key ?? null,
            source: 'ai',
            status: 'draft',
            purchased_at: '2026-10-18T15:00:00.000Z',
            total: 80,
            store: { id: 's1', name: 'Mercado Bom' },
            receipt_items: [{ count: 6 }],
          });
          return { data: { receipt_id: id, duplicate: false }, error: null };
        },
      },
      rpc: async (fn: string) => {
        mockDb.calls.push({ name: fn, body: null });
        return { data: [], error: null };
      },
      from: (table: string) => {
        const eq: [string, unknown][] = [];
        const within: [string, unknown[]][] = [];
        let single = false;
        let inserted: Row[] | null = null;
        let deleting = false;
        const run = () => {
          // Gravações da leitura pelo QR: a nota e os itens novos, ou a nota apagada.
          if (inserted) {
            const list = (tables()[table] ??= []);
            const added = inserted.map((values) => ({ id: `${table === 'receipts' ? 'q' : 'i'}${list.length + 1}`, ...values }));
            list.push(...added);
            return { data: single ? added[0] : added, error: null };
          }
          if (deleting) {
            tables()[table] = (tables()[table] ?? []).filter((row) => !eq.every(([column, value]) => row[column] === value));
            return { data: null, error: null };
          }
          const rows = (tables()[table] ?? []).filter(
            (row) => eq.every(([column, value]) => row[column] === value) && within.every(([column, values]) => values.includes(row[column])),
          );
          if (single) return { data: rows[0] ?? null, error: null };
          return { data: rows.map((row) => ({ ...row })), count: rows.length, error: null };
        };
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => (eq.push([column, value]), query),
          in: (column: string, values: unknown[]) => (within.push([column, values]), query),
          gt: () => query,
          or: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: () => ((single = true), query),
          single: () => ((single = true), query),
          insert: (values: Row | Row[]) => ((inserted = ([] as Row[]).concat(values)), query),
          delete: () => ((deleting = true), query),
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
        };
        return query;
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
  };
});

let renderer: ReactTestRenderer | undefined;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => texts(renderer!.toJSON()).join('\n');
const button = (title: string) => renderer!.root.findAllByType(Button).find((b) => b.props.title === title);
const stored = async () => JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]') as Row[];
const callsTo = (name: string) => mockDb.calls.filter((call) => call.name === name);

const clients: QueryClient[] = [];
const newClient = () => {
  const client = new QueryClient({
    // Sem o relógio que limpa o cache depois de a tela sair: o Jest termina sem esperar por ele.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return client;
};

/** Abre a tela num app recém-aberto (cache vazio, só o que o aparelho guardou) ou, com , no mesmo app. */
async function open(screen: ReactElement, client: QueryClient = newClient()) {
  act(() => renderer?.unmount());
  act(() => {
    renderer = create(<QueryClientProvider client={client}>{screen}</QueryClientProvider>);
  });
  await settle();
  await settle();
}

async function scan(data: string) {
  expect(mockCamera.onScan).not.toBeNull();
  await act(async () => mockCamera.onScan!({ data }));
  await settle();
  await settle();
}

async function press(title: string) {
  const target = button(title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
  await settle();
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockDb.receipts = [];
  mockDb.calls = [];
  mockCamera.onScan = null;
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  mockParams.chave = undefined;
  mockParams.direto = undefined;
  mockPicked.length = 0;
  mockReadsNoItems.value = false;
  mockSefazReads.value = false;
  jest.mocked(openExternal).mockClear();
  jest.mocked(notify).mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  for (const client of clients.splice(0)) client.clear();
});

describe('nota da Sefaz com "não sou robô"', () => {
  it('fica pendente, aparece depois de reabrir o app, o mesmo QR não duplica e os prints viram a nota', async () => {
    const client = newClient();
    await open(<NfceQrScreen />, client);
    await scan(QR);

    // O CAPTCHA: a nota fica guardada no aparelho, com a chave e o link, e a tela dela toma o lugar da do QR (o
    // endereço volta igual se o navegador recarregar o app).
    expect(callsTo('nfce')).toHaveLength(1);
    expect(await stored()).toEqual([{ accessKey: KEY, url: expect.stringContaining('www.sefaz.pb.gov.br/nfce'), householdId: 'h1', savedAt: expect.any(String) }]);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/pendente', params: { chave: KEY } });
    mockParams.chave = KEY;
    await open(<PendingReceiptScreen />, client);
    expect(page()).toContain('Leia esta nota pelos prints da Sefaz');
    expect(page()).not.toContain('Esta nota não está mais pendente');
    await press('Abrir a nota na Sefaz');
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining(`www.sefaz.pb.gov.br/nfce?p=${KEY}`));

    // O navegador recarregou o app na tela da pendente: ela continua lá.
    await open(<PendingReceiptScreen />);
    expect(page()).toContain('Leia esta nota pelos prints da Sefaz');

    // Finanças > Notas mostra a pendente, com o mercado que a casa já conhece.
    await open(<ReceiptsPanel />);
    expect(page()).toContain('Esperando os prints');
    expect(page()).toContain('Mercado Bom');
    expect(page()).toContain('Compra de outubro de 2026 · faltam os prints da Sefaz');
    expect(page()).not.toContain('Para revisar');
    const row = renderer!.root.findAllByType(ListRow).find((r) => r.props.title === 'Mercado Bom');
    act(() => row!.props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nota/pendente', params: { chave: KEY } });

    // O mesmo QR lido de novo: abre a pendente, sem ir à Sefaz e sem outra pendente.
    mockRouter.replace.mockClear();
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/pendente', params: { chave: KEY } });
    expect(await stored()).toHaveLength(1);

    // Os prints, pela tela da pendente: vão com a chave do QR (como a foto ia), viram a nota, e a pendente sai do
    // aparelho.
    await open(<PendingReceiptScreen />);
    mockPicked.push('topo', 'itens-1', 'itens-2', 'itens-3', 'itens-4', 'rodape');
    await press('Enviar os prints (até 6)');
    expect(callsTo('parse-receipt')).toEqual([
      { name: 'parse-receipt', body: { image_paths: ['h1/0.jpg', 'h1/1.jpg', 'h1/2.jpg', 'h1/3.jpg', 'h1/4.jpg', 'h1/5.jpg'], access_key: KEY } },
    ]);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'r1' } });
    await settle();
    expect(await stored()).toEqual([]);

    // Na lista, a nota lida está em "Para revisar" uma vez só, e a pendente sumiu.
    await open(<ReceiptsPanel />);
    expect(page()).toContain('Para revisar');
    expect(page()).not.toContain('Esperando os prints');

    // O QR lido de novo abre a nota que os prints criaram: nem Sefaz, nem leitura, nem nota nova.
    mockRouter.replace.mockClear();
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'r1' } });
    expect(callsTo('nfce')).toHaveLength(1);
    expect(callsTo('parse-receipt')).toHaveLength(1);
    expect(mockDb.receipts).toHaveLength(1);
  });

  it('a pendente que já virou nota na casa (lida por outra pessoa) some sozinha', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ accessKey: KEY, url: QR, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' }]));
    mockDb.receipts.push({ id: 'r7', access_key: KEY, status: 'confirmed', purchased_at: '2026-10-18T15:00:00.000Z', receipt_items: [{ count: 3 }] });
    await open(<ReceiptsPanel />);
    await settle();
    expect(page()).not.toContain('Esperando os prints');
    expect(await stored()).toEqual([]);
  });

  it('a nota apagada depois: a pendente nova da mesma chave não sai pela busca guardada de antes', async () => {
    const pendingRow = { accessKey: KEY, url: QR, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([pendingRow]));
    mockDb.receipts.push({ id: 'r7', access_key: KEY, status: 'draft', purchased_at: '2026-10-18T15:00:00.000Z', receipt_items: [{ count: 3 }] });
    const client = newClient();
    await open(<ReceiptsPanel />, client);
    expect(await stored()).toEqual([]);
    // A nota foi apagada (a exclusão refaz as buscas de 'receipts') e o QR, lido de novo, deixou outra pendente.
    act(() => renderer?.unmount());
    mockDb.receipts = [];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['receipts'] });
    });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([pendingRow]));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['pendingReceipts'] });
    });
    await open(<ReceiptsPanel />, client);
    await settle();
    expect(page()).toContain('Esperando os prints');
    expect(await stored()).toHaveLength(1);
  });

  it('a pendente de outra casa não aparece nesta', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ accessKey: KEY, url: QR, householdId: 'h2', savedAt: '2026-10-19T12:00:00.000Z' }]));
    await open(<ReceiptsPanel />);
    expect(page()).not.toContain('Esperando os prints');
    expect(await stored()).toHaveLength(1);
  });

  it('descartar tira a pendente do aparelho e volta', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ accessKey: KEY, url: QR, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' }]));
    mockParams.chave = KEY;
    await open(<PendingReceiptScreen />);
    expect(page()).toContain('Mercado Bom · Compra de outubro de 2026');
    expect(page()).toContain('Leia esta nota pelos prints da Sefaz');
    await press('Descartar');
    expect(await stored()).toEqual([]);
    expect(mockRouter.back).toHaveBeenCalled();

    await open(<PendingReceiptScreen />);
    expect(page()).toContain('Esta nota não está mais pendente');
  });

  it('sem como guardar no aparelho, o passo a passo fica na tela do QR; descartada ali, a tela fecha', async () => {
    // O armazenamento de mentira já é um jest.fn: a gravação da pendente (a próxima) falha.
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('cheio'));
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(await stored()).toEqual([]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(page()).toContain('Leia esta nota pelos prints da Sefaz');
    await press('Descartar');
    // A câmera não volta (o papel ainda na frente dela traria a nota de novo): a tela fecha.
    expect(mockRouter.back).toHaveBeenCalled();
    expect(callsTo('nfce')).toHaveLength(1);
  });

  it('imagens demais da galeria (no navegador não há limite): nenhuma é lida, e a pessoa fica sabendo', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ accessKey: KEY, url: QR, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' }]));
    mockParams.chave = KEY;
    await open(<PendingReceiptScreen />);
    mockPicked.push('topo', 'itens-1', 'itens-2', 'itens-3', 'itens-4', 'itens-5', 'rodape');
    await press('Enviar os prints (até 6)');
    expect(callsTo('parse-receipt')).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Imagens demais', expect.stringContaining('até 6 imagens'));
    expect(await stored()).toHaveLength(1);
  });

  it('os prints sem nenhum item (só o topo ou o rodapé): a pendente continua, para mandar a lista de itens', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ accessKey: KEY, url: QR, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' }]));
    mockParams.chave = KEY;
    mockReadsNoItems.value = true;
    await open(<PendingReceiptScreen />);
    mockPicked.push('topo');
    await press('Enviar os prints (até 6)');
    expect(callsTo('parse-receipt')).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('Não foi possível ler a nota', 'Não achei os itens da nota nas imagens.');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(await stored()).toHaveLength(1);
    expect(page()).toContain('Leia esta nota pelos prints da Sefaz');
  });

  it('QR que aponta para fora do governo: sem o botão de abrir, só os prints', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ accessKey: KEY, url: `https://sefaz-pb.example.com/nfce?p=${KEY}`, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' }]),
    );
    mockParams.chave = KEY;
    await open(<PendingReceiptScreen />);
    expect(button('Abrir a nota na Sefaz')).toBeUndefined();
    expect(button('Enviar os prints (até 6)')).toBeDefined();
    expect(page()).toContain('Leia o QR code da nota com a câmera do celular');
  });
});

describe('o estado que pediu o "não sou robô" há pouco', () => {
  // Outra nota da PB (outro número) e uma de SP (35), as duas válidas.
  const keyOf = (body: string) => body + accessKeyCheckDigit(body);
  const PB_OTHER = keyOf('25' + '2610' + '12345678000199' + '65' + '001' + '000067890' + '1' + '87654321');
  const SP_KEY = keyOf('35' + '2610' + '12345678000199' + '65' + '001' + '000012345' + '1' + '12345678');
  const DAY = 24 * 60 * 60 * 1000;
  const remembered = async () => JSON.parse((await AsyncStorage.getItem('kotii:sefaz-captcha')) ?? '{}') as Record<string, string>;

  it('depois de um CAPTCHA, outra nota da PB vai direto para a pendente, sem chamar a Sefaz, e diz por quê', async () => {
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(1);
    expect(Object.keys(await remembered())).toEqual(['25']);

    mockRouter.replace.mockClear();
    await open(<NfceQrScreen />);
    await scan(`http://www.sefaz.pb.gov.br/nfce?p=${PB_OTHER}|2|1|1|ABCDEF`);
    expect(callsTo('nfce')).toHaveLength(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/pendente', params: { chave: PB_OTHER, direto: '1' } });
    expect((await stored()).map((p) => p.accessKey)).toEqual([PB_OTHER, KEY]);

    // A pendente tem o "Abrir a nota na Sefaz" e a frase do estado.
    mockParams.chave = PB_OTHER;
    mockParams.direto = '1';
    await open(<PendingReceiptScreen />);
    expect(page()).toContain('A Sefaz da Paraíba pediu há pouco uma confirmação');
    expect(page()).not.toContain('antes de mostrar esta nota');
    expect(button('Tentar a Sefaz de novo')).toBeDefined();
    expect(button('Abrir a nota na Sefaz')).toBeDefined();
  });

  it('a nota que nem foi à Sefaz não renova o prazo do estado', async () => {
    const at = new Date(Date.now() - 2 * DAY).toISOString();
    await AsyncStorage.setItem('kotii:sefaz-captcha', JSON.stringify({ '25': at }));
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(0);
    expect(await remembered()).toEqual({ '25': at });
  });

  it('passados 7 dias, a nota da PB vai à Sefaz de novo', async () => {
    await AsyncStorage.setItem('kotii:sefaz-captcha', JSON.stringify({ '25': new Date(Date.now() - 8 * DAY).toISOString() }));
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(1);
    // A Sefaz pediu de novo: o prazo recomeça.
    expect(Date.now() - Date.parse((await remembered())['25'])).toBeLessThan(DAY);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/pendente', params: { chave: KEY } });
  });

  it('a nota de outro estado vai à Sefaz normalmente', async () => {
    await AsyncStorage.setItem('kotii:sefaz-captcha', JSON.stringify({ '25': new Date().toISOString() }));
    await open(<NfceQrScreen />);
    await scan(`https://www.nfce.fazenda.sp.gov.br/qrcode?p=${SP_KEY}|2|1|1|ABCDEF`);
    expect(callsTo('nfce')).toHaveLength(1);
  });

  it('a nota da PB que a casa já tem abre, sem ir à Sefaz e sem virar pendente', async () => {
    await AsyncStorage.setItem('kotii:sefaz-captcha', JSON.stringify({ '25': new Date().toISOString() }));
    mockDb.receipts.push({ id: 'r9', access_key: KEY, source: 'ai', status: 'confirmed', receipt_items: [{ count: 4 }] });
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(0);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'r9' } });
    expect(await stored()).toEqual([]);
  });

  /** A nota da PB que nem foi à Sefaz, aberta na tela da pendente (como a tela do QR deixa). */
  async function openSkipped() {
    await AsyncStorage.setItem('kotii:sefaz-captcha', JSON.stringify({ '25': new Date(Date.now() - DAY).toISOString() }));
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(0);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/pendente', params: { chave: KEY, direto: '1' } });
    mockRouter.replace.mockClear();
    mockParams.chave = KEY;
    mockParams.direto = '1';
    await open(<PendingReceiptScreen />);
  }

  it('"Tentar a Sefaz de novo": esquece o estado, lê pela Sefaz, abre a revisão e a pendente sai', async () => {
    await openSkipped();
    mockSefazReads.value = true;
    await press('Tentar a Sefaz de novo');
    await settle();
    expect(callsTo('nfce')).toHaveLength(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'q1' } });
    expect(mockDb.receipts.map((row) => row.access_key)).toEqual([KEY]);
    expect(await remembered()).toEqual({});
    expect(await stored()).toEqual([]);
  });

  it('a Sefaz pediu de novo: o estado volta a ser guardado e a pessoa fica na pendente', async () => {
    await openSkipped();
    await press('Tentar a Sefaz de novo');
    expect(callsTo('nfce')).toHaveLength(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(Date.now() - Date.parse((await remembered())['25'])).toBeLessThan(60 * 1000);
    expect(await stored()).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('A Sefaz ainda pede a confirmação', expect.any(String));
    // Agora a Sefaz pediu para esta nota: o cartão diz isso, sem a frase do estado nem o botão.
    expect(page()).toContain('antes de mostrar esta nota');
    expect(page()).not.toContain('A Sefaz da Paraíba pediu há pouco');
    expect(button('Tentar a Sefaz de novo')).toBeUndefined();
  });

  it('a pendente sem o link do QR (a chave digitada) não tem o que tentar', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([{ accessKey: KEY, url: null, householdId: 'h1', savedAt: '2026-10-19T12:00:00.000Z' }]));
    mockParams.chave = KEY;
    mockParams.direto = '1';
    await open(<PendingReceiptScreen />);
    expect(page()).toContain('Por alguns dias, as notas deste estado vão direto para os prints.');
    expect(page()).not.toContain('dá para tentar a Sefaz de novo');
    expect(button('Tentar a Sefaz de novo')).toBeUndefined();
  });

  it('sem como guardar no aparelho, a tela do QR mostra a frase do estado e o botão, que também lê a nota', async () => {
    await AsyncStorage.setItem('kotii:sefaz-captcha', JSON.stringify({ '25': new Date(Date.now() - DAY).toISOString() }));
    // A próxima gravação (a da pendente) falha.
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('cheio'));
    await open(<NfceQrScreen />);
    await scan(QR);
    expect(callsTo('nfce')).toHaveLength(0);
    expect(await stored()).toEqual([]);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(page()).toContain('A Sefaz da Paraíba pediu há pouco uma confirmação');
    expect(page()).not.toContain('antes de mostrar esta nota');
    mockSefazReads.value = true;
    await press('Tentar a Sefaz de novo');
    await settle();
    expect(callsTo('nfce')).toHaveLength(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/nota/[id]', params: { id: 'q1' } });
    expect(await remembered()).toEqual({});
  });
});
