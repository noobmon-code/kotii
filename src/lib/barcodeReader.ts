// Leitor de QR code e de boleto na web. Nos navegadores sem leitor próprio
// (Safari do iPhone, Firefox, Chrome no Windows), o expo-camera usa o
// barcode-detector, que baixa o .wasm do zxing do jsDelivr. A CSP do site
// (vercel.json) não deixa: o .wasm vem do próprio site, de
// public/assets/zxing/<versão>/, e o teste confere que o arquivo é o da versão
// instalada. Ao atualizar o expo-camera, copie o novo de
// node_modules/zxing-wasm/dist/reader/.

import { Platform } from 'react-native';

/** Onde o zxing busca cada arquivo: o .wasm no próprio site, o resto onde ele já buscaria. */
export function zxingFileUrl(version: string, file: string, prefix: string): string {
  return file.endsWith('.wasm') ? `/assets/zxing/${version}/${file}` : prefix + file;
}

let prepared: Promise<void> | null = null;

/**
 * Aponta o leitor da web para o .wasm do próprio site. Chame ao abrir a câmera;
 * no celular e nos navegadores com leitor próprio não faz nada.
 */
export function prepareBarcodeReader(): Promise<void> {
  if (Platform.OS !== 'web' || typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined') {
    return Promise.resolve();
  }
  // O mesmo import dinâmico do expo-camera, para cair no mesmo módulo (e na mesma configuração).
  prepared ??= import('barcode-detector')
    .then(({ prepareZXingModule, ZXING_WASM_VERSION }) => {
      prepareZXingModule({
        overrides: { locateFile: (file: string, prefix: string) => zxingFileUrl(ZXING_WASM_VERSION, file, prefix) },
      });
    })
    .catch(() => {
      // Sem o leitor, a tela segue com a opção de colar o código; tenta de novo na próxima vez.
      prepared = null;
    });
  return prepared;
}
