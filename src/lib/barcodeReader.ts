// Leitor de QR code e de boleto na web. Nos navegadores sem leitor próprio
// (Safari do iPhone, Firefox, Chrome no Windows), o expo-camera usa o
// barcode-detector, que baixaria o .wasm do zxing do jsDelivr; a CSP do site
// (vercel.json) não deixa. Aqui o .wasm vem do próprio site, de
// public/assets/zxing/<versão do zxing-wasm>/. O barcode-detector fica fixo no
// package.json, na versão que o expo-camera usa; o teste deste arquivo diz o
// que fazer quando as versões mudarem.

import { Platform } from 'react-native';

/** Onde o zxing busca cada arquivo: o .wasm no próprio site, o resto onde ele já buscaria. */
export function zxingFileUrl(version: string, file: string, prefix: string): string {
  return file.endsWith('.wasm') ? `/assets/zxing/${version}/${file}` : prefix + file;
}

type BarcodeDetectorModule = typeof import('barcode-detector');

/**
 * Aponta o leitor para o .wasm do próprio site e já o carrega. Uma falha
 * guardada no zxing (o .wasm que não baixou por falta de rede, ou o jsDelivr
 * barrado pela CSP, quando o expo-camera chegou antes) só sai limpando o
 * módulo, então isto limpa e carrega de novo. Não faz nada quando o navegador
 * tem leitor próprio: sem ele, o pacote se instala em globalThis.BarcodeDetector,
 * e é essa a classe que o expo-camera usa.
 */
export async function loadBarcodeReader(zxing: BarcodeDetectorModule): Promise<void> {
  if ((globalThis as { BarcodeDetector?: unknown }).BarcodeDetector !== zxing.BarcodeDetector) return;
  zxing.purgeZXingModule();
  await zxing.prepareZXingModule({
    overrides: { locateFile: (file: string, prefix: string) => zxingFileUrl(zxing.ZXING_WASM_VERSION, file, prefix) },
    fireImmediately: true,
  });
}

/** Carrega uma vez; se falhar, a próxima chamada tenta de novo. */
export function loadOnceWithRetry(load: () => Promise<void>): () => Promise<void> {
  let ready: Promise<void> | null = null;
  return () => {
    ready ??= load().catch(() => {
      ready = null;
    });
    return ready;
  };
}

// Leitor próprio do navegador (Chrome no Android e no Mac): já existe antes de
// qualquer import do barcode-detector, que só acontece com a câmera aberta.
const nativeReader = typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined';

// O mesmo import dinâmico do expo-camera, para cair no mesmo módulo.
const prepare = loadOnceWithRetry(() => import('barcode-detector').then(loadBarcodeReader));

/**
 * Prepara o leitor da web. Chame ao abrir a câmera; se falhar (sem rede no
 * primeiro uso), a próxima abertura tenta de novo. No celular não faz nada.
 */
export function prepareBarcodeReader(): Promise<void> {
  if (Platform.OS !== 'web' || nativeReader) return Promise.resolve();
  return prepare();
}
