import { describe, expect, it } from '@jest/globals';
import { ZXING_WASM_SHA256, ZXING_WASM_VERSION } from 'barcode-detector';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

import { zxingFileUrl } from '../barcodeReader';

const root = path.resolve(__dirname, '../../..');

describe('leitor de código na web', () => {
  it('serve pelo próprio site o .wasm da versão instalada do zxing', () => {
    const url = zxingFileUrl(ZXING_WASM_VERSION, 'zxing_reader.wasm', 'https://fastly.jsdelivr.net/');
    expect(url).toBe(`/assets/zxing/${ZXING_WASM_VERSION}/zxing_reader.wasm`);
    const file = path.join(root, 'public', url);
    // Falhou depois de atualizar o expo-camera? Copie node_modules/zxing-wasm/dist/reader/zxing_reader.wasm para esta pasta.
    expect(existsSync(file)).toBe(true);
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(ZXING_WASM_SHA256);
  });

  it('o resto continua onde o zxing já buscaria', () => {
    expect(zxingFileUrl('3.1.3', 'zxing_reader.js', 'https://exemplo/')).toBe('https://exemplo/zxing_reader.js');
  });

  it('o app configura o mesmo barcode-detector que o expo-camera usa', () => {
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
