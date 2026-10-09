import { afterEach, describe, expect, it } from '@jest/globals';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'barcode-detector';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

import { loadBarcodeReader, loadOnceWithRetry, zxingFileUrl } from '../barcodeReader';

const root = path.resolve(__dirname, '../../..');

describe('leitor de código na web: o .wasm do próprio site', () => {
  it('serve o .wasm da versão do zxing que o barcode-detector usa', () => {
    const url = zxingFileUrl(ZXING_WASM_VERSION, 'zxing_reader.wasm', 'https://fastly.jsdelivr.net/');
    expect(url).toBe(`/assets/zxing/${ZXING_WASM_VERSION}/zxing_reader.wasm`);
    // Falhou depois de mudar o barcode-detector do package.json? Copie
    // node_modules/zxing-wasm/dist/reader/zxing_reader.wasm para o caminho abaixo.
    const file = path.join(root, 'public', url);
    expect({ file, exists: existsSync(file) }).toEqual({ file, exists: true });
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(ZXING_WASM_SHA256);
  });

  it('o resto continua onde o zxing já buscaria', () => {
    expect(zxingFileUrl('3.1.3', 'zxing_reader.js', 'https://exemplo/')).toBe('https://exemplo/zxing_reader.js');
  });

  it('o app configura o mesmo barcode-detector que o expo-camera usa', () => {
    // Falhou depois de atualizar o expo-camera? Ponha no package.json a versão do
    // barcode-detector que ele usa (npm ls barcode-detector) e rode este teste de novo.
    const camera = path.dirname(require.resolve('expo-camera/package.json'));
    expect(require.resolve('barcode-detector', { paths: [camera] })).toBe(require.resolve('barcode-detector'));
  });

  it('a CSP do site deixa o navegador compilar o .wasm', () => {
    const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
      headers: { headers: { key: string; value: string }[] }[];
    };
    const csp = vercel.headers.flatMap((rule) => rule.headers).find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toMatch(/script-src [^;]*'wasm-unsafe-eval'/);
  });
});

describe('leitor de código na web: carregar e tentar de novo', () => {
  const original = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  afterEach(() => {
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = original;
  });

  /** O barcode-detector de mentira: cada carga do .wasm dá o resultado da fila. */
  function fakeZxing(loads: boolean[]) {
    const calls: string[] = [];
    class Polyfill {}
    const zxing = {
      BarcodeDetector: Polyfill,
      ZXING_WASM_VERSION: '3.1.3',
      purgeZXingModule: () => {
        calls.push('limpa');
      },
      prepareZXingModule: (options: { overrides: { locateFile: (file: string, prefix: string) => string }; fireImmediately: boolean }) => {
        calls.push(`carrega ${options.overrides.locateFile('zxing_reader.wasm', 'https://cdn/')} ${options.fireImmediately}`);
        return loads.shift() ? Promise.resolve({}) : Promise.reject(new Error('sem rede'));
      },
    };
    return { zxing, calls, Polyfill };
  }

  it('com o polyfill no lugar do leitor, limpa o que ficou guardado e carrega o .wasm do site', async () => {
    const { zxing, calls, Polyfill } = fakeZxing([true]);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Polyfill;
    await loadBarcodeReader(zxing as never);
    expect(calls).toEqual(['limpa', 'carrega /assets/zxing/3.1.3/zxing_reader.wasm true']);
  });

  it('com o leitor próprio do navegador, não mexe em nada', async () => {
    const { zxing, calls } = fakeZxing([true]);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class Native {};
    await loadBarcodeReader(zxing as never);
    expect(calls).toEqual([]);
  });

  it('sem rede na primeira vez, a próxima abertura da câmera tenta de novo; carregado, não carrega mais', async () => {
    const { zxing, calls, Polyfill } = fakeZxing([false, true]);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = Polyfill;
    const prepare = loadOnceWithRetry(() => loadBarcodeReader(zxing as never));
    await prepare();
    await prepare();
    await prepare();
    expect(calls).toEqual([
      'limpa',
      'carrega /assets/zxing/3.1.3/zxing_reader.wasm true',
      'limpa',
      'carrega /assets/zxing/3.1.3/zxing_reader.wasm true',
    ]);
  });
});
